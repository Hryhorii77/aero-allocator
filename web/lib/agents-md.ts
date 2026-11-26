// /AGENTS.md: the "read me first" page for AI agents, modelled on base.org/AGENTS.md. Built here from the code's own lists, never
// typed by hand: the chains and their registries from AERO_CHAINS, the sAERO contracts from saero.ts, the paid prices from
// paid-prices.ts, and the free and paid endpoint lists from llms-txt.ts (so the two documents can't disagree). The route
// app/AGENTS.md/route.ts serves it; scripts/generate-agents-md.ts writes the same text to web/docs/agents/ so the repo shows it.
// Not public/: a file there would collide with the route of the same path and lose its CORS and cache headers. Not web/AGENTS.md
// either: that file is Next.js's rules for coding agents, rewritten by `next dev`.
import { AERO_CHAINS } from "./aero-chains";
import { chainList, GENERATED_DIR, llmsTxt, REPO_URL, TAGLINE } from "./llms-txt";
import { ALLOCATE_PLAN_PRICE_USD, CROSS_CHAIN_PLAN_PRICE_USD, POSITION_PRICE_USD } from "./paid-prices";
import { DISPLAY_PRESET } from "./protocol";
import { AERO_TOKEN, SAERO, SAERO_CHAIN_ID } from "./saero";

/** Pages and documents that exist in app/ (a test checks each has a page or route file). */
export const SITE_ROUTES: Array<{ path: string; file: string; what: string }> = [
  { path: "/", file: "app/page.tsx", what: "The allocator: the best split of gauges for an amount, the gauge table per chain or all networks, your positions (read in your browser) and the allocate, return and across-chains flows signed in your own wallet" },
  { path: "/track-record", file: "app/track-record/page.tsx", what: "The site's own track record: each day's recommended split for 10,000 sAERO, logged before the fact, against what it really paid" },
  { path: "/llms.txt", file: "app/llms.txt/route.ts", what: "The short plain-text version of this document" },
  { path: "/AGENTS.md", file: "app/AGENTS.md/route.ts", what: "This document" },
  { path: "/openapi.json", file: "app/openapi.json/route.ts", what: "OpenAPI 3.1 description of the free reads and the paid x402 routes" },
];

/** The MCP package's tools, in packages/mcp/src/tools.mjs order (a test compares the two). */
export const MCP_TOOLS = ["top_gauges", "best_split_all_chains", "power_flows", "gauge_history", "allocation_fee", "track_record"] as const;

/** The agent skills under skills/ (a test checks each folder exists). */
export const SKILLS = [
  { name: "saero-allocator-automator", what: "decides when re-allocating a position is worth it and checks an allocate-plan before handing it to the owner's wallet" },
  { name: "veaero-to-saero-upgrade", what: "checks and prepares a veAERO to sAERO upgrade (read-only checker; the upgrade itself is irreversible and signed by the owner)" },
] as const;

/** One section of /llms.txt, from its heading up to the next one, so both documents list the same endpoints. */
function llmsSection(t: string, heading: string): string {
  const start = t.indexOf(`\n${heading}`);
  if (start < 0) throw new Error(`llms.txt has no "${heading}" section`);
  const end = t.indexOf("\n## ", start + 1);
  return t.slice(t.indexOf("\n", start + 1) + 1, end < 0 ? undefined : end).trim();
}

