import { createInterface } from "node:readline";
import { callTool, DEFAULT_BASE_URL, TOOLS } from "./tools.mjs";

export const SERVER_INFO = { name: "aeroallocator-mcp", version: "0.1.0" };
/** Protocol versions this server speaks, newest first; the client's is echoed when it is one of them. */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS =
  "Read-only tools over aeroallocator.app: where an amount of sAERO earns the most per day on each Aero chain, the best split across chains, power flows, and the site's own track record. Figures are estimates from recent fee pace, not promises or financial advice. Nothing here signs or sends a transaction; allocating is done from the owner's wallet on the site.";

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

/** Answers one JSON-RPC message; returns the response object, or null for a notification (which gets none). */
export async function handle(msg, opts = {}) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg && typeof msg === "object" && "id" in msg ? msg.id : null, -32600, "Invalid request");
  const isNotification = !("id" in msg) || msg.id === null || msg.id === undefined;
  const id = msg.id;
  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      return ok(id, { protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0], capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping":
      return isNotification ? null : ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const name = msg.params?.name;
      const result = await callTool(name, msg.params?.arguments, opts);
      if (result === null) return fail(id, -32602, `Unknown tool: ${String(name).slice(0, 80)}`);
      return ok(id, result);
    }
    default:
      // Notifications (initialized, cancelled, …) need no answer; any other request gets "method not found".
      return isNotification ? null : fail(id, -32601, `Method not found: ${msg.method.slice(0, 80)}`);
  }
}

/** Serves MCP over newline-delimited JSON on the given streams until the input ends. */
export function serve(input = process.stdin, output = process.stdout, opts = { baseUrl: process.env.AEROALLOCATOR_URL || DEFAULT_BASE_URL }) {
  const rl = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set();
  const send = (obj) => output.write(JSON.stringify(obj) + "\n");
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const work = (async () => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        return send(fail(null, -32700, "Parse error"));
      }
      try {
        if (Array.isArray(parsed)) {
          const out = (await Promise.all(parsed.map((m) => handle(m, opts)))).filter(Boolean);
          if (out.length) send(out);
        } else {
          const res = await handle(parsed, opts);
          if (res) send(res);
        }
      } catch (e) {
        send(fail(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed.id ?? null) : null, -32603, e instanceof Error ? e.message : "Internal error"));
      }
    })();
    pending.add(work);
    work.finally(() => pending.delete(work));
  });
  return new Promise((resolve) => rl.on("close", () => Promise.all(pending).then(resolve)));
}
