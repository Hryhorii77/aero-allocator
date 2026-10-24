import { describe, expect, it, vi } from "vitest";

const read = vi.fn();
vi.mock("./gauges", () => ({ client: () => ({ readContract: read }) }));

import { CHAIN_STEP_GAS, gaugeStepGas, quoteCrossChain } from "./allocate-fee";

describe("gaugeStepGas", () => {
  it("matches the budgets Aero's own app sends (850k for one gauge, 1.4M for three)", () => {
    expect(gaugeStepGas(1)).toBe(850_000n);
    expect(gaugeStepGas(3)).toBe(1_400_000n);
  });
  it("never goes below one gauge's budget", () => {
    expect(gaugeStepGas(0)).toBe(850_000n);
  });
});

describe("quoteCrossChain", () => {
  it("adds the chain step and the gauge step, quoted at their own gas, and reports the return cost", async () => {
    read.mockReset();
    read.mockImplementation(async ({ functionName, args }: { functionName: string; args: unknown[] }) => {
      if (functionName === "adapters") return "0x00000000000000000000000000000000000000aa";
      if (functionName === "deallocationReturnCost") return 145n;
      return (args[1] as bigint) / 10n; // fee proportional to gas
    });
    const q = await quoteCrossChain(10, 1);
    expect(q.chainStep).toBe((CHAIN_STEP_GAS / 10n).toString());
    expect(q.gaugeStep).toBe((850_000n / 10n).toString());
    expect(q.total).toBe((CHAIN_STEP_GAS / 10n + 85_000n).toString());
    expect(q.returnCost).toBe("145");
  });
  it("refuses Base and chains with no adapter", async () => {
    await expect(quoteCrossChain(8453, 1)).rejects.toThrow(/Base/);
    read.mockReset();
    read.mockResolvedValue("0x0000000000000000000000000000000000000000");
    await expect(quoteCrossChain(999, 1)).rejects.toThrow(/adapter/);
  });
});
