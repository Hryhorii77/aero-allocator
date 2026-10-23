import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AllocationDesk } from "./allocation-desk";
import type { GaugeRow } from "@/lib/gauges";

const g = (n: number, weight: number): GaugeRow => ({
  gauge: `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`,
  pool: `0x${(n + 100).toString(16).padStart(40, "0")}` as `0x${string}`,
  symbol: `P${n}`,
  weight,
  sharePct: 1,
  capPerWeek: 1,
  activated: true,
  incentivesUsdPerWeek: 0,
  incentivesUsdPer1k: 0,
});
const fee = (n: number, usd: number, h: number) => ({ gauge: g(n, 1).gauge, feesUsdPerDay: usd, windowHours: h });

describe("AllocationDesk", () => {
  it("recommends a split that beats the top gauge for a big amount, and shows the 47 h total", () => {
    const gauges = [g(1, 200_000), g(2, 200_000)];
    render(<AllocationDesk gauges={gauges} fees={{ chainId: 8453, generatedAt: 0, windowHours: 30, fees: [fee(1, 1000, 30), fee(2, 900, 30)] }} amount={1_000_000} />);
    expect(screen.getByText(/more than putting it all in the top gauge/)).toBeInTheDocument();
    expect(screen.getByText(/Best split:/).textContent).toMatch(/P1 \d+(\.\d+)?% · P2/);
    expect(screen.getByText("solid")).toBeInTheDocument();
  });

  it("flags a thin pace by the weakest gauge in the split", () => {
    const gauges = [g(1, 200_000), g(2, 200_000)];
    render(<AllocationDesk gauges={gauges} fees={{ chainId: 8453, generatedAt: 0, windowHours: 30, fees: [fee(1, 1000, 30), fee(2, 900, 3)] }} amount={1_000_000} />);
    expect(screen.getAllByText("thin").length).toBeGreaterThan(0);
    expect(screen.getByText(/3 h of history in the weakest pick/)).toBeInTheDocument();
  });

  it("asks for an amount", () => {
    render(<AllocationDesk gauges={[g(1, 200_000)]} fees={{ chainId: 8453, generatedAt: 0, windowHours: 30, fees: [fee(1, 1000, 30)] }} amount={0} />);
    expect(screen.getByText(/Enter an amount above zero/)).toBeInTheDocument();
  });
});
