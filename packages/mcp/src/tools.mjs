// The tools: each is one read-only GET on aeroallocator.app's free API. Nothing here signs, sends or needs a key. Arguments are
// checked here before any request is made, so a bad call never reaches the site.

export const DEFAULT_BASE_URL = "https://aeroallocator.app";
/** The Aero chains the site reads (chain ids). */
export const CHAINS = { 8453: "Base", 1: "Ethereum", 10: "OP", 42161: "Arbitrum", 57073: "Ink", 4663: "Robinhood Chain", 5042: "Arc" };
const CHAIN_IDS = Object.keys(CHAINS).map(Number);
const MAX_AMOUNT = 1_000_000_000;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const chainProp = { type: "integer", enum: CHAIN_IDS, description: `Chain id: ${Object.entries(CHAINS).map(([id, n]) => `${n} ${id}`).join(", ")}. Default 8453 (Base).` };
const amountProp = { type: "number", exclusiveMinimum: 0, maximum: MAX_AMOUNT, description: "Voting power to place, in whole sAERO power (above 0)." };

// top_gauges also takes "all": every chain ranked against its own fees and merged (the site's "All networks" view).
const chainOrAllProp = {
  anyOf: [{ type: "integer", enum: CHAIN_IDS }, { type: "string", enum: ["all"] }],
  description: `${chainProp.description} Or "all": every chain ranked against its own fees and merged, each row with its chainId (the ETH to reach a chain other than Base is not counted; use best_split_all_chains for that).`,
};

class ArgError extends Error {}

function amount(a) {
  const v = a.amount;
  if (typeof v !== "number" || !Number.isFinite(v) || !(v > 0) || v > MAX_AMOUNT) throw new ArgError("amount must be a number above 0 and at most 1,000,000,000");
  return v;
}
function chain(a, required = false) {
  if (a.chain === undefined) {
    if (required) throw new ArgError("chain is required");
    return 8453;
  }
  if (!Number.isInteger(a.chain) || !CHAIN_IDS.includes(a.chain)) throw new ArgError(`chain must be one of ${CHAIN_IDS.join(", ")}`);
  return a.chain;
}

function chainOrAll(a) {
  return a.chain === "all" ? "all" : chain(a);
}

export const TOOLS = [
  {
    name: "top_gauges",
    description:
      "The gauges on one Aero chain, or on every chain at once (chain \"all\"), ranked by what an amount of sAERO would earn per day in each, after it joins the power already there. Each row has the low case, the fee and incentive pace, how much history it rests on (thin / fair / solid / spiky), steadiness, and a note when incentives end inside the 47-hour wait. Read-only; estimates, not advice.",
    inputSchema: { type: "object", properties: { amount: amountProp, chain: chainOrAllProp, limit: { type: "integer", minimum: 1, maximum: 25, description: "How many gauges (default 10)." } }, required: ["amount"] },
    request: (a) => {
      const limit = a.limit === undefined ? 10 : a.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new ArgError("limit must be a whole number from 1 to 25");
      return { path: "/api/top-gauges", params: { amount: amount(a), chain: chainOrAll(a), limit } };
    },
  },
  {
    name: "best_split_all_chains",
    description:
      "The best split of an amount over every Aero chain at once, after the one-off ETH each extra chain costs to reach, next to Base alone. `days` is how long the fees are weighed over (default: the allocation wait). Read-only.",
    inputSchema: { type: "object", properties: { amount: amountProp, days: { type: "number", minimum: 1, maximum: 90, description: "Days to weigh fees over, 1 to 90." } }, required: ["amount"] },
    request: (a) => {
      if (a.days !== undefined && !(typeof a.days === "number" && a.days >= 1 && a.days <= 90)) throw new ArgError("days must be a number from 1 to 90");
      return { path: "/api/all-chains-split", params: { amount: amount(a), days: a.days } };
    },
  },
  {
    name: "power_flows",
    description: "Which gauges are gaining or losing share of a chain's allocation weight over the last day, and which gauges got new incentives. Empty for the first hours after the site starts recording. Read-only.",
    inputSchema: { type: "object", properties: { chain: chainProp } },
    request: (a) => ({ path: "/api/gauge-flows", params: { chain: chain(a) } }),
  },
  {
    name: "gauge_history",
    description: "One gauge's recent history: fees released per 6 hours, its weight snapshots, its steadiness, and a daily record of up to 90 days. Read-only.",
    inputSchema: { type: "object", properties: { gauge: { type: "string", description: "The gauge address (0x…)." }, chain: chainProp }, required: ["gauge"] },
    request: (a) => {
      if (typeof a.gauge !== "string" || !ADDRESS.test(a.gauge)) throw new ArgError("gauge must be a 0x address (40 hex characters)");
      return { path: "/api/gauge-history", params: { chain: chain(a), gauge: a.gauge } };
    },
  },
  {
    name: "allocation_fee",
    description: "The ETH an allocation to another chain costs on Base (a cross-chain message), read live from Aero's own adapter. Base itself costs nothing extra. Read-only.",
    inputSchema: { type: "object", properties: { chain: { ...chainProp, description: "The destination chain (not Base). " + chainProp.description }, gauges: { type: "integer", minimum: 1, description: "How many gauges on that chain (default 1)." } }, required: ["chain"] },
    request: (a) => {
      const id = chain(a, true);
      if (id === 8453) throw new ArgError("Base is the home chain: no cross-chain fee. Pick another chain.");
      if (a.gauges !== undefined && !(Number.isInteger(a.gauges) && a.gauges >= 1 && a.gauges <= 50)) throw new ArgError("gauges must be a whole number from 1 to 50");
      return { path: "/api/allocation-fee", params: { chain: id, gauges: a.gauges } };
    },
  },
  {
    name: "track_record",
    description:
      "The site's own track record: each day it logs the best split for 10,000 sAERO on Base before the fact, then checks it two days later against what those gauges really paid. Results appear only after 14 checked days; before that it reports how many days are logged. Read-only.",
    inputSchema: { type: "object", properties: {} },
    request: () => ({ path: "/api/track-record", params: {} }),
  },
];

/** Runs one tool call. Returns MCP tool-result content; a bad argument or a failed request is an error result, not a thrown exception. */
export async function callTool(name, args, { baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = {}) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  let req;
  try {
    req = tool.request(args && typeof args === "object" ? args : {});
  } catch (e) {
    if (e instanceof ArgError) return { isError: true, content: [{ type: "text", text: e.message }] };
    throw e;
  }
  const url = new URL(req.path, baseUrl);
  for (const [k, v] of Object.entries(req.params)) if (v !== undefined) url.searchParams.set(k, String(v));
  try {
    const res = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "aeroallocator-mcp/0.1" }, signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    if (!res.ok) return { isError: true, content: [{ type: "text", text: `aeroallocator.app answered ${res.status}: ${text.slice(0, 400)}` }] };
    return { content: [{ type: "text", text }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `Could not reach aeroallocator.app: ${e instanceof Error ? e.message : String(e)}` }] };
  }
}
