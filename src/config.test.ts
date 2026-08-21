import { describe, expect, it } from "vitest";
import { PRESET, WEEK, currentEpochStart, epochProgress, epochStart, resolveProtocol } from "./config.js";

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

describe("resolveProtocol", () => {
  it("defaults to aerodrome for unset or unrecognized values", () => {
    expect(resolveProtocol(undefined)).toBe("aerodrome");
    expect(resolveProtocol("")).toBe("aerodrome");
    expect(resolveProtocol("base")).toBe("aerodrome");
  });

  it("selects velodrome only for an exact match", () => {
    expect(resolveProtocol("velodrome")).toBe("velodrome");
    expect(resolveProtocol("Velodrome")).toBe("aerodrome"); // case-sensitive by design — env vars should be exact
  });
});

describe("PRESET", () => {
  it("resolves to a preset for whichever protocol the process is running (aerodrome by default in this suite)", () => {
    expect(["aerodrome", "velodrome"]).toContain(PRESET.protocol);
    expect(PRESET.addresses.lpSugar).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(PRESET.addresses.rewardToken).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
