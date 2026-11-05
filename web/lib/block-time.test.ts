import { describe, expect, it } from "vitest";
import { blockSecondsBefore, secondsBetween } from "./block-time";

// Base's Denim switch: 2 s blocks below 1,000, 0.2 s from 1,000 on.
const denim = { sec: 0.2, before: { untilBlock: 1_000, sec: 2 } };

describe("secondsBetween", () => {
  it("is blocks times the rate for a chain that never changed", () => {
    expect(secondsBetween(2, 100, 400)).toBe(600);
    expect(secondsBetween({ sec: 0.295 }, 0, 1_000)).toBeCloseTo(295);
    expect(secondsBetween(2, 400, 100)).toBe(-600);
  });
  it("counts each side of a switch at its own rate", () => {
    expect(secondsBetween(denim, 900, 950)).toBe(100); // all before
    expect(secondsBetween(denim, 1_000, 1_500)).toBeCloseTo(100); // all after
    expect(secondsBetween(denim, 900, 1_500)).toBeCloseTo(200 + 100); // 100 old blocks + 500 new
    expect(secondsBetween(denim, 1_500, 900)).toBeCloseTo(-300);
  });
});

describe("blockSecondsBefore", () => {
  it("steps back at the one rate when nothing changed", () => {
    expect(blockSecondsBefore(2, 10_000, 3_600)).toBe(8_200);
  });
  it("steps back across the switch", () => {
    expect(blockSecondsBefore(denim, 1_500, 50)).toBe(1_250); // inside the new rate
    expect(blockSecondsBefore(denim, 1_500, 300)).toBe(900); // 100 s after the switch, then 200 s of 2 s blocks
    expect(blockSecondsBefore(denim, 900, 200)).toBe(800); // head still before the switch
  });
  it("round-trips with secondsBetween, to within one whole block", () => {
    for (const s of [10, 99, 100, 101, 5_000]) expect(Math.abs(secondsBetween(denim, blockSecondsBefore(denim, 1_500, s), 1_500) - s)).toBeLessThanOrEqual(1);
  });
});
