import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AERO_LAUNCH_AT_MS } from "./launch";
import { GaugeTable } from "./gauge-table";

const gauges = Array.from({ length: 15 }, (_, i) => ({
  gauge: `0x${i}`,
  pool: `0xp${i}`,
  symbol: `T${i}/USDC`,
  weight: 100 - i,
  sharePct: 10 - i * 0.5,
  capPerWeek: 250000,
  activated: i !== 14,
}));

describe("GaugeTable", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is hidden before launch and does not fetch", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS - 1000);
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { container } = render(<GaugeTable />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
    expect(f).not.toHaveBeenCalled();
  });

  it("lists the top 12 with share and cap, and can show all", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ chainId: 8453, generatedAt: 0, totalWeight: 1, gauges }) })));
    render(<GaugeTable />);
    expect(await screen.findByText("T0/USDC")).toBeInTheDocument();
    expect(screen.getByText("T11/USDC")).toBeInTheDocument();
    expect(screen.queryByText("T12/USDC")).not.toBeInTheDocument();
    expect(screen.getAllByText(/250,000/)).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "show all 15" }));
    expect(screen.getByText("T14/USDC")).toBeInTheDocument();
    expect(screen.getByText("not activated")).toBeInTheDocument();
  });

  it("says so when the read fails", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    render(<GaugeTable />);
    expect(await screen.findByText(/Couldn.t load gauges/)).toBeInTheDocument();
  });
});
