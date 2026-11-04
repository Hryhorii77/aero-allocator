import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { AERO_CHAINS } from "./aero-chains";
import { readEarnedAll } from "./earned-read";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RSGP = "0x00000000000000000000000000000000000000a1";
const GAUGE = "0x00000000000000000000000000000000000000b1";
const MGR = "0x00000000000000000000000000000000000000c1";

type Call = { functionName: string; args?: readonly unknown[] };
/** A fake chain: one gauge whose manager has 3 programs (only #3 and #1 earned something) and some fees. */
function fakeClient(opts: { gauges?: string[]; programs?: number; fail?: boolean } = {}) {
  const answer = (c: Call): unknown => {
    switch (c.functionName) {
      case "gaugeToRewards":
        return MGR;
      case "earnedFees":
        return [2_500_000n, 0n];
      case "token0":
        return USDC;
      case "token1":
        return RSGP;
      case "incentiveCount":
        return BigInt(opts.programs ?? 3);
      case "earnedIncentives":
        return c.args![1] === 2n ? 0n : 10n ** 18n;
      case "incentive":
        return { token: RSGP };
      default:
        throw new Error(c.functionName);
    }
  };
  const meta = (c: Call & { address: string }) => (c.functionName === "decimals" ? (c.address === USDC ? 6 : 18) : c.address === USDC ? "USDC" : "RSGP");
  const client = {
    readContract: async () => {
      if (opts.fail) throw new Error("node down");
      return opts.gauges ?? [GAUGE, "0x0000000000000000000000000000000000000000"];
    },
    multicall: async ({ contracts, allowFailure }: { contracts: Array<Call & { address: string }>; allowFailure: boolean }) =>
      contracts.map((c) => {
        const result = c.functionName === "decimals" || c.functionName === "symbol" ? meta(c) : answer(c);
        return allowFailure ? { status: "success", result } : result;
      }),
  };
  return client as unknown as PublicClient;
}

const prices = (async (url: string) => {
  expect(url).not.toContain("15308"); // only token addresses go out
  return new Response(JSON.stringify({ prices: { [USDC]: 1, [RSGP]: 0.5 } }));
}) as unknown as typeof fetch;

describe("readEarnedAll", () => {
  it("adds fees and every program's incentives per chain, skipping chains with no gauges and naming chains that fail", async () => {
    const [base, op, arc] = [AERO_CHAINS[0], AERO_CHAINS.find((c) => c.id === 10)!, AERO_CHAINS.find((c) => c.id === 5042)!];
    const all = await readEarnedAll(15308n, {
      chains: [base, op, arc],
      client: async (cfg) => (cfg.id === 10 ? fakeClient({ gauges: [] }) : cfg.id === 5042 ? fakeClient({ fail: true }) : fakeClient()),
      fetchFn: prices,
    });
    expect(all.skipped).toEqual(["Arc"]);
    expect(all.chains).toHaveLength(1);
    const b = all.chains[0];
    expect(b.name).toBe("Base");
    expect(b.fees.lines).toEqual([{ token: USDC, symbol: "USDC", amount: 2.5, usd: 2.5 }]);
    // programs 3 and 1 earned 1 RSGP each; program 2 earned nothing
    expect(b.incentives.lines).toEqual([{ token: RSGP, symbol: "RSGP", amount: 2, usd: 1 }]);
    expect(all.totalUsd).toBeCloseTo(3.5);
    expect(all.atLeast).toBe(false);
  });
  it("reads only the newest programs on a gauge with very many and then says the total is a floor", async () => {
    const all = await readEarnedAll(1n, { chains: [AERO_CHAINS[0]], client: async () => fakeClient({ programs: 500 }), fetchFn: prices });
    expect(all.atLeast).toBe(true);
  });
});
