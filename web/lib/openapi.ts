import { ALLOCATE_PLAN_PRICE_USD } from "./v1-allocate-plan";
import { POSITION_PRICE_USD } from "./v1-position";

/** USDC on Base: what the paid routes ask to be paid in. */
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_NETWORK = "eip155:8453";

type Json = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const num = (description: string) => ({ type: "number", description });
const str = (description: string) => ({ type: "string", description });
const nullable = (schema: Json) => ({ ...schema, type: [schema.type as string, "null"] });

const chainParam = {
  name: "chain",
  in: "query",
  required: true,
  description: "Chain id: 8453 Base, 1 Ethereum, 10 OP, 42161 Arbitrum, 57073 Ink, 4663 Robinhood Chain, 5042 Arc.",
  schema: { type: "integer", enum: [8453, 1, 10, 42161, 57073, 4663, 5042] },
  example: 8453,
};

const jsonBody = (schema: Json, description: string) => ({ description, content: { "application/json": { schema } } });
const errorResponses = (extra: Json = {}) => ({
  "400": { ...jsonBody(ref("Error"), "A malformed request. Never charged."), },
  ...extra,
});

/** What the paid routes answer to a request that carries no payment (x402 v2). */
const paymentRequired = {
  description:
    "Payment required. The PAYMENT-REQUIRED response header carries the payment options as base64 JSON (x402 v2: scheme exact, network eip155:8453, USDC amount in 6-decimal base units, payTo address). Pay with any x402 client and retry the same request with the payment attached.",
  headers: { "PAYMENT-REQUIRED": { description: "Base64-encoded JSON payment requirements.", schema: { type: "string" } } },
  content: { "application/json": { schema: { type: "object" } } },
};

const paymentInfo = (priceUsd: number, payTo: string | undefined) => ({
  protocol: "x402",
  scheme: "exact",
  network: BASE_NETWORK,
  asset: BASE_USDC,
  assetSymbol: "USDC",
  priceUsd,
  amount: String(Math.round(priceUsd * 1e6)),
  ...(payTo ? { payTo } : {}),
  chargedOnlyOnSuccess: true,
});

/**
 * The OpenAPI description served at /openapi.json: the free reads and the two paid x402 routes, with the real request parameters, the
 * response shapes, and the 402 behaviour. Prices come from the routes' own constants so this can't drift from what is charged. `payTo`
 * is the public payout address (also in every 402 challenge); it is left out when the deployment has none configured.
 */
export function openApiSpec(siteUrl: string, payTo?: string): Json {
  const spec = buildSpec(siteUrl, payTo);
  // Free reads need nothing; the paid routes need an x402 payment (declared as a header scheme so tools that read `security` see it).
  for (const item of Object.values(spec.paths as Record<string, { get: Json }>)) item.get.security = item.get["x-payment-info"] ? [{ x402: [] }] : [];
  return spec;
}

