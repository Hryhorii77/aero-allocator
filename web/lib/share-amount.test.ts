import { describe, expect, it } from "vitest";
import { positionCardPath, roundedSharePower, shareAmount } from "./share-amount";

describe("shareAmount", () => {
  it("takes a sane amount and falls back to 10,000 otherwise", () => {
    expect(shareAmount("2500.4")).toBe(2500);
    for (const bad of [null, "", "abc", "-5", "0", "2000000000"]) expect(shareAmount(bad)).toBe(10_000);
  });
});

describe("roundedSharePower", () => {
  it("keeps two significant figures so the exact balance is not in the link", () => {
    expect(roundedSharePower(9734.6)).toBe(9700);
    expect(roundedSharePower(12_345_678)).toBe(12_000_000);
    expect(roundedSharePower(87.4)).toBe(87);
    expect(roundedSharePower(1.4)).toBe(1);
  });
  it("is null for a position the card can't take", () => {
    for (const bad of [0, 0.4, -3, NaN, Infinity, 5e9]) expect(roundedSharePower(bad)).toBeNull();
  });
});

describe("positionCardPath", () => {
  it("carries only the rounded power and the theme", () => {
    expect(positionCardPath(9734.6, "dark")).toBe("/api/share?vp=9700");
    expect(positionCardPath(9734.6, "light")).toBe("/api/share?vp=9700&theme=light");
    expect(positionCardPath(0, "dark")).toBeNull();
  });
});
