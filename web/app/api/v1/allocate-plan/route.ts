import { withApiErrorHandling } from "@/lib/api-error";
import { ALLOCATE_PLAN_PRICE_USD, handleAllocatePlan } from "@/lib/v1-allocate-plan";
import { paidRoute } from "@/lib/x402";

export const maxDuration = 60;

export const GET = paidRoute(
  {
    path: "/api/v1/allocate-plan",
    priceUsd: ALLOCATE_PLAN_PRICE_USD,
    description:
      "Ready-to-sign, already-simulated Aero allocate() transaction for an sAERO position: the best split of Base gauges for its size " +
      "(fees plus incentives, after its own dilution) as unsigned calldata for the Voter, with the cooldown, expected USD per day versus " +
      "now, and warnings. Handles the contract's rules (full overwrite, exact total, ascending addresses, idle power). Never signs or sends. " +
      "Base only. Pass ?tokenId=.",
    tags: ["aero", "aerodrome", "saero", "defi", "base", "calldata", "allocation"],
    discovery: {
      input: { tokenId: "15308", maxGauges: "4" },
      inputSchema: {
        properties: {
          tokenId: { type: "string", description: "sAERO position id (a whole number). Required." },
          maxGauges: { type: "string", description: "Most gauges the split may use, 1 to 6 (default 6). Fewer gauges means fewer entries to sign for." },
        },
        required: ["tokenId"],
      },
      output: {
        example: {
          tokenId: "15308",
          sendFrom: "0xf325…C2ED",
          transaction: { chainId: 8453, to: "0x49d7d4f17Ec56Ef8fA04E464AF5D1A4942CC31e6", data: "0x…", value: "0" },
          simulation: { ok: true, gasEstimate: "835802" },
          picks: [{ gauge: "0xCBa7452690663D6789C0115fe889C9da85Bf8c56", symbol: "USDC/cbZEC", pct: 100, allocated: "90470000000000000000", usdPerDay: 0.04 }],
          expectedUsdPerDay: 0.04,
          warnings: [],
        },
      },
    },
  },
  withApiErrorHandling("v1/allocate-plan", handleAllocatePlan),
);
