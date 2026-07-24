import { describe, expect, it } from "vitest";
import { WEEK, currentEpochStart, epochProgress, epochStart } from "./config.js";

describe("epochStart", () => {
  it("floors a timestamp to the most recent week boundary", () => {
    const boundary = 20 * WEEK;
    expect(epochStart(boundary)).toBe(boundary);
    expect(epochStart(boundary + 1)).toBe(boundary);
    expect(epochStart(boundary + WEEK - 1)).toBe(boundary);
  });
});

describe("currentEpochStart / epochProgress", () => {
  it("agree: progress is the fraction of WEEK since currentEpochStart", () => {
    const now = Math.floor(Date.now() / 1000);
    const start = currentEpochStart();
    expect(start % WEEK).toBe(0);
    expect(start).toBeLessThanOrEqual(now);

    const progress = epochProgress();
    expect(progress).toBeGreaterThanOrEqual(0);
    expect(progress).toBeLessThan(1);
    expect(progress).toBeCloseTo((now - start) / WEEK, 3);
  });
});
