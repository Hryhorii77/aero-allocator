import { describe, expect, it } from "vitest";
import { dilutionCost } from "./headline";

describe("dilutionCost", () => {
  it("sums what the split pays diluted vs undiluted and the percentage lost", () => {
    const r = dilutionCost([
      { expectedRewardUsd: 100, undilutedRewardUsd: 120 },
      { expectedRewardUsd: 23.17, undilutedRewardUsd: 26 },
    ]);
    expect(r?.dilutedUsd).toBeCloseTo(123.17, 2);
    expect(r?.undilutedUsd).toBeCloseTo(146, 2);
    expect(r?.lossPct).toBeCloseTo(15.6, 1);
  });

  it("stays quiet when the gap is under 2% (a small holder barely moves the pool)", () => {
    expect(dilutionCost([{ expectedRewardUsd: 99, undilutedRewardUsd: 100 }])).toBeNull();
  });

  it("is null when any row lacks the numbers or there are no rows", () => {
    expect(dilutionCost([])).toBeNull();
    expect(dilutionCost([{ expectedRewardUsd: 10 }])).toBeNull();
  });
});
