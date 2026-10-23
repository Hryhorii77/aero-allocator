import { describe, expect, it } from "vitest";
import { allocatedPct, cooldownState, DEFAULT_COOLDOWN_SEC, formatDuration } from "./saero";

describe("cooldownState", () => {
  it("is ready for a position that was never allocated", () => {
    expect(cooldownState(0, DEFAULT_COOLDOWN_SEC, 1_000_000)).toEqual({ ready: true });
  });
  it("counts down from the last allocation", () => {
    const last = 1_000_000;
    expect(cooldownState(last, DEFAULT_COOLDOWN_SEC, last + 3600)).toEqual({
      ready: false,
      secondsLeft: DEFAULT_COOLDOWN_SEC - 3600,
      readyAtSec: last + DEFAULT_COOLDOWN_SEC,
    });
  });
  it("is ready exactly at the boundary and after it", () => {
    const last = 1_000_000;
    expect(cooldownState(last, DEFAULT_COOLDOWN_SEC, last + DEFAULT_COOLDOWN_SEC)).toEqual({ ready: true });
    expect(cooldownState(last, DEFAULT_COOLDOWN_SEC, last + DEFAULT_COOLDOWN_SEC + 1)).toEqual({ ready: true });
  });
  it("the launch cooldown is 47 hours", () => {
    expect(DEFAULT_COOLDOWN_SEC).toBe(47 * 3600);
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes, and never goes negative", () => {
    expect(formatDuration(46 * 3600 + 12 * 60 + 59)).toBe("46h 12m");
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe("3h 05m");
    expect(formatDuration(12 * 60)).toBe("12m");
    expect(formatDuration(-50)).toBe("0m");
  });
});

describe("allocatedPct", () => {
  it("is the share not idle on CHAIN0, clamped to 0-100, and 0 for an empty stake", () => {
    expect(allocatedPct({ parked: 5, staked: 10 })).toBe(50);
    expect(allocatedPct({ parked: 0, staked: 10 })).toBe(100);
    expect(allocatedPct({ parked: 12, staked: 10 })).toBe(0);
    expect(allocatedPct({ parked: 0, staked: 0 })).toBe(0);
  });
});
