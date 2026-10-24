import { withApiErrorHandling } from "@/lib/api-error";
import { POSITION_PRICE_USD, handlePosition } from "@/lib/v1-position";
import { paidRoute } from "@/lib/x402";

// Gauge, fee and position reads on Base: same ceiling as the other data routes.
export const maxDuration = 60;

export const GET = paidRoute(
  {
    path: "/api/v1/position",
    priceUsd: POSITION_PRICE_USD,
    description:
      "Where an Aero sAERO position stands on Base: its voting power and lock, how much is idle or allocated to gauges, when it can next be " +
      "re-allocated (47-hour cooldown), what it earns per day now versus the best split of gauges for its own size (fees plus incentives, " +
      "after its own dilution), and a stay / switch / allocate recommendation. Pass ?tokenId= or ?address=. Read-only.",
    tags: ["aero", "aerodrome", "saero", "defi", "base", "yield", "allocation"],
    discovery: {
      input: { tokenId: "15308" },
      inputSchema: {
        properties: {
          tokenId: { type: "string", description: "sAERO position id (a whole number). Pass this or address, not both." },
          address: { type: "string", description: "0x… wallet address holding sAERO positions (the first 10 are analysed). Pass this or tokenId, not both." },
        },
      },
      output: {
        example: {
          generatedAt: "2026-10-24T12:00:00.000Z",
          chainId: 8453,
          cooldownSeconds: 169200,
          aeroUsd: 0.76,
          positions: [
            {
              tokenId: "15308",
              votingPower: 90.47,
              cooldown: { ready: false, readyAt: "2026-10-25T16:50:51.000Z", secondsLeft: 3600 },
              currentGauges: [{ gauge: "0xCBa7452690663D6789C0115fe889C9da85Bf8c56", symbol: "USDC/cbZEC", pct: 100 }],
              currentUsdPerDay: 0.03,
              bestSplit: { usdPerDay: 0.04, parts: [{ gauge: "0xCBa7452690663D6789C0115fe889C9da85Bf8c56", symbol: "USDC/cbZEC", pct: 100, usdPerDay: 0.04 }] },
              advice: { action: "stay", canActNow: false },
              confidence: "solid",
            },
          ],
        },
      },
    },
  },
  withApiErrorHandling("v1/position", handlePosition),
);