function buildSpec(siteUrl: string, payTo?: string): Json & { paths: Json } {
  const gaugeParam = { name: "gauge", in: "query", required: true, description: "The gauge's address.", schema: str("0x… address") };
  const tokenId = {
    name: "tokenId",
    in: "query",
    required: false,
    description: "sAERO position id (a whole number). Pass this or address, not both.",
    schema: { type: "string", pattern: "^[0-9]{1,20}$" },
    example: "15308",
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Aero Allocator",
      version: "1.0.0",
      summary: "Where an amount of sAERO earns the most on Aero, a position's advice, and the unsigned allocate() transaction.",
      description:
        "Aero replaced weekly veAERO voting with continuous sAERO allocation on 2026-10-22. These APIs rank Aero gauges by what an amount of sAERO voting power would earn per day (fees plus incentives, after the amount dilutes the gauge), say what a specific position earns now versus the best split, and return the unsigned allocate() transaction. Non-custodial: nothing here holds keys, signs or sends a transaction. The free reads are rate limited. The two /api/v1 routes are paid per call in USDC on Base over x402, with no account or API key; a call that is rejected (400, 404, 422) is never charged. Figures are estimates from a recent fee pace, not promises, and not financial advice.",
      license: { name: "MIT", identifier: "MIT" },
      contact: { name: "Aero Allocator", url: siteUrl },
    },
    externalDocs: { description: "Description for agents", url: `${siteUrl}/llms.txt` },
    servers: [{ url: siteUrl }],
    paths: {
      "/api/gauges": {
        get: {
          operationId: "listGauges",
          summary: "Every Aero gauge on a chain",
          description: "Weight, share of weight, emission cap and incentives streaming now. The Base list also carries cooldownSec, the live wait between allocations of one position.",
          parameters: [chainParam],
          responses: { "200": jsonBody(ref("GaugeList"), "The gauges, heaviest first."), ...errorResponses() },
        },
      },
      "/api/gauge-fees": {
        get: {
          operationId: "gaugeFees",
          summary: "Estimated fees per day per gauge",
          description: "Measured from on-chain fee releases over a recent window, with the hours of history behind each figure, how steady the payouts were, and a spike marker when the recent pace is a burst far above the gauge's usual level. Gauges with no measurable pace are left out.",
          parameters: [chainParam],
          responses: { "200": jsonBody(ref("GaugeFees"), "Fee pace per gauge."), ...errorResponses() },
        },
      },
      "/api/gauge-history": {
        get: {
          operationId: "gaugeHistory",
          summary: "One gauge's history",
          description: "Fees released per 6 hours, weight snapshots, how steady the payouts were, and a daily record of fees, power and incentives for up to 90 days.",
          parameters: [chainParam, gaugeParam],
          responses: {
            "200": jsonBody(ref("GaugeHistory"), "The gauge's history."),
            ...errorResponses({ "404": jsonBody(ref("Error"), "No such gauge on this chain.") }),
          },
        },
      },
      "/api/gauge-flows": {
        get: {
          operationId: "gaugeFlows",
          summary: "Which gauges are gaining or losing allocation weight",
          description: "Share-of-weight change over the stored snapshots (about the last day), and gauges whose incentives appeared inside that window. Empty until two hours of snapshots exist.",
          parameters: [chainParam],
          responses: { "200": jsonBody(ref("GaugeFlows"), "Weight movers and new incentives."), ...errorResponses() },
        },
      },
      "/api/allocation-fee": {
        get: {
          operationId: "allocationFee",
          summary: "ETH cost on Base of allocating to another chain",
          description: "Read live from Aero's own message adapter. Information only: nothing here sends.",
          parameters: [
            { ...chainParam, description: "The destination chain (not Base).", example: 10 },
            { name: "gauges", in: "query", required: false, description: "How many gauges on that chain (default 1).", schema: { type: "integer", minimum: 1 }, example: 2 },
            { name: "model", in: "query", required: false, description: "Pass 1 for the straight-line cost of any number of gauges instead of one quote: chainStep + gaugeBase + perGauge x gauges, and the return cost.", schema: { type: "string", enum: ["1"] } },
          ],
          responses: { "200": jsonBody({ anyOf: [ref("AllocationFee"), ref("AllocationFeeModel")] }, "The cost in wei, as decimal strings."), ...errorResponses() },
        },
      },
      "/api/all-chains-split": {
        get: {
          operationId: "allChainsSplit",
          summary: "Best split of an amount over every Aero chain, after the ETH each extra chain costs",
          description:
            "Tries every set of chains and returns the one that earns the most over the horizon once the one-off ETH fee to reach each extra chain is taken off, next to Base alone. Read-only: nothing here sends or signs. Estimates, not financial advice.",
          parameters: [
            { name: "amount", in: "query", required: true, description: "Voting power to place, in whole sAERO power (above 0).", schema: { type: "number", exclusiveMinimum: 0 }, example: 100000 },
            { name: "days", in: "query", required: false, description: "Days the fees are weighed against, 1 to 90. Default: the allocation wait.", schema: { type: "number", minimum: 1, maximum: 90 }, example: 30 },
          ],
          responses: { "200": jsonBody(ref("AllChainsSplit"), "The best set of chains and the Base-only comparison."), ...errorResponses() },
        },
      },
      "/api/token-prices": {
        get: {
          operationId: "tokenPrices",
          summary: "USD prices for up to 12 Base token addresses",
          parameters: [{ name: "tokens", in: "query", required: true, description: "Comma-separated Base token addresses (up to 12).", schema: { type: "string" }, example: BASE_USDC }],
          responses: { "200": jsonBody(ref("TokenPrices"), "Prices by lowercase address."), ...errorResponses() },
        },
      },
      "/api/v1/position": {
        get: {
          operationId: "position",
          summary: `Where a sAERO position stands (paid, $${POSITION_PRICE_USD.toFixed(2)})`,
          description:
            "A position's power and lock, idle versus allocated power, when it can next be re-allocated, what it earns per day now versus the best split of Base gauges for its own size (fees plus incentives, with its own power taken out of each gauge first), and a stay / switch / allocate / unknown recommendation. A switch is only recommended when it beats staying by 5% and $0.05/day and rests on at least 6 hours of fee history. Read-only. Pass exactly one of tokenId or address.",
          parameters: [
            tokenId,
            { name: "address", in: "query", required: false, description: "A 0x… wallet address holding sAERO positions (the first 10 are analysed). Pass this or tokenId, not both.", schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } },
          ],
          "x-payment-info": paymentInfo(POSITION_PRICE_USD, payTo),
          responses: {
            "200": jsonBody(ref("PositionReport"), "The analysed position or positions."),
            "402": paymentRequired,
            "400": jsonBody(ref("Error"), "Neither or both of tokenId and address, or a malformed value. Never charged."),
            "404": jsonBody(ref("Error"), "No such position, or the address holds none. Never charged."),
          },
        },
      },
      "/api/v1/allocate-plan": {
        get: {
          operationId: "allocatePlan",
          summary: `The unsigned allocate() transaction for the best split (paid, $${ALLOCATE_PLAN_PRICE_USD.toFixed(2)})`,
          description:
            "For one position: the unsigned allocate() call (to, data, value on chain 8453) for the best split of Base gauges, already simulated as the owner (simulation.ok, or the plain reason it would be rejected), with the cooldown, expected USD per day versus now, and warnings. Sign and send it from sendFrom; this service never signs or sends. Base only.",
          parameters: [
            { ...tokenId, required: true, description: "sAERO position id (a whole number)." },
            { name: "maxGauges", in: "query", required: false, description: "Most gauges the split may use, 1 to 6 (default 6). Fewer gauges means fewer entries to sign for.", schema: { type: "integer", minimum: 1, maximum: 6 }, example: 4 },
          ],
          "x-payment-info": paymentInfo(ALLOCATE_PLAN_PRICE_USD, payTo),
          responses: {
            "200": jsonBody(ref("AllocatePlan"), "The plan and the unsigned transaction."),
            "402": paymentRequired,
            "400": jsonBody(ref("Error"), "A malformed tokenId or maxGauges. Never charged."),
            "404": jsonBody(ref("Error"), "No such position. Never charged."),
            "422": jsonBody(ref("Error"), "No Base gauge has a measurable fee pace right now, so there is no split to plan. Never charged."),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        x402: {
          type: "apiKey",
          in: "header",
          name: "PAYMENT-SIGNATURE",
          description:
            "Not a key: an x402 v2 payment. Make the request once with no header to get 402 and the payment options in the PAYMENT-REQUIRED header, sign a USDC payment for them with an x402 client, and send the request again with the signed payment in this header. The PAYMENT-RESPONSE response header carries the settlement.",
        },
      },
      schemas: {
        Error: { type: "object", required: ["error"], properties: { error: str("What was wrong.") } },
        GaugeList: {
          type: "object",
          required: ["chainId", "generatedAt", "totalWeight", "gauges"],
          properties: {
            chainId: { type: "integer" },
            generatedAt: num("Unix milliseconds."),
            totalWeight: num("Total allocation weight on the chain, whole tokens."),
            cooldownSec: num("Base list only: the wait between allocations of one position, seconds."),
            gauges: { type: "array", items: ref("Gauge") },
          },
        },
        Gauge: {
          type: "object",
          properties: {
            gauge: str("Gauge address."),
            pool: str("Pool address."),
            symbol: str("Pool symbol, e.g. USDC/cbZEC."),
            weight: num("Allocation weight in whole AERO-equivalent power."),
            sharePct: num("Share of all gauge weight on this chain, 0-100."),
            capPerWeek: num("Emission cap in AERO per week; 0 when none is reported."),
            activated: { type: "boolean" },
            incentivesUsdPerWeek: num("Incentives streaming now, USD per week."),
            incentivesUsdPer1k: num("Incentives per 1,000 of allocated power per week."),
            poolType: str('"CL100" (concentrated liquidity, by tick spacing), "stable" or "volatile"; may be empty.'),
            feePct: nullable(num("Current fee of a concentrated-liquidity pool in percent; null for classic pools.")),
          },
        },
        GaugeFees: {
          type: "object",
          required: ["chainId", "generatedAt", "windowHours", "fees"],
          properties: {
            chainId: { type: "integer" },
            generatedAt: num("Unix milliseconds."),
            windowHours: num("Hours of fee history the record covers."),
            aeroUsd: nullable(num("AERO's price in USD, for turning USD per day into an APR.")),
            fees: { type: "array", items: ref("GaugeFee") },
          },
        },
        GaugeFee: {
          type: "object",
          required: ["gauge", "feesUsdPerDay", "windowHours"],
          properties: {
            gauge: str("Gauge address."),
            feesUsdPerDay: num("Fees to voters, USD per day, averaged over windowHours."),
            windowHours: num("Hours of history the pace rests on."),
            steady: { type: "object", description: "Present once there are three complete half-days.", properties: { buckets: { type: "integer" }, paying: { type: "integer", description: "How many half-days paid at least half the average one." } } },
            spike: { type: "object", description: "Present when the pace is at least three times the gauge's usual level.", properties: { typicalUsdPerDay: num("The gauge's usual fees per day (median half-day, scaled).") } },
          },
        },
        GaugeHistory: {
          type: "object",
          properties: {
            chainId: { type: "integer" },
            gauge: str("Gauge address."),
            generatedAt: num("Unix milliseconds."),
            fees: { type: "array", description: "Fees released per 6 hours, oldest first, complete stretches only.", items: { type: "object", properties: { t: num("Start of the stretch, unix seconds."), usd: num("Fees released in it, USD.") } } },
            weights: { type: "array", items: { type: "object", properties: { t: num("Unix seconds."), weight: num("Whole tokens.") } } },
            flow: { type: ["object", "null"], description: "Share-of-weight change over the snapshot window, when there is one." },
            steady: { type: ["object", "null"], properties: { buckets: { type: "integer" }, paying: { type: "integer" } } },
            daily: {
              type: "array",
              description: "One point per finished UTC day, up to 90, oldest first.",
              items: { type: "object", properties: { t: num("Start of the day, unix seconds."), feesUsd: num("Fees released that day, USD."), weight: nullable(num("The gauge's power that day.")), incentivesUsdPerWeek: nullable(num("Incentives streaming that day, USD per week.")) } },
            },
          },
        },
        GaugeFlows: {
          type: "object",
          properties: {
            chainId: { type: "integer" },
            spanHours: num("Hours between the oldest compared snapshot and now."),
            flows: { type: "array", items: { type: "object", properties: { gauge: str("Gauge address."), sharePctChange: num("Change in share of weight, percent."), powerChange: num("Power added (or removed) in the window."), weight: num("Current weight.") } } },
            newIncentives: { type: "array", items: { type: "object", properties: { gauge: str("Gauge address."), usdPerWeek: num("Incentives now, USD per week."), withinHours: num("They appeared within this many hours.") } } },
          },
        },
        AllocationFee: {
          type: "object",
          properties: {
            chainId: { type: "integer" },
            gauges: { type: "integer" },
            chainStep: str("Wei, decimal string."),
            gaugeStep: str("Wei, decimal string."),
            total: str("Wei, decimal string: the ETH needed on Base to send this allocation."),
            returnCost: str("Wei, decimal string: a further charge moving it back can carry."),
          },
        },
        AcrossChains: {
          type: "object",
          properties: {
            chains: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  chainId: { type: "integer" },
                  name: { type: "string" },
                  pct: { type: "number", description: "Share of the whole amount on this chain, 0-100." },
                  usdPerDay: { type: "number" },
                  feeUsd: { type: "number", description: "One-off ETH cost of sending power here, in USD (0 on Base)." },
                  parts: { type: "array", items: { type: "object", properties: { symbol: { type: "string" }, gauge: { type: "string" }, pct: { type: "number" }, usdPerDay: { type: "number" } } } },
                },
              },
            },
            usdPerDay: { type: "number" },
            feeUsd: { type: "number" },
            netUsd: { type: "number", description: "Earned over the horizon minus the one-off fees." },
            weakestHours: { type: "number" },
            spiky: { type: "boolean" },
            confidence: { type: "string", enum: ["thin", "fair", "solid", "spiky"] },
          },
        },
        AllChainsSplit: {
          type: "object",
          properties: {
            amount: { type: "number" },
            days: { type: "number", description: "The horizon the fees are weighed against." },
            ethUsd: { type: ["number", "null"] },
            generatedAt: { type: "integer", description: "Oldest fee read among the chains used, ms since epoch." },
            best: ref("AcrossChains"),
            baseOnly: { anyOf: [ref("AcrossChains"), { type: "null" }] },
            skipped: { type: "array", items: { type: "string" }, description: "Chains left out because they could not be read just now." },
          },
        },
        AllocationFeeModel: {
          type: "object",
          properties: {
            chainId: { type: "integer" },
            chainStep: str("Wei, decimal string: the step that moves power to the chain."),
            gaugeBase: str("Wei, decimal string: the fixed part of a gauge step."),
            perGauge: str("Wei, decimal string: each gauge adds this to a gauge step."),
            returnCost: str("Wei, decimal string: what the chain keeps when a dispatch returns power to idle."),
          },
        },
        TokenPrices: { type: "object", properties: { prices: { type: "object", additionalProperties: { type: "number" }, description: "USD price by lowercase token address." } } },
        Split: {
          type: "object",
          properties: {
            usdPerDay: num("Total USD per day of the split."),
            aprPct: nullable(num("Per unit of voting power, in percent.")),
            parts: { type: "array", items: { type: "object", properties: { gauge: str("Gauge address."), symbol: str("Pool symbol."), pct: num("Share of the amount, 0-100."), usdPerDay: num("What that part earns per day.") } } },
          },
        },
        Advice: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["stay", "switch", "allocate", "none", "unknown"] },
            reason: str("Plain words for a person or an agent's log."),
            canActNow: { type: "boolean", description: "True when the wait is over, or the position was never allocated." },
            readyAt: nullable(str("ISO time the wait ends, or null.")),
          },
        },
        Position: {
          type: "object",
          properties: {
            tokenId: str("Position id."),
            owner: str("Owner address."),
            votingPower: num("Voting power, whole tokens."),
            staked: num("AERO staked, whole tokens."),
            permanent: { type: "boolean" },
            lockEndsAt: nullable(str("ISO time, or null for a permanent lock.")),
            idlePower: num("Power not allocated."),
            onBasePower: num("Power allocated on Base."),
            cooldown: { type: "object", properties: { ready: { type: "boolean" }, readyAt: nullable(str("ISO time.")), secondsLeft: { type: "integer" } } },
            currentGauges: { type: "array", items: { type: "object", properties: { gauge: str("Gauge address."), symbol: str("Pool symbol."), pct: num("Share of the Base allocation.") } } },
            currentUsdPerDay: nullable(num("What it earns now; null when none of its gauges can be priced.")),
            currentAprPct: nullable(num("Per unit of voting power.")),
            unpricedGauges: { type: "array", items: { type: "string" } },
            bestSplit: { anyOf: [ref("Split"), { type: "null" }] },
            gainUsdPerDay: nullable(num("Best split minus staying.")),
            advice: ref("Advice"),
            confidence: nullable({ type: "string", enum: ["thin", "fair", "solid"], description: "How much fee history the best split rests on." }),
            feeHistoryHours: num("Hours of fee history behind the weakest gauge the best split uses."),
          },
        },
        PositionReport: {
          type: "object",
          properties: {
            generatedAt: str("ISO time."),
            chainId: { type: "integer" },
            cooldownSeconds: { type: "integer" },
            aeroUsd: nullable(num("AERO's USD price.")),
            feesReadAt: nullable(str("ISO time the fee figures were read, or null.")),
            positions: { type: "array", items: ref("Position") },
            truncated: { type: "object", description: "Present when an address holds more than 10 positions.", properties: { total: { type: "integer" }, returned: { type: "integer" }, note: { type: "string" } } },
            basis: str("How the figures are made."),
          },
        },
        AllocatePlan: {
          type: "object",
          properties: {
            generatedAt: str("ISO time."),
            tokenId: str("Position id."),
            owner: str("Owner address."),
            sendFrom: str("Sign and send the transaction from this address."),
            transaction: { type: "object", description: "The unsigned allocate() call.", properties: { chainId: { type: "integer", const: 8453 }, to: { type: "string" }, data: { type: "string" }, value: { type: "string", const: "0" } } },
            simulation: { type: "object", description: "ok true, or ok false with the plain reason the call would be rejected." },
            cooldown: { type: "object", properties: { ready: { type: "boolean" }, readyAt: nullable(str("ISO time.")) } },
            picks: { type: "array", items: { type: "object", properties: { gauge: str("Gauge address."), symbol: str("Pool symbol."), pct: num("Share, 0-100."), allocated: str("Base units (18 decimals), decimal string."), allocatedTokens: str("Whole tokens."), usdPerDay: num("What this pick earns per day.") } } },
            idleKeptOnBase: str("Base units."),
            movesFromIdle: str("Base units."),
            baseTotal: str("Base units."),
            expectedUsdPerDay: num("The best split's USD per day."),
            currentUsdPerDay: nullable(num("What the position earns now.")),
            gainUsdPerDay: nullable(num("Best split minus staying.")),
            advice: { type: "object", properties: { action: { type: "string" }, reason: { type: "string" } } },
            confidence: nullable({ type: "string", enum: ["thin", "fair", "solid"] }),
            feeHistoryHours: num("Hours of fee history behind the weakest gauge in the split."),
            warnings: { type: "array", items: { type: "string" } },
            notes: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  };
}
