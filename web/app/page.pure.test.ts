import { describe, expect, it } from "vitest";
import { usd, toCsv, formatCountdown } from "./page";

describe("usd", () => {
  it("formats amounts under 1000 with up to 2 decimal places", () => {
    expect(usd(0)).toBe("$0");
    expect(usd(12.345)).toBe("$12.35");
    expect(usd(999.999)).toBe("$1,000");
  });

  it("rounds amounts at or above 1000 to the nearest whole dollar with thousands separators", () => {
    expect(usd(1000)).toBe("$1,000");
    expect(usd(1234567.89)).toBe("$1,234,568");
  });
});

describe("formatCountdown", () => {
  it("reports the epoch as just flipped for zero or negative ms", () => {
    expect(formatCountdown(0)).toBe("epoch just flipped");
    expect(formatCountdown(-1000)).toBe("epoch just flipped");
  });

  it("formats minutes-only durations under an hour", () => {
    expect(formatCountdown(5 * 60_000)).toBe("5m");
  });

  it("formats hours and minutes under a day", () => {
    expect(formatCountdown(3 * 3_600_000 + 20 * 60_000)).toBe("3h 20m");
  });

  it("formats days and hours at a day or more", () => {
    expect(formatCountdown(2 * 86_400_000 + 5 * 3_600_000 + 59 * 60_000)).toBe("2d 5h");
  });
});

describe("toCsv", () => {
  it("returns an empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });

  it("uses the first row's keys as the header, in order", () => {
    const csv = toCsv([{ b: 1, a: 2 }]);
    expect(csv.split("\n")[0]).toBe("b,a");
  });

  it("quotes and escapes values containing commas, quotes, or newlines", () => {
    // Assert on the whole CSV, not a naive split("\n") — the field's own
    // embedded newline is inside quotes and shouldn't be treated as a row
    // boundary by a real CSV parser (or by this test).
    const csv = toCsv([{ symbol: 'CL50-WETH/USDC, "wrapped"', note: "line1\nline2" }]);
    expect(csv).toBe('symbol,note\n"CL50-WETH/USDC, ""wrapped""","line1\nline2"');
  });

  it("leaves plain values unquoted", () => {
    const csv = toCsv([{ symbol: "CL50-WETH/USDC", weightPct: 33.5 }]);
    expect(csv.split("\n")[1]).toBe("CL50-WETH/USDC,33.5");
  });

  it("renders one row per input row, same column order for every row", () => {
    const csv = toCsv([
      { pool: "0x1", weightPct: 10 },
      { pool: "0x2", weightPct: 20 },
    ]);
    expect(csv).toBe("pool,weightPct\n0x1,10\n0x2,20");
  });
});
