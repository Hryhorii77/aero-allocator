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
    expect(screen.getByText(/judging allocation over a long horizon/)).toBeInTheDocument();
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
    // The phone card repeats the figure (only one of the two shows at a time).
    expect(screen.getAllByText(/about 96% APR/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/AERO.s price \(\$0\.75\)/)).toBeInTheDocument();
    unmount();

    vi.stubGlobal("fetch", withFees());
    render(<GaugeTable />);
    await screen.findByText(/per day, best split of your amount/);
    expect(screen.queryByRole("columnheader", { name: "Est. APR" })).not.toBeInTheDocument();
    expect(screen.queryByText(/APR/)).not.toBeInTheDocument();
  });

  it("shows the APR as a range and calls the pace spiky when the pace is a burst above the gauge's usual level", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes("gauge-fees")
            ? { chainId: 8453, generatedAt: 0, windowHours: 48, aeroUsd: 0.75, fees: [{ gauge: "0x3", feesUsdPerDay: 1000, windowHours: 48, spike: { typicalUsdPerDay: 100 } }] }
            : { chainId: 8453, generatedAt: 0, totalWeight: 1, gauges },
      })),
    );
    render(<GaugeTable />);
    await screen.findByText(/per day, best split of your amount/);
    // pace APR 96% (see the test above); at the usual level (a tenth of the fees) it is 9.6%
    const row = screen.getAllByRole("row")[1];
    expect(row).toHaveTextContent("9.6%–96%");
    expect(row).toHaveTextContent("spiky");
    expect(row).not.toHaveTextContent("solid");
  });

  it("words the long-horizon note with the wait the chain reports, 47 hours when the list has none", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    const stub = (cooldownSec?: number) =>
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => (url.includes("gauge-fees") ? { chainId: 8453, generatedAt: 0, windowHours: 5, fees: [{ gauge: "0x3", feesUsdPerDay: 1000, windowHours: 5 }] } : { chainId: 8453, generatedAt: 0, totalWeight: 1, gauges, ...(cooldownSec ? { cooldownSec } : {}) }),
      }));
    vi.stubGlobal("fetch", stub(86_400));
    const { unmount } = render(<GaugeTable />);
    expect(await screen.findByText(/as short as 24 hours are noisy/)).toBeInTheDocument();
    unmount();
    vi.stubGlobal("fetch", stub());
    render(<GaugeTable />);
    expect(await screen.findByText(/as short as 47 hours are noisy/)).toBeInTheDocument();
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
    for (const [name, id] of [["Arbitrum", 42161], ["Ink", 57073], ["Robinhood Chain", 4663], ["Arc", 5042]] as const) {
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

  it("shows where power is moving once the snapshots cover enough hours, and nothing before", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    const flows = { chainId: 8453, spanHours: 12, flows: [
      { gauge: "0x1", sharePctChange: 34, powerChange: 80_000, weight: 480_000 },
      { gauge: "0x2", sharePctChange: -21, powerChange: -50_000, weight: 470_000 },
    ] };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("gauge-fees") ? { ok: false, status: 500 } : { ok: true, json: async () => (url.includes("gauge-flows") ? flows : { chainId: 8453, generatedAt: 0, totalWeight: 1, gauges }) })));
    render(<GaugeTable />);
    const line = (await screen.findByText(/Power moving, last 12 h/)).closest("p");
    expect(line).toHaveTextContent("gaining T1/USDC +34%; losing T2/USDC −21%");
    expect(screen.getByRole("columnheader", { name: "Power flow" })).toBeInTheDocument();
  });

  it("shows no flow column when there is no flow history yet", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("gauge-fees") ? { ok: false, status: 500 } : { ok: true, json: async () => (url.includes("gauge-flows") ? { chainId: 8453, spanHours: 0, flows: [] } : { chainId: 8453, generatedAt: 0, totalWeight: 1, gauges }) })));
    render(<GaugeTable />);
    expect(await screen.findByText("T0/USDC")).toBeInTheDocument();
    expect(screen.queryByText(/Power moving/)).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Power flow" })).not.toBeInTheDocument();
  });

  it("sorts by steadiness on request and opens a gauge's history", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    const feeList = [
      { gauge: "0x3", feesUsdPerDay: 1000, windowHours: 30, steady: { buckets: 4, paying: 2 } },
      { gauge: "0x5", feesUsdPerDay: 100, windowHours: 30, steady: { buckets: 4, paying: 4 } },
    ];
    const f = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes("gauge-fees") ? { chainId: 8453, generatedAt: 0, windowHours: 30, fees: feeList } : url.includes("gauge-history") ? { chainId: 8453, gauge: "0x3", generatedAt: 0, fees: [], weights: [], flow: null, steady: null } : { chainId: 8453, generatedAt: 0, totalWeight: 1, gauges }),
    }));
    vi.stubGlobal("fetch", f);
    render(<GaugeTable />);
    await screen.findByText(/per day, best split of your amount/);
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("T3/USDC");
    fireEvent.click(screen.getByRole("button", { name: "Steady" }));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("T5/USDC");
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("4/4");
    fireEvent.click(screen.getAllByRole("button", { name: "history" })[0]);
    expect(await screen.findByText(/Not enough history yet/)).toBeInTheDocument();
    expect(f).toHaveBeenCalledWith(expect.stringContaining("/api/gauge-history?chain=8453&gauge=0x5"));
  });

  it("flags a gauge whose incentives just appeared, and labels incentive-paid gauges instead of showing a fee count", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
    const flows = { chainId: 8453, spanHours: 12, flows: [], newIncentives: [{ gauge: "0x3", usdPerWeek: 428, withinHours: 3 }] };
    const g = gauges.map((x, i) => (i === 3 ? { ...x, incentivesUsdPerWeek: 700 } : x));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes("gauge-flows") ? flows : url.includes("gauge-fees") ? { chainId: 8453, generatedAt: 0, windowHours: 30, fees: [{ gauge: "0x3", feesUsdPerDay: 20, windowHours: 30, steady: { buckets: 4, paying: 1 } }] } : { chainId: 8453, generatedAt: 0, totalWeight: 1, gauges: g }),
    })));
    render(<GaugeTable />);
    expect((await screen.findByText(/New incentives, last day/)).closest("p")).toHaveTextContent("T3/USDC $428/week");
    expect(screen.getByText(/new incentives · \$428\/week, appeared within 3 h/)).toBeInTheDocument();
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("incentives");
    expect(screen.getAllByRole("row")[1]).not.toHaveTextContent("1/4");
  });

  describe("phone mode and the steadiest-only filter", () => {
    const stub = (feeRows: Array<{ gauge: string; feesUsdPerDay: number; windowHours: number; steady?: { buckets: number; paying: number } }>) => {
      vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
      vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => (url.includes("gauge-fees") ? { chainId: 8453, generatedAt: 0, windowHours: 40, fees: feeRows } : { chainId: 8453, generatedAt: 0, totalWeight: 1, gauges }) })));
    };

    it("shows the quick split with one button to the positions panel, and folds the long parts until 'more' is pressed", async () => {
      stub([{ gauge: "0x3", feesUsdPerDay: 1000, windowHours: 40 }, { gauge: "0x4", feesUsdPerDay: 900, windowHours: 40 }]);
      const { container } = render(<GaugeTable />);
      expect(await screen.findByText("Best split for your amount")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "allocate from my wallet" })).toHaveAttribute("href", "#positions");
      // Folded on phones, always shown from sm up: the class pair carries both.
      const folded = container.querySelectorAll(".hidden.sm\\:block");
      expect(folded.length).toBeGreaterThanOrEqual(2);
      const more = screen.getByRole("button", { name: /more: explanations/ });
      expect(more).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(more);
      expect(container.querySelectorAll(".hidden.sm\\:block")).toHaveLength(0);
      expect(screen.getByRole("button", { name: "hide the details" })).toHaveAttribute("aria-expanded", "true");
    });

    it("keeps everything visible without a fee estimate (nothing to summarise yet)", async () => {
      vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS + 3600_000);
      vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("gauge-fees") ? { ok: false, status: 500 } : { ok: true, json: async () => ({ chainId: 8453, generatedAt: 0, totalWeight: 1, gauges }) })));
      const { container } = render(<GaugeTable />);
      await screen.findByText("T0/USDC");
      expect(screen.queryByText("Best split for your amount")).not.toBeInTheDocument();
      expect(container.querySelectorAll(".hidden.sm\\:block")).toHaveLength(0);
    });

    it("'steadiest only' keeps gauges whose every half-day paid and drops patchy, bursty and unmeasured ones", async () => {
      stub([
        { gauge: "0x1", feesUsdPerDay: 500, windowHours: 40, steady: { buckets: 6, paying: 6 } },
        { gauge: "0x2", feesUsdPerDay: 800, windowHours: 40, steady: { buckets: 6, paying: 4 } },
        { gauge: "0x3", feesUsdPerDay: 900, windowHours: 40 },
      ]);
      render(<GaugeTable />);
      await screen.findByText("Best split for your amount");
      const chip = screen.getByRole("button", { name: "steadiest only" });
      expect(chip).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(chip);
      expect(chip).toHaveAttribute("aria-pressed", "true");
      const rows = screen.getAllByRole("row");
      expect(rows).toHaveLength(2); // header + T1
      expect(rows[1]).toHaveTextContent("T1/USDC");
      expect(screen.getByText(/1 of 3 ranked gauges/)).toBeInTheDocument();
    });

    it("says so when no gauge passes the filter", async () => {
      stub([{ gauge: "0x1", feesUsdPerDay: 500, windowHours: 40, steady: { buckets: 6, paying: 3 } }]);
      render(<GaugeTable />);
      await screen.findByText("Best split for your amount");
      fireEvent.click(screen.getByRole("button", { name: "steadiest only" }));
      expect(screen.getByText(/No gauge has a clean fee record right now/)).toBeInTheDocument();
    });
  });
});
