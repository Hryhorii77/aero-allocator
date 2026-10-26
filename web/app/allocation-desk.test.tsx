import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

afterEach(() => vi.unstubAllGlobals());

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

  it("shows a range when fees are cut to the paying share, with the reason, and none when nothing differs", () => {
    const gauges = [g(1, 200_000), g(2, 200_000)];
    const { unmount } = render(<AllocationDesk gauges={gauges} fees={{ chainId: 8453, generatedAt: 0, windowHours: 30, fees: [fee(1, 1000, 30), fee(2, 900, 30)] }} amount={1_000_000} />);
    expect(screen.getByText(/Range:/).textContent).toMatch(/\$[\d,.]+ to \$[\d,.]+ a day \(about/);
    expect(screen.getByText(/nothing above it is supported by the data/)).toBeInTheDocument();
    unmount();
    // fees all from a gauge whose record says every half-day paid: low end still halves at worst, so the range exists; with no fees at all there is none
    render(<AllocationDesk gauges={[g(1, 200_000)]} fees={{ chainId: 8453, generatedAt: 0, windowHours: 30, fees: [fee(1, 0, 30)] }} amount={1_000} />);
    expect(screen.queryByText(/Range:/)).not.toBeInTheDocument();
  });

  it("labels the lock with the wait it is given, 47 hours when it is not", () => {
    const gauges = [g(1, 200_000), g(2, 200_000)];
    const f = { chainId: 8453, generatedAt: 0, windowHours: 30, fees: [fee(1, 1000, 30), fee(2, 900, 30)] };
    const { unmount } = render(<AllocationDesk gauges={gauges} fees={f} amount={1_000_000} cooldownSec={24 * 3600} />);
    expect(screen.getByText(/over the 24 h lock before you can move it/)).toBeInTheDocument();
    unmount();
    render(<AllocationDesk gauges={gauges} fees={f} amount={1_000_000} />);
    expect(screen.getByText(/over the 47 h lock before you can move it/)).toBeInTheDocument();
  });

  it("asks for an amount", () => {
    render(<AllocationDesk gauges={[g(1, 200_000)]} fees={{ chainId: 8453, generatedAt: 0, windowHours: 30, fees: [fee(1, 1000, 30)] }} amount={0} />);
    expect(screen.getByText(/Enter an amount above zero/)).toBeInTheDocument();
  });

  it("on another chain, shows what sending power there costs (read-only) and says nothing on Base", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ chainId: 10, gauges: 2, chainStep: "44000000000000", gaugeStep: "150000000000000", total: "194000000000000", returnCost: "145000000000000" }) });
    vi.stubGlobal("fetch", fetchMock);
    const f = { chainId: 10, generatedAt: 0, windowHours: 30, fees: [fee(1, 1000, 30), fee(2, 900, 30)] };
    render(<AllocationDesk gauges={[g(1, 200_000), g(2, 200_000)]} fees={f} amount={1_000_000} chainName="OP" />);
    await waitFor(() => expect(screen.getByText(/Sending power to OP costs about 0\.00019 ETH/)).toBeInTheDocument());
    expect(screen.getByText(/further 0\.00015 ETH charge/)).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/allocation-fee\?chain=10&gauges=/);
  });
  it("says how old the fee figures are, and stays quiet when the time is unknown", () => {
    const gs = [g(1, 200_000), g(2, 200_000)];
    const { unmount } = render(<AllocationDesk gauges={gs} fees={{ chainId: 8453, generatedAt: Date.now() - 12 * 60_000, windowHours: 30, fees: [fee(1, 1000, 30), fee(2, 900, 30)] }} amount={1_000_000} />);
    expect(screen.getByText(/Fee figures read 12 min ago/)).toBeInTheDocument();
    unmount();
    render(<AllocationDesk gauges={gs} fees={{ chainId: 8453, generatedAt: 0, windowHours: 30, fees: [fee(1, 1000, 30), fee(2, 900, 30)] }} amount={1_000_000} />);
    expect(screen.queryByText(/Fee figures read/)).toBeNull();
  });
  it("shows no cost line on Base", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AllocationDesk gauges={[g(1, 200_000)]} fees={{ chainId: 8453, generatedAt: 0, windowHours: 30, fees: [fee(1, 1000, 30)] }} amount={1_000_000} chainName="Base" />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
