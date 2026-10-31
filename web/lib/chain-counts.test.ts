import { describe, expect, it } from "vitest";
import { rankableCount } from "./chain-counts";
import { MIN_RANK_WEIGHT } from "./gauge-yield";

describe("rankableCount", () => {
  it("counts only activated gauges with at least the ranking minimum of power", () => {
    expect(
      rankableCount([
        { activated: true, weight: MIN_RANK_WEIGHT },
        { activated: true, weight: MIN_RANK_WEIGHT - 1 },
        { activated: false, weight: 5 * MIN_RANK_WEIGHT },
        { activated: true, weight: 9e6 },
      ]),
    ).toBe(2);
  });
});
