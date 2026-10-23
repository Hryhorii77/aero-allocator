import { describe, expect, it } from "vitest";
import { AERO_CHAINS, BASE_CHAIN, chainById, lookbackBlocks } from "./aero-chains";
import { FACTORY_REGISTRY_BASE } from "./gauges";

describe("AERO_CHAINS", () => {
  it("has unique ids and keys, Base first, and viem chain ids that agree", () => {
    expect(new Set(AERO_CHAINS.map((c) => c.id)).size).toBe(AERO_CHAINS.length);
    expect(new Set(AERO_CHAINS.map((c) => c.key)).size).toBe(AERO_CHAINS.length);
    expect(AERO_CHAINS[0]).toBe(BASE_CHAIN);
    for (const c of AERO_CHAINS) expect(c.chain.id).toBe(c.id);
  });
  it("gives every non-Base chain a public RPC and keeps the Base registry constant in sync", () => {
    for (const c of AERO_CHAINS.filter((x) => x.id !== BASE_CHAIN.id)) expect(c.rpcs.length).toBeGreaterThan(0);
    expect(FACTORY_REGISTRY_BASE).toBe(BASE_CHAIN.registry);
  });
  it("looks chains up by id", () => {
    expect(chainById(10)?.name).toBe("OP");
    expect(chainById(5042)).toBeUndefined();
  });
  it("measures fee pace on every chain it reads, each with a node that was tested to serve the logs", () => {
    expect(AERO_CHAINS.filter((c) => c.feeLogs).map((c) => c.key)).toEqual(["base", "ethereum", "optimism", "arbitrum", "ink", "robinhood"]);
    for (const c of AERO_CHAINS) expect(c.blockSec).toBeGreaterThan(0);
  });
  it("uses the log nodes found to serve deep history, not the ones that refuse it", () => {
    // publicnode only serves recent Arbitrum blocks ("archive requests require a paid plan"); Ink's default node caps queries at 1,000 blocks.
    expect(chainById(42161)!.logRpcs).toEqual(["https://arb1.arbitrum.io/rpc"]);
    expect(chainById(57073)!.logRpcs).toEqual(["https://rpc-qnd.inkonchain.com"]);
    for (const c of AERO_CHAINS) {
      if (c.logSpan) expect(c.logSpan).toBeLessThanOrEqual(50_000);
      if (c.logAddresses) expect(c.logAddresses).toBeGreaterThan(0);
    }
  });
  it("turns a backfill in hours into blocks with the chain's own block time, else uses the default", () => {
    expect(lookbackBlocks(chainById(57073)!, 9_500n)).toBe(86_400n);
    expect(lookbackBlocks(chainById(42161)!, 9_500n)).toBe(BigInt(Math.round(86_400 / 0.295)));
    expect(lookbackBlocks(chainById(8453)!, 9_500n)).toBe(9_500n);
  });
});
