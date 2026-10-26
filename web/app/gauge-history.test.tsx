import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GaugeHistoryPanel } from "./gauge-history";

const base = { chainId: 8453, gauge: "0xabc", generatedAt: 0 };

describe("GaugeHistoryPanel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("draws the fee bars and says how steady the gauge was", async () => {
    const fees = [10, 0, 30, 20].map((usd, i) => ({ t: 1_000_000 + i * 21_600, usd }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...base, fees, weights: [], flow: null, steady: { buckets: 4, paying: 3 } }) })));
    render(<GaugeHistoryPanel chainId={8453} gauge="0xabc" />);
    expect(await screen.findByRole("img", { name: /Fees released per 6 hours.*\$30/ })).toBeInTheDocument();
    expect(screen.getByText(/3 of 4/)).toBeInTheDocument();
    expect(screen.getByText(/tallest bar \$30/)).toBeInTheDocument();
    expect(screen.getByText(/Mon 13:00 UTC/)).toBeInTheDocument();
    expect(screen.getByText(/power line appears once weight snapshots/)).toBeInTheDocument();
  });

  it("adds the power line and the share change once snapshots exist", async () => {
    const fees = [5, 5, 5].map((usd, i) => ({ t: 1_000_000 + i * 21_600, usd }));
    const weights = [{ t: 1_000_000, weight: 100 }, { t: 1_020_000, weight: 150 }];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...base, fees, weights, flow: { gauge: "0xabc", sharePctChange: 18, powerChange: 50, weight: 150 }, steady: null }) })));
    const { container } = render(<GaugeHistoryPanel chainId={8453} gauge="0xabc" />);
    expect(await screen.findByText(/\+18%/)).toBeInTheDocument();
    expect(container.querySelector("polyline")).not.toBeNull();
    expect(screen.getByText(/needs three complete half-days/)).toBeInTheDocument();
  });

  it("says so when there is not enough history, and when the read fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...base, fees: [], weights: [], flow: null, steady: null }) })));
    const a = render(<GaugeHistoryPanel chainId={8453} gauge="0xabc" />);
    expect(await screen.findByText(/Not enough history yet/)).toBeInTheDocument();
    a.unmount();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    render(<GaugeHistoryPanel chainId={8453} gauge="0xabc" />);
    expect(await screen.findByText(/Couldn.t load this gauge/)).toBeInTheDocument();
  });

  it("adds a per-day chart once the daily record has two days", async () => {
    const fees = [5, 5, 5].map((usd, i) => ({ t: 1_000_000 + i * 21_600, usd }));
    const daily = [{ t: 86_400 * 10, feesUsd: 40, weight: null, incentivesUsdPerWeek: null }, { t: 86_400 * 11, feesUsd: 20, weight: 5, incentivesUsdPerWeek: 0 }];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...base, fees, weights: [], flow: null, steady: null, daily }) })));
    render(<GaugeHistoryPanel chainId={8453} gauge="0xabc" />);
    expect(await screen.findByRole("img", { name: /per day over 2 days, up to \$40/ })).toBeInTheDocument();
    expect(screen.getByText(/\$30/)).toBeInTheDocument();
    expect(screen.getByText(/tallest day \$40/)).toBeInTheDocument();
  });

  it("shows no per-day chart with one day, or from an older response that has none", async () => {
    const fees = [5, 5, 5].map((usd, i) => ({ t: 1_000_000 + i * 21_600, usd }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...base, fees, weights: [], flow: null, steady: null, daily: [{ t: 864_000, feesUsd: 1, weight: null, incentivesUsdPerWeek: null }] }) })));
    const a = render(<GaugeHistoryPanel chainId={8453} gauge="0xabc" />);
    await screen.findByRole("img", { name: /per 6 hours/ });
    expect(screen.queryByRole("img", { name: /per day/ })).toBeNull();
    a.unmount();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...base, fees, weights: [], flow: null, steady: null }) })));
    render(<GaugeHistoryPanel chainId={8453} gauge="0xabc" />);
    await screen.findByRole("img", { name: /per 6 hours/ });
    expect(screen.queryByRole("img", { name: /per day/ })).toBeNull();
  });
});