export function buildAgentsMd(siteUrl: string): string {
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const llms = llmsTxt(siteUrl);
  const saeroChain = AERO_CHAINS.find((c) => c.id === SAERO_CHAIN_ID)!;
  const explorer = (c: (typeof AERO_CHAINS)[number]) => c.chain.blockExplorers?.default.url ?? "";
  const baseExplorer = explorer(saeroChain);
  const addr = (a: string) => (baseExplorer ? `[\`${a}\`](${baseExplorer}/address/${a})` : `\`${a}\``);
  const rpcsOf = (c: (typeof AERO_CHAINS)[number]) => (c.id === SAERO_CHAIN_ID ? [DISPLAY_PRESET.defaultRpcUrl, DISPLAY_PRESET.fallbackRpcUrl] : c.rpcs);

  return [
    `# ${DISPLAY_PRESET.appName}`,
    "",
    `> ${TAGLINE}`,
    "",
    "Read me first if you are an AI agent. This page says what the app does, which chains and contracts it uses, how to read it for free, what costs money, and the rules to follow when you act for a person.",
    "",
    `- Site: ${siteUrl}`,
    `- Source: ${REPO_URL}`,
    `- Short version: ${siteUrl}/llms.txt`,
    `- OpenAPI: ${siteUrl}/openapi.json`,
    "",
    "## What it does",
    "",
    "- Ranks Aero gauges by what a given amount of sAERO Allocation Power earns per day in each (trading fees plus incentives, after the amount's own dilution of the gauge), and finds the best split over up to a few gauges, on one chain or across all of them after the ETH each extra chain costs.",
    "- Shows a person's sAERO positions. The site reads them in the visitor's browser, so the address never reaches the server.",
    "- Prepares unsigned transactions: allocate on Base, return power to idle, and allocate across chains. The owner signs every one in their own wallet. The wait between two allocations of one position (47 hours at launch) is read live from the chain.",
    "- Keeps a public track record of its own advice against what the gauges really paid.",
    "- Every figure is an estimate from recent on-chain data, not a promise and not financial advice.",
    "- Not offered: claiming rewards (Aero allows it only for a position's operator or its orchestrator), holding funds, or signing anything.",
    "",
    "## Chains",
    "",
    `Aero is multi-chain. Do not describe Aero, or this app, as Base-only. The app serves ${AERO_CHAINS.length} chains: ${chainList()}.`,
    "",
    `sAERO positions themselves live on ${saeroChain.name} (${SAERO_CHAIN_ID}); their Allocation Power can be sent to gauges on any chain below. The paid \`/api/v1/allocate-plan\` is ${saeroChain.name} only; \`/api/v1/cross-chain-plan\` covers every chain.`,
    "",
    "| Chain | Chain id | Aero factory registry | Explorer |",
    "| --- | --- | --- | --- |",
    ...AERO_CHAINS.map((c) => `| ${c.name} | ${c.id} | \`${c.registry}\` | ${explorer(c) || "—"} |`),
    "",
    "## Safety",
    "",
    "- The app never holds keys, never signs and never sends a transaction. Every transaction it prepares is unsigned; only the position's owner signs it, in their own wallet.",
    "- Never ask a person for a seed phrase or private key, and never sign for them.",
    "- Fee figures are a recent pace, not a promise: check `feeHistoryHours` / `confidence` and the low case before acting, and say they are estimates.",
    "- Every allocation restarts the position's wait before it can change again, per position and per chain. Don't suggest moving more often than the gain justifies.",
    "- A paid request that is rejected (400, 404, 422) is never charged.",
    "- Claiming rewards is not offered here.",
    "",
    "## Agent routing rules",
    "",
    "- To rank gauges, compare chains, read a gauge's history, price the ETH to reach another chain or read the track record: use the free reads below, or the MCP server, which wraps the same reads.",
    "- To judge one specific position (its power, current gauges, wait, and stay or switch): use the paid `/api/v1/position`, or read the chain yourself with the contracts below.",
    "- To get transactions ready to sign: use the paid `/api/v1/allocate-plan` (Base gauges) or `/api/v1/cross-chain-plan` (several chains), then hand them to the owner's wallet.",
    "- To decide when to re-allocate on a schedule, or to check a veAERO to sAERO upgrade: use the agent skills.",
    "",
    "## Free reads",
    "",
    // The MCP line at the end of llms.txt's free section has its own section here.
    llmsSection(llms, "## Free").split("\n\nThe same free reads as an MCP server")[0],
    "",
    "Rate limits: each route keeps its own limit in server memory, per instance, usually 10 to 30 calls a minute per IP. In production a Vercel Firewall also limits `/api` per IP. A 429 means wait and retry.",
    "",
    "## MCP server",
    "",
    'A local stdio server, not a remote HTTP MCP: Node 22+, no key, never signs. Add `{ "mcpServers": { "aeroallocator": { "command": "npx", "args": ["-y", "aeroallocator-mcp"] } } }` to your MCP client, or run `npx -y aeroallocator-mcp`.',
    "",
    `Tools: ${MCP_TOOLS.map((t) => `\`${t}\``).join(", ")}. Each makes one GET on the free API above.`,
    "",
    "## Paid routes (x402)",
    "",
    llmsSection(llms, "## Paid"),
    "",
    `Prices: position ${usd(POSITION_PRICE_USD)}, allocate-plan ${usd(ALLOCATE_PLAN_PRICE_USD)}, cross-chain-plan ${usd(CROSS_CHAIN_PLAN_PRICE_USD)}, in USDC on Base. A deployment without its payout address and Coinbase facilitator keys (X402_PAYTO_ADDRESS, CDP_API_KEY_ID, CDP_API_KEY_SECRET) answers these routes with 501 instead of charging.`,
    "",
    "## Agent skills",
    "",
    ...SKILLS.map((s) => `- \`${s.name}\`: ${s.what}. ${REPO_URL}/tree/main/skills/${s.name}`),
    "",
    `Install: \`npx skills add Hryhorii77/aero-allocator --full-depth --skill <name>\`. They never sign or send.`,
    "",
    "## Network and contracts",
    "",
    `sAERO and AERO, on ${saeroChain.name} (${SAERO_CHAIN_ID}):`,
    "",
    `- sAERO escrow (the position NFTs): ${addr(SAERO.votingEscrow)}`,
    `- Voter (\`allocate()\`, the root of every allocation): ${addr(SAERO.voter)}`,
    `- Leaf voter (the same address on every Aero chain): ${addr(SAERO.leafVoter)}`,
    `- AERO token: ${addr(AERO_TOKEN)}`,
    "",
    "Public nodes the app reads through (a person's wallet uses its own):",
    "",
    ...AERO_CHAINS.map((c) => `- ${c.name}: ${rpcsOf(c).join(", ") || "the chain's default"}`),
    "",
    "## Site routes",
    "",
    ...SITE_ROUTES.map((r) => `- \`${r.path}\`: ${r.what}`),
    "",
    "## Generation",
    "",
    `Built by \`web/lib/agents-md.ts\` (with the endpoint lists from \`web/lib/llms-txt.ts\`) from the app's own chain list, contract addresses and prices, and served by \`web/app/AGENTS.md/route.ts\`. The checked copies are \`${GENERATED_DIR}/AGENTS.md\` and \`${GENERATED_DIR}/llms.txt\`: run \`npm run generate-agents-md\` in \`web/\` after a change, and CI fails when they are out of date (\`--check\`). Do not edit them by hand. \`web/AGENTS.md\` is a different file (Next.js's rules for coding agents); never put this document there.`,
    "",
  ].join("\n");
}
