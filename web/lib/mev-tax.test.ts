import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { readMevTaxedPools } from "./mev-tax";

const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const [CL1, CL2, CLASSIC, CL_OVERRIDE] = [a(1), a(2), a(3), a(4)];
const [CL_FACTORY, POOL_FACTORY, HOOK, HOOK2, LIVE, OFF] = [a(10), a(11), a(20), a(21), a(30), a(31)];
const ZERO = a(0);

/** A fake chain: CL pools share HOOK (module LIVE), CL_OVERRIDE uses HOOK2 (module OFF, multiplier 0), the classic factory has none. */
function client(opts: { liveMultiplier?: bigint; throws?: boolean } = {}) {
  const answer = (address: Address, fn: string, args?: readonly unknown[]): unknown => {
    if (fn === "factory") return address === CLASSIC ? POOL_FACTORY : CL_FACTORY;
    if (fn === "getPoolSwapHook") return args![0] === CL_OVERRIDE ? HOOK2 : HOOK;
    if (fn === "mevTaxModule") return address === HOOK ? LIVE : address === HOOK2 ? OFF : ZERO;
    if (fn === "priorityFeeMultiplier") return address === LIVE ? (opts.liveMultiplier ?? 5_000_000n) : 0n;
    throw new Error(fn);
  };
  return {
    multicall: async ({ contracts }: { contracts: Array<{ address: Address; functionName: string; args?: readonly unknown[] }> }) => {
      if (opts.throws) throw new Error("node down");
      return contracts.map((c) => ({ status: "success", result: answer(c.address, c.functionName, c.args) }));
    },
  } as never;
}

const pools = [
  { pool: CL1, concentrated: true },
  { pool: CL2, concentrated: true },
  { pool: CLASSIC, concentrated: false },
  { pool: CL_OVERRIDE, concentrated: true },
];

describe("readMevTaxedPools", () => {
  it("tags pools whose hook's module has a non-zero multiplier, and not a module set to 0 or a factory with none", async () => {
    expect([...(await readMevTaxedPools(client(), pools))].sort()).toEqual([CL1, CL2]);
  });
  it("tags nothing when the live module's multiplier is 0 (attached but switched off)", async () => {
    expect((await readMevTaxedPools(client({ liveMultiplier: 0n }), pools)).size).toBe(0);
  });
  it("never throws: a failing node just leaves the tag off", async () => {
    expect((await readMevTaxedPools(client({ throws: true }), pools)).size).toBe(0);
    expect((await readMevTaxedPools(client(), [])).size).toBe(0);
  });
});
