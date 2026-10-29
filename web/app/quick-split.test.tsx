import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GaugeRow } from "@/lib/gauges";
import { QUICK_PARTS, QuickSplit } from "./quick-split";

const g = (n: number, weight: number, extra: Partial<GaugeRow> = {}): GaugeRow => ({
  gauge: `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`,
  pool: `0x${(n + 100).toString(16).padStart(40, "0")}` as `0x${string}`,
  symbol: `P${n}`,
  weight,
  sharePct: 1,
  capPerWeek: 1,
  activated: true,
  incentivesUsdPerWeek: 0,
  incentivesUsdPer1k: 0,
  ...extra,
});
const fee = (n: number, usd: number, h = 40) => ({ gauge: g(n, 1).gauge, feesUsdPerDay: usd, windowHours: h });
const fees = (rows: ReturnType<typeof fee>[], generatedAt = 1_000_000_000_000) => ({ chainId: 8453, generatedAt, windowHours: 40, aeroUsd: 0.5, fees: rows });

describe("QuickSplit", () => {
  it("lists at most three gauges, adding up to 100%, with the day's total and one button to the positions panel", () => {
    const gauges = [1, 2, 3, 4, 5].map((n) => g(n, 100_000));
    render(<QuickSplit gauges={gauges} fees={fees([1, 2, 3, 4, 5].map((n) => fee(n, 1000)))} amount={5_000_000} />);
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeLessThanOrEqual(QUICK_PARTS);
    expect(items.length).toBeGreaterThan(1);
    const pcts = items.map((li) => parseFloat(li.children[1].firstElementChild?.textContent ?? "NaN"));
    expect(pcts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
    expect(screen.getByText(/about \d+(\.\d)?k?% APR/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "allocate from my wallet" })).toHaveAttribute("href", "#positions");
  });

  it("says how far the figure can fall and warns when the pace is thin", () => {
    render(<QuickSplit gauges={[g(1, 200_000)]} fees={fees([fee(1, 1000, 3)])} amount={10_000} />);
    expect(screen.getByText(/Could be as low as/)).toBeInTheDocument();
    expect(screen.getByText("thin")).toBeInTheDocument();
    expect(screen.getByText(/a few hours of fees, or a burst/)).toBeInTheDocument();
  });

  it("marks a gauge whose incentives end inside the wait", () => {
    const now = 1_000_000_000;
    const gauges = [g(1, 200_000, { incentivesUsdPerWeek: 700, incentivePrograms: [{ end: now + 10 * 3600, usdPerDay: 100 }] })];
    render(<QuickSplit gauges={gauges} fees={fees([fee(1, 20)], now * 1000)} amount={10_000} cooldownSec={169_200} />);
    expect(screen.getByText("incentives end in 10 h")).toBeInTheDocument();
  });

  it("shows nothing without an amount or without a priceable gauge", () => {
    const { container, rerender } = render(<QuickSplit gauges={[g(1, 200_000)]} fees={fees([fee(1, 1000)])} amount={0} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<QuickSplit gauges={[g(1, 200_000)]} fees={fees([])} amount={10_000} />);
    expect(container).toBeEmptyDOMElement();
  });
});
