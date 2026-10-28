import { withApiErrorHandling } from "@/lib/api-error";
import { CROSS_CHAIN_PLAN_PRICE_USD, handleCrossChainPlan } from "@/lib/v1-cross-chain-plan";
import { paidRoute } from "@/lib/x402";

export const maxDuration = 60;

export const GET = paidRoute(
  {
    path: "/api/v1/cross-chain-plan",
    priceUsd: CROSS_CHAIN_PLAN_PRICE_USD,
    // Coinbase's facilitator rejects a payment whose resource description is over 500 characters (measured 2026-10-28: 500 passes its schema check,
    // 520 does not), so keep this short. lib/paid-routes.test.ts enforces it for every paid route.
    description:
      "Ordered, ready-to-sign Aero allocate() transactions that spread an sAERO position over gauges on several chains (Base, Ethereum, OP, " +
      "Arbitrum, Ink, Robinhood, Arc): the best split after each extra chain's ETH cost, or the percentages you give (?chains=5042:30,10:20). " +
      "Plans from the position's state on every chain, with the ETH to attach, what each step waits for and a simulation of step 1. " +
      "Never signs or sends. Pass ?tokenId=.",
    tags: ["aero", "aerodrome", "saero", "defi", "base", "calldata", "allocation", "cross-chain"],
    discovery: {
      input: { tokenId: "15308", chains: "5042:30,10:20" },
      inputSchema: {
        properties: {
          tokenId: { type: "string", description: "sAERO position id (a whole number). Required." },
          chains: { type: "string", description: "Percent of the position per chain other than Base, e.g. 5042:30,10:20 (Arc 30%, OP 20%); Base keeps the rest. Leave out for the best split over all chains." },
          days: { type: "string", description: "Days the one-off ETH fees are weighed against when choosing the best split, 1 to 90 (default: the allocation wait). Ignored when chains is given." },
        },
        required: ["tokenId"],
      },
      output: {
        example: {
          tokenId: "15308",
          sendFrom: "0xf325…C2ED",
          mode: "chains",
          targets: [{ chainId: 5042, name: "Arc", pct: 30, gauges: [{ gauge: "0xD74d…C0f3", symbol: "WETH/USDC", pct: 30 }] }],
          steps: [{ index: 1, kind: "send", transaction: { chainId: 8453, to: "0x49d7d4f17Ec56Ef8fA04E464AF5D1A4942CC31e6", data: "0x…", value: "916698101068829" }, canSendNow: true, blockedBy: [], simulation: { ok: true, gasEstimate: "1106323" } }],
          warnings: [],
        },
      },
    },
  },
  withApiErrorHandling("v1/cross-chain-plan", handleCrossChainPlan),
);
