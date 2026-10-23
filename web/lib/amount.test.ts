import { describe, expect, it } from "vitest";
import { parseAmount } from "./amount";

describe("parseAmount", () => {
  it("accepts plain numbers, commas, spaces and decimals", () => {
    expect(parseAmount("10000")).toEqual({ ok: true, value: 10000 });
    expect(parseAmount(" 10,000 ")).toEqual({ ok: true, value: 10000 });
    expect(parseAmount("1 250.5")).toEqual({ ok: true, value: 1250.5 });
    expect(parseAmount(".5")).toEqual({ ok: true, value: 0.5 });
  });

  it("rejects empty, text, signs, exponents and several dots", () => {
    for (const t of ["", "  ", "abc", "-5", "+5", "1e5", "1.2.3", "5 AERO", "0x10"]) {
      const r = parseAmount(t);
      expect(r.ok, t).toBe(false);
    }
    expect(parseAmount("")).toEqual({ ok: false, error: "Enter how much sAERO you hold." });
    expect(parseAmount("abc")).toEqual({ ok: false, error: "Numbers only, for example 10,000." });
  });

  it("rejects zero and absurd sizes", () => {
    expect(parseAmount("0")).toEqual({ ok: false, error: "Enter an amount above zero." });
    expect(parseAmount("0.00")).toEqual({ ok: false, error: "Enter an amount above zero." });
    expect(parseAmount("2000000000").ok).toBe(false);
  });
});
