import { describe, expect, it } from "vitest";
import { currentEpochStart, WEEK } from "./config.js";
import { splitCurrentEpoch } from "./data.js";
import type { EpochStats } from "./types.js";

function epoch(ts: number, feesUsd: number): EpochStats {
  return { ts, votes: 0, emissions: 0, feesUsd, bribesUsd: 0 };
}

describe("splitCurrentEpoch", () => {
  it("separates the in-progress epoch from completed ones", () => {
    const now = currentEpochStart();
    const history = [epoch(now, 10), epoch(now - WEEK, 20), epoch(now - 2 * WEEK, 30)];
    const { current, completed } = splitCurrentEpoch(history);
    expect(current).toEqual(epoch(now, 10));
    expect(completed).toEqual([epoch(now - WEEK, 20), epoch(now - 2 * WEEK, 30)]);
  });

  it("returns null current when history has no in-progress epoch", () => {
    const now = currentEpochStart();
    const history = [epoch(now - WEEK, 20), epoch(now - 2 * WEEK, 30)];
    const { current, completed } = splitCurrentEpoch(history);
    expect(current).toBeNull();
    expect(completed).toHaveLength(2);
  });

  it("handles empty history", () => {
    expect(splitCurrentEpoch([])).toEqual({ current: null, completed: [] });
  });
});
