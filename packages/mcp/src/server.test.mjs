import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handle, PROTOCOL_VERSIONS } from "./server.mjs";
import { callTool, TOOLS } from "./tools.mjs";

const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "aeroallocator-mcp.mjs");

// A stub of the site: records what was asked and answers each path.
const asked = [];
let server;
let baseUrl;
beforeAll(async () => {
  server = createServer((req, res) => {
    asked.push(req.url);
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/boom") {
      res.writeHead(500).end("kaput");
    } else if (url.pathname === "/api/track-record") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ logged: 3, evaluated: 1, needed: 14, rows: [] }));
    } else {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ path: url.pathname, query: Object.fromEntries(url.searchParams) }));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

/** Runs the real launcher, sends the lines, and returns the parsed responses. */
async function session(lines, env = {}) {
  const child = spawn(process.execPath, [bin], { env: { ...process.env, AEROALLOCATOR_URL: baseUrl, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  for (const l of lines) child.stdin.write((typeof l === "string" ? l : JSON.stringify(l)) + "\n");
  child.stdin.end();
  await new Promise((r) => child.on("close", r));
  return out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

describe("the MCP handshake and tool list (real process over stdio)", () => {
  it("initializes, echoes a supported protocol version, lists the tools, and answers nothing to notifications", async () => {
    const out = await session([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "ping" },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0].result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "aeroallocator-mcp" } });
    expect(out[1].result.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    for (const t of out[1].result.tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(30);
    }
    expect(out[2]).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
  });

  it("falls back to its newest protocol version for one it does not know", async () => {
    const r = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(r.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
  });

  it("answers parse errors, unknown methods and unknown tools with JSON-RPC errors", async () => {
    const out = await session(["{not json", { jsonrpc: "2.0", id: 7, method: "resources/list" }, { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "nope" } }, { hello: 1 }]);
    // Responses are matched by id, not by order (JSON-RPC does not promise order).
    const code = (id, n = 0) => out.filter((r) => r.id === id)[n]?.error.code;
    expect(out.filter((r) => r.id === null).map((r) => r.error.code).sort()).toEqual([-32700, -32600].sort());
    expect(code(7)).toBe(-32601);
    expect(code(8)).toBe(-32602);
  });
});

describe("tools (against a stub of the site)", () => {
  it("top_gauges asks /api/top-gauges with the amount, chain and limit and returns the site's JSON untouched", async () => {
    const out = await session([{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "top_gauges", arguments: { amount: 10000, chain: 10, limit: 3 } } }]);
    const body = JSON.parse(out[0].result.content[0].text);
    expect(body).toEqual({ path: "/api/top-gauges", query: { amount: "10000", chain: "10", limit: "3" } });
    expect(out[0].result.isError).toBeUndefined();
  });

  it("top_gauges passes chain \"all\" through, for every chain ranked and merged", async () => {
    const out = await session([{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "top_gauges", arguments: { amount: 10000, chain: "all" } } }]);
    const body = JSON.parse(out[0].result.content[0].text);
    expect(body).toEqual({ path: "/api/top-gauges", query: { amount: "10000", chain: "all", limit: "10" } });
  });

  it("defaults to Base and ten gauges, and only sends parameters it was given", async () => {
    asked.length = 0;
    await callTool("top_gauges", { amount: 5 }, { baseUrl });
    await callTool("best_split_all_chains", { amount: 100 }, { baseUrl });
    await callTool("power_flows", {}, { baseUrl });
    expect(asked).toEqual(["/api/top-gauges?amount=5&chain=8453&limit=10", "/api/all-chains-split?amount=100", "/api/gauge-flows?chain=8453"]);
  });

  it("checks arguments before any request: a bad call never reaches the site", async () => {
    asked.length = 0;
    const bad = [
      ["top_gauges", {}],
      ["top_gauges", { amount: -1 }],
      ["top_gauges", { amount: "10" }],
      ["top_gauges", { amount: 5, chain: 999 }],
      ["top_gauges", { amount: 5, chain: "everything" }],
      ["top_gauges", { amount: 5, limit: 99 }],
      ["best_split_all_chains", { amount: 5, days: 365 }],
      ["gauge_history", { gauge: "0x123" }],
      ["gauge_history", { gauge: "0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" }],
      ["allocation_fee", {}],
      ["allocation_fee", { chain: 8453 }],
    ];
    for (const [name, args] of bad) {
      const r = await callTool(name, args, { baseUrl });
      expect(r.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
    }
    expect(asked).toEqual([]);
  });

  it("gauge_history and allocation_fee pass a valid address and chain through", async () => {
    asked.length = 0;
    const gauge = "0x77E3E1b150D4509aADE60b73C48f77CAb00272B1";
    await callTool("gauge_history", { gauge }, { baseUrl });
    await callTool("allocation_fee", { chain: 5042, gauges: 2 }, { baseUrl });
    await callTool("track_record", {}, { baseUrl });
    expect(asked).toEqual([`/api/gauge-history?chain=8453&gauge=${gauge}`, "/api/allocation-fee?chain=5042&gauges=2", "/api/track-record"]);
  });

  it("turns a site error and an unreachable site into error results, not crashes", async () => {
    const stub = { fetchImpl: async () => new Response("kaput", { status: 500 }) };
    const r = await callTool("track_record", {}, { baseUrl, ...stub });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("500");
    const down = await callTool("track_record", {}, { baseUrl, fetchImpl: async () => Promise.reject(new Error("connect ECONNREFUSED")) });
    expect(down.isError).toBe(true);
    expect(down.content[0].text).toContain("Could not reach");
  });

  it("returns null for a tool it does not have", async () => {
    expect(await callTool("sign_transaction", {}, { baseUrl })).toBeNull();
  });
});

describe("the launcher", () => {
  it("prints help and version without starting the server", async () => {
    const run = (arg) =>
      new Promise((resolve) => {
        const c = spawn(process.execPath, [bin, arg]);
        let o = "";
        c.stdout.on("data", (d) => (o += d));
        c.on("close", () => resolve(o));
      });
    expect(await run("--version")).toContain(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
    const help = await run("--help");
    expect(help).toContain("npx");
    for (const t of TOOLS) expect(help).toContain(t.name);
  });
});
