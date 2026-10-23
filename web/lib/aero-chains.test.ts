import { describe, expect, it } from "vitest";
import { AERO_CHAINS, BASE_CHAIN, chainById } from "./aero-chains";
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
});
