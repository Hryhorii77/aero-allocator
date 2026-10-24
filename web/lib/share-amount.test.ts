import { describe, expect, it } from "vitest";
import { shareAmount } from "./share-amount";

describe("shareAmount", () => {
  it("keeps a sensible amount, rounded", () => {
    expect(shareAmount("25000")).toBe(25000);
    expect(shareAmount("1234.6")).toBe(1235);
  });
  it("falls back to 10,000 for a missing, junk, negative, zero or absurd amount", () => {
    for (const q of [null, "", "abc", "-5", "0", "99999999999999"]) expect(shareAmount(q)).toBe(10_000);
  });
});
