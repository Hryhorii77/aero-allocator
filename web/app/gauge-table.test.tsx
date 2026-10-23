import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AERO_LAUNCH_AT_MS } from "./launch";
import { GaugeTable } from "./gauge-table";

const gauges = Array.from({ length: 15 }, (_, i) => ({
  gauge: `0x${i}`,
  pool: `0xp${i}`,
  symbol: `T${i}/USDC`,
  weight: 500_000 - i * 1000,
  sharePct: 10 - i * 0.5,
  capPerWeek: 250000,
  activated: i !== 14,
  incentivesUsdPerWeek: i === 0 ? 4137 : 0,
  incentivesUsdPer1k: i === 0 ? 4.26 : 0,
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
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => (url.includes("gauge-fees") ? { generatedAt: 0, windowHours: 5, fees: [{ gauge: "0x3", feesUsdPerDay: 1000, windowHours: 5 }] } : { chainId: 8453, generatedAt: 0, totalWeight: 1, gauges }) })));
    render(<GaugeTable />);
    expect(await screen.findByText("T0/USDC")).toBeInTheDocument();
    expect(screen.getByText("T11/USDC")).toBeInTheDocument();
    expect(screen.queryByText("T12/USDC")).not.toBeInTheDocument();
    expect(screen.getAllByText(/250,000/)).toHaveLength(12);
    expect(screen.getByText(/\$4,137/)).toBeInTheDocument();
    expect(screen.getByText(/\$4\.26/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "show all 15" }));
    expect(screen.getByText("T14/USDC")).toBeInTheDocument();
    expect(screen.getByText("not activated")).toBeInTheDocument();
  });

  it("ranks gauges by dollars per day for the typed amount once fees load", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => (url.includes("gauge-fees") ? { generatedAt: 0, windowHours: 5, fees: [{ gauge: "0x3", feesUsdPerDay: 1000, windowHours: 5 }] } : { chainId: 8453, generatedAt: 0, totalWeight: 1, gauges }) })));
    render(<GaugeTable />);
    expect(await screen.findByText(/\/day$/)).toBeInTheDocument();
    expect(screen.getByText(/fees \$1,000 \+ incentives \$0 per day/)).toBeInTheDocument();
    expect(screen.getByText(/pace of the last ~5 hours/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("sAERO amount"), { target: { value: "0" } });
    expect(screen.getByText(/Enter an amount above zero/)).toBeInTheDocument();
  });

  it("says so when the read fails", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    render(<GaugeTable />);
    expect(await screen.findByText(/Couldn.t load gauges/)).toBeInTheDocument();
  });

  it("switches chain: fetches that chain's gauges, drops the ranking and says what is Base only", async () => {
    const f = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("gauge-fees")
          ? { generatedAt: 0, windowHours: 5, fees: [] }
          : { chainId: url.includes("chain=1") ? 1 : 8453, generatedAt: 0, totalWeight: 1, gauges: [] },
    }));
    vi.stubGlobal("fetch", f);
    render(<GaugeTable />);
    fireEvent.click(await screen.findByRole("button", { name: "Ethereum" }));
    await waitFor(() => expect(f.mock.calls.some(([u]) => String(u) === "/api/gauges?chain=1")).toBe(true));
    expect(screen.getByText(/Aero gauges on Ethereum/)).toBeInTheDocument();
    expect(f.mock.calls.some(([u]) => String(u) === "/api/gauge-fees?chain=1")).toBe(true);
    expect(screen.getByText(/Allocating is Base only for now/)).toBeInTheDocument();
    expect(screen.getByLabelText("sAERO amount")).toBeInTheDocument();
  });

  it("shows no ranking and no fee request on a chain where fee pace isn't measured", async () => {
    const f = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes("gauge-fees") ? { chainId: 8453, generatedAt: 0, windowHours: 5, fees: [] } : { chainId: 42161, generatedAt: 0, totalWeight: 1, gauges: [] }),
    }));
    vi.stubGlobal("fetch", f);
    render(<GaugeTable />);
    fireEvent.click(await screen.findByRole("button", { name: "Arbitrum" }));
    await waitFor(() => expect(f.mock.calls.some(([u]) => String(u) === "/api/gauges?chain=42161")).toBe(true));
    expect(f.mock.calls.some(([u]) => String(u).includes("gauge-fees?chain=42161"))).toBe(false);
    expect(screen.getByText(/aren.t measured here/)).toBeInTheDocument();
    expect(screen.queryByLabelText("sAERO amount")).not.toBeInTheDocument();
  });
});
