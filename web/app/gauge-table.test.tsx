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

  it("without fee estimates it is a table sorted by weight: top 10, a show-all button, incentives per day", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("gauge-fees") ? { ok: false, status: 500 } : { ok: true, json: async () => ({ chainId: 8453, generatedAt: 0, totalWeight: 1, gauges }) })));
    render(<GaugeTable />);
    expect(await screen.findByText("T0/USDC")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Aero gauges on Base/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Share of weight" })).toBeInTheDocument();
    expect(screen.getByText("T9/USDC")).toBeInTheDocument();
    expect(screen.queryByText("T10/USDC")).not.toBeInTheDocument();
    expect(screen.getAllByText(/\$591/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "show all 15" }));
    expect(screen.getByText("T14/USDC")).toBeInTheDocument();
    expect(screen.getByText("not activated")).toBeInTheDocument();
  });

  it("with fees, ranks gauges by dollars per day for the typed amount and leaves the rest as dashes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => (url.includes("gauge-fees") ? { chainId: 8453, generatedAt: 0, windowHours: 5, fees: [{ gauge: "0x3", feesUsdPerDay: 1000, windowHours: 5 }] } : { chainId: 8453, generatedAt: 0, totalWeight: 1, gauges }) })));
    render(<GaugeTable />);
    expect(await screen.findByText(/per day, best split of your amount/)).toBeInTheDocument();
    expect(screen.getByText(/over the 47 h lock/)).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    // header + 10 gauges; T3 is the only one with a fee estimate, so it leads.
    expect(rows).toHaveLength(11);
    expect(rows[1]).toHaveTextContent("T3/USDC");
    // 1,000 fees x 10,000 power / (497,000 already there + 10,000) = $19.72
    expect(rows[1]).toHaveTextContent("$19.72");
    expect(rows[1]).toHaveTextContent("thin pace");
    expect(rows[2]).toHaveTextContent("–");
    expect(screen.getByRole("columnheader", { name: /You earn \/ day/ })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByText(/pace of the last ~5 hours/)).toBeInTheDocument();
  });

  it("tells same-named gauges apart with a pool-type badge and links each pool to its contract", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    const twins = [
      { ...gauges[0], gauge: "0xa", pool: "0x00000000000000000000000000000000000000a1", symbol: "msUSD/USDC", poolType: "CL10", feePct: 0.0232 },
      { ...gauges[1], gauge: "0xb", pool: "0x00000000000000000000000000000000000000b1", symbol: "msUSD/USDC", poolType: "CL100", feePct: 0.2 },
      { ...gauges[2], gauge: "0xc", pool: "0x00000000000000000000000000000000000000c1", symbol: "AERO/USDC", poolType: "volatile", feePct: null },
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("gauge-fees") ? { ok: false, status: 500 } : { ok: true, json: async () => ({ chainId: 8453, generatedAt: 0, totalWeight: 1, gauges: twins }) })));
    render(<GaugeTable />);
    await screen.findAllByText("msUSD/USDC");
    expect(screen.getByText("CL10 · 0.023%")).toBeInTheDocument();
    expect(screen.getByText("CL100 · 0.20%")).toBeInTheDocument();
    expect(screen.getByText("volatile")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "msUSD/USDC" });
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://basescan.org/address/0x00000000000000000000000000000000000000a1",
      "https://basescan.org/address/0x00000000000000000000000000000000000000b1",
    ]);
    expect(links[0]).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("shows an estimated APR from the AERO price, and a dash (not a made-up number) without one", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    const withFees = (aeroUsd?: number) =>
      vi.fn(async (url: string) => ({ ok: true, json: async () => (url.includes("gauge-fees") ? { chainId: 8453, generatedAt: 0, windowHours: 5, fees: [{ gauge: "0x3", feesUsdPerDay: 1000, windowHours: 5 }], ...(aeroUsd ? { aeroUsd } : {}) } : { chainId: 8453, generatedAt: 0, totalWeight: 1, gauges }) }));
    vi.stubGlobal("fetch", withFees(0.75));
    const { unmount } = render(<GaugeTable />);
    await screen.findByText(/per day, best split of your amount/);
    // $19.72/day on 10,000 AERO at $0.75: 19.72 x 365 / 7,500 = 96%
    expect(screen.getByRole("columnheader", { name: "Est. APR" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("96%");
    expect(screen.getByText(/about 96% APR/)).toBeInTheDocument();
    expect(screen.getByText(/AERO.s price \(\$0\.75\)/)).toBeInTheDocument();
    unmount();

    vi.stubGlobal("fetch", withFees());
    render(<GaugeTable />);
    await screen.findByText(/per day, best split of your amount/);
    expect(screen.queryByRole("columnheader", { name: "Est. APR" })).not.toBeInTheDocument();
    expect(screen.queryByText(/APR/)).not.toBeInTheDocument();
  });

  it("sorts by the column you click", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => (url.includes("gauge-fees") ? { chainId: 8453, generatedAt: 0, windowHours: 5, fees: [{ gauge: "0x3", feesUsdPerDay: 1000, windowHours: 5 }] } : { chainId: 8453, generatedAt: 0, totalWeight: 1, gauges }) })));
    render(<GaugeTable />);
    await screen.findByText(/per day, best split of your amount/);
    fireEvent.click(screen.getByRole("button", { name: "Power in it" }));
    expect(screen.getByRole("columnheader", { name: /Power in it/ })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("T0/USDC");
  });

  it("flags a bad amount inline instead of ranking it", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => (url.includes("gauge-fees") ? { chainId: 8453, generatedAt: 0, windowHours: 5, fees: [{ gauge: "0x3", feesUsdPerDay: 1000, windowHours: 5 }] } : { chainId: 8453, generatedAt: 0, totalWeight: 1, gauges }) })));
    render(<GaugeTable />);
    await screen.findByText(/per day, best split of your amount/);
    const box = screen.getByLabelText("sAERO amount");
    for (const [text, msg] of [["0", /Enter an amount above zero/], ["abc", /Numbers only/], ["-5", /Numbers only/], ["", /Enter how much sAERO you hold/]] as const) {
      fireEvent.change(box, { target: { value: text } });
      expect(screen.getByRole("alert")).toHaveTextContent(msg);
      expect(box).toHaveAttribute("aria-invalid", "true");
      expect(screen.queryByText(/per day, best split of your amount/)).not.toBeInTheDocument();
      // The table falls back to weight while the amount is unusable.
      expect(screen.getByRole("columnheader", { name: "Share of weight" })).toBeInTheDocument();
    }
    fireEvent.change(box, { target: { value: "25,000" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await screen.findByText(/per day, best split of your amount/)).toBeInTheDocument();
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

  it("asks for fee estimates on every chain now, and says plainly when one chain's fee read fails", async () => {
    for (const [name, id] of [["Arbitrum", 42161], ["Ink", 57073], ["Robinhood Chain", 4663]] as const) {
      const f = vi.fn(async (url: string) =>
        url.includes("gauge-fees") ? { ok: false, status: 500 } : { ok: true, json: async () => ({ chainId: id, generatedAt: 0, totalWeight: 1, gauges }) },
      );
      vi.stubGlobal("fetch", f);
      const { unmount } = render(<GaugeTable />);
      fireEvent.click(await screen.findByRole("button", { name }));
      await waitFor(() => expect(f.mock.calls.some(([u]) => String(u) === `/api/gauges?chain=${id}`)).toBe(true));
      expect(f.mock.calls.some(([u]) => String(u).includes(`gauge-fees?chain=${id}`))).toBe(true);
      expect(await screen.findByText(/Fee estimates are unavailable right now/)).toBeInTheDocument();
      // The gauges still list, by weight, with the amount box ready.
      expect(await screen.findByText("T0/USDC")).toBeInTheDocument();
      expect(screen.getByLabelText("sAERO amount")).toBeInTheDocument();
      unmount();
    }
  });
});
