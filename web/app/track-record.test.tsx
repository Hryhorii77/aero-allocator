import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TrackSummary } from "@/lib/track-record";
import { TrackRecordPanel } from "./track-record";

const base: TrackSummary = { chainId: 8453, amount: 10_000, logged: 5, evaluated: 3, needed: 14, rows: [] };
const stub = (data: unknown, ok = true) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => data })));

afterEach(() => vi.unstubAllGlobals());

describe("TrackRecordPanel", () => {
  it("says how far along it is and shows no result before enough days are checked", async () => {
    stub(base);
    render(<TrackRecordPanel />);
    expect(await screen.findByText(/Does the advice hold up/)).toBeInTheDocument();
    expect(screen.getByText(/Results appear after 14 checked days/)).toBeInTheDocument();
    expect(screen.getByText(/5 logged, 3 checked/)).toBeInTheDocument();
    expect(screen.queryByText(/median/)).not.toBeInTheDocument();
  });

  it("shows the median, the averages and the low-case count once there are enough days, with a day-by-day list", async () => {
    stub({
      ...base,
      logged: 20,
      evaluated: 16,
      results: { medianRealizedOfPredicted: 0.62, atLeastLow: 11, avgPredictedUsd: 10.5, avgRealizedUsd: 6.8 },
      rows: [
        { day: 20_400, parts: [{ s: "A/B", pct: 60 }, { s: "C/D", pct: 40 }], paceUsd: 10.5, lowUsd: 5, realizedUsd: 6.8 },
        { day: 20_399, parts: [{ s: "A/B", pct: 100 }], paceUsd: 9, lowUsd: 4, realizedUsd: null },
      ],
    });
    render(<TrackRecordPanel />);
    expect(await screen.findByText(/median/)).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText(/It paid at least the low case on 11 of 16 days/)).toBeInTheDocument();
    expect(screen.getByText("A/B 60% · C/D 40%")).toBeInTheDocument();
    expect(screen.getByText("not checked yet")).toBeInTheDocument();
    expect(screen.getByText(/not a promise about the future/)).toBeInTheDocument();
  });

  it("renders nothing when the record can't be read", async () => {
    stub({}, false);
    const { container } = render(<TrackRecordPanel />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("on its own page says it is loading, then why it failed, instead of rendering nothing", async () => {
    stub({}, false);
    render(<TrackRecordPanel standalone />);
    expect(screen.getByText(/Loading the track record/)).toBeInTheDocument();
    expect(await screen.findByText(/Couldn.t load the track record/)).toBeInTheDocument();
  });

  it("uses an h1 on its own page and links to that page from the home-page panel", async () => {
    stub(base);
    const { unmount } = render(<TrackRecordPanel standalone />);
    expect(await screen.findByRole("heading", { level: 1, name: /Does the advice hold up/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "own page" })).not.toBeInTheDocument();
    unmount();
    render(<TrackRecordPanel />);
    expect(await screen.findByRole("link", { name: "own page" })).toHaveAttribute("href", "/track-record");
  });

  it("lists the logged days before results only on its own page, open, with each still marked not checked", async () => {
    const early = { ...base, logged: 1, evaluated: 0, rows: [{ day: 20_757, parts: [{ s: "WETH/LCAP · CL200", pct: 74.03 }, { s: "cbETH/WETH · CL1", pct: 25.97 }], paceUsd: 5.24, lowUsd: 4.2, realizedUsd: null }] };
    stub(early);
    const { unmount, container } = render(<TrackRecordPanel standalone />);
    expect(await screen.findByText("WETH/LCAP · CL200 74.03% · cbETH/WETH · CL1 25.97%")).toBeInTheDocument();
    expect(screen.getByText("not checked yet")).toBeInTheDocument();
    expect(screen.getByText(/\$5\.24 predicted/)).toBeInTheDocument();
    expect(container.querySelector("details")).toHaveAttribute("open");
    expect(screen.queryByText(/median/)).not.toBeInTheDocument();
    unmount();
    render(<TrackRecordPanel />);
    expect(await screen.findByText(/1 logged, 0 checked/)).toBeInTheDocument();
    expect(screen.queryByText("Day by day")).not.toBeInTheDocument();
  });
});
