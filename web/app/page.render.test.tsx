import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import Dashboard, { CurrentVsRecommended } from "./page";

const dashboardPayload = {
  generatedAt: 1_700_000_000_000,
  epochStart: 1_699_900_000,
  epochProgressPct: 42.5,
  pools: [
    {
      lp: "0xpoolA",
      symbol: "POOL-A",
      poolType: "v2-volatile",
      tvlUsd: 1_000_000,
      predictedFeesUsd: 200,
      lastEpochFeesUsd: 50,
      feeTrendUsdPerEpoch: 5,
      currentBribesUsd: 0,
      voteSharePct: 10,
      demandSharePct: 12,
      edgePct: 2,
      rewardPer1kVotesUsd: 1.1,
      confidence: 0.7,
      feeHistory: [30, 35, 40, 45, 50],
    },
    {
      lp: "0xpoolB",
      symbol: "POOL-B",
      poolType: "concentrated",
      tvlUsd: 2_000_000,
      predictedFeesUsd: 100,
      lastEpochFeesUsd: 500,
      feeTrendUsdPerEpoch: -3,
      currentBribesUsd: 0,
      voteSharePct: 5,
      demandSharePct: 4,
      edgePct: -1,
      rewardPer1kVotesUsd: 0.9,
      confidence: 0.6,
      feeHistory: [560, 545, 530, 515, 500],
    },
    {
      // Deliberately last in every sort below (lowest predictedFeesUsd AND
      // lowest lastEpochFeesUsd) — a near-zero-current-votes micro pool,
      // the exact pattern that inflates $/1k votes into a misleading
      // "opportunity" when someone sorts by that column.
      lp: "0xpoolC",
      symbol: "POOL-C",
      poolType: "v2-volatile",
      tvlUsd: 60_000,
      predictedFeesUsd: 20,
      lastEpochFeesUsd: 5,
      feeTrendUsdPerEpoch: 1,
      currentBribesUsd: 0,
      voteSharePct: 0.02,
      demandSharePct: 0.03,
      edgePct: 0.01,
      rewardPer1kVotesUsd: 8.4,
      confidence: 0.78,
      feeHistory: [5],
    },
  ],
  voterAlloc: {
    objective: "voter_roi",
    summary: "test voter_roi summary",
    allocations: [
      {
        pool: "0xpoolA",
        symbol: "POOL-A",
        weightPct: 80,
        currentVoteSharePct: 10,
        predictedDemandSharePct: 12,
        predictiveEdgePct: 2,
        tvlUsd: 1_000_000,
        currentVotes: 58_330,
        votesAllocated: 8_000,
        expectedRewardUsd: 42,
        confidence: 0.7,
      },
    ],
  },
  protoAlloc: { objective: "protocol_efficiency", summary: "test protocol_efficiency summary", allocations: [] },
  edgeAlloc: { objective: "edge_hunter", summary: "test edge_hunter summary", allocations: [] },
  lpDeposits: { rewardTokenSymbol: "AERO", opportunities: [] },
  voteSwings: { epochProgressPct: 42.5, risers: [], fallers: [] },
  trackRecord: {
    epochsWindow: 26,
    poolsAnalyzed: 30,
    samplePoints: 624,
    overall: { maeUsd: 3181, wapePct: 34.5, directionalAccuracyPct: 57.2, skillVsBaselineWapePct: 5.6 },
    byConfidence: [
      { range: "0.00–0.30", n: 49, wapePct: 40.5 },
      { range: "0.30–0.60", n: 207, wapePct: 33.3 },
      { range: "0.60–1.00", n: 368, wapePct: 34.2 },
    ],
    methodology: "Walk-forward replay of completed epochs against a naive persistence baseline.",
  },
  paStatus: { applicable: true, live: false },
};

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

function renderDashboard() {
  const queryClient = new QueryClient();
  return render(
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Dashboard />
      </QueryClientProvider>
    </WagmiProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const s = String(url);
      if (s.includes("/api/dashboard")) return jsonResponse(dashboardPayload);
      if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
      throw new Error(`unexpected fetch in test: ${s}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

// "POOL-A"/"POOL-B" appear twice once loaded (the hot-pools table row and
// the bribe-simulator's pool <select> is pre-filled with the top pool) —
// findAllByText both waits for load and sidesteps that ambiguity.
const waitForPoolsLoaded = () => screen.findAllByText("POOL-A");

describe("Dashboard", () => {
  it("shows a loading state, then renders pool rows from /api/dashboard", async () => {
    renderDashboard();
    expect(screen.getByText(/building live snapshot/i)).toBeInTheDocument();

    expect((await waitForPoolsLoaded()).length).toBeGreaterThan(0);
    expect(screen.getAllByText("POOL-B").length).toBeGreaterThan(0);
  });

  it("shows an error banner (not a crash) when /api/dashboard responds non-OK with an error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) return jsonResponse({ error: "Rate limit exceeded. Try again in 30s." }, false);
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
    renderDashboard();
    expect(await screen.findByText(/rate limit exceeded/i)).toBeInTheDocument();
  });

  it("re-sorts pool rows when a sort column header is clicked", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    const rowsInOrder = () =>
      Array.from(document.querySelectorAll("tbody tr")).map((tr) => within(tr as HTMLElement).queryByText(/POOL-[ABC]/)?.textContent);

    // Default sort is predictedFeesUsd desc: POOL-A (200), POOL-B (100), POOL-C (20).
    expect(rowsInOrder()).toEqual(["POOL-A", "POOL-B", "POOL-C"]);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /last epoch/i }));

    // lastEpochFeesUsd desc: POOL-B (500), POOL-A (50), POOL-C (5).
    expect(rowsInOrder()).toEqual(["POOL-B", "POOL-A", "POOL-C"]);
  });

  // Scoped to the hot-pools <section> specifically — POOL-A also appears in
  // the unrelated voter_roi allocation table below, which the search/filter
  // controls don't (and shouldn't) touch.
  function hotPoolsSection() {
    return screen.getByPlaceholderText(/search symbol/i).closest("section") as HTMLElement;
  }

  it("narrows the hot-pools table to symbols matching the search box", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/search symbol/i), "pool-b");

    await waitFor(() => expect(within(hotPoolsSection()).queryAllByText("POOL-A")).toHaveLength(0));
    expect(within(hotPoolsSection()).getAllByText("POOL-B").length).toBeGreaterThan(0);
    expect(screen.getByText(/showing top 1 of 1 matching pools/i)).toBeInTheDocument();
  });

  it("narrows the hot-pools table by a filter chip, and reports when nothing matches", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // None of the fixture pools have lastEpochFeesUsd === 0, so "new this
    // epoch" should empty the table out entirely rather than silently
    // showing stale rows.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "new this epoch" }));

    expect(await screen.findByText(/no pools match this search\/filter/i)).toBeInTheDocument();
    expect(within(hotPoolsSection()).queryAllByText("POOL-A")).toHaveLength(0);
  });

  it("clears back to the full table when the 'all' chip is clicked again", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "new this epoch" }));
    await screen.findByText(/no pools match this search\/filter/i);

    await user.click(screen.getByRole("button", { name: "all" }));

    expect(within(hotPoolsSection()).getAllByText("POOL-A").length).toBeGreaterThan(0);
    expect(screen.queryByText(/no pools match this search\/filter/i)).not.toBeInTheDocument();
  });

  it("expands a pool row to reveal its fee-history sparkline, and collapses it again", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    expect(screen.queryByRole("img", { name: /fee history sparkline/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /expand POOL-A fee history/i }));

    expect(screen.getByRole("img", { name: /fee history sparkline, rising overall/i })).toBeInTheDocument();
    expect(screen.getByText(/fees, last 5 completed epochs: \$30 → \$50/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /collapse POOL-A fee history/i }));

    expect(screen.queryByRole("img", { name: /fee history sparkline/i })).not.toBeInTheDocument();
  });

  it("shows a falling sparkline for a pool with declining fee history", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /expand POOL-B fee history/i }));

    expect(screen.getByRole("img", { name: /fee history sparkline, falling overall/i })).toBeInTheDocument();
  });

  it("explains there isn't enough history yet for a pool with a single data point", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /expand POOL-C fee history/i }));

    expect(screen.getByText(/not enough completed epochs yet for a trend line/i)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /fee history sparkline/i })).not.toBeInTheDocument();
  });

  it("explains that trend/epoch is a regression slope, not predicted-minus-last", async () => {
    renderDashboard();
    await waitForPoolsLoaded();
    // Grok round 2 flagged this as a real contradiction: feeTrendUsdPerEpoch
    // can point the opposite direction from (predictedFeesUsd -
    // lastEpochFeesUsd) since it's a multi-epoch regression slope, not that
    // subtraction — the header's title should say so.
    const headers = screen.getAllByRole("button", { name: /trend\/epoch/i }).map((b) => b.closest("th")!);
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header.title).toMatch(/regression/i);
      expect(header.title).toMatch(/not simply predicted minus last/i);
    }
  });

  it("gives the trend/epoch arrow a fixed-width slot so it doesn't drift with the amount's length", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // Plain "{arrow} {amount}" inline text lets the arrow's x-position
    // drift row to row, since ▲/▼ aren't the same glyph width and the
    // amount's length varies — right-aligning the whole string only pins
    // the amount's right edge, not the arrow's (spotted live: arrows
    // visibly out of line down the column). A fixed first grid column for
    // the arrow keeps it in a straight line regardless of amount length.
    const tbody = document.querySelector("tbody")!;
    const up = within(within(tbody).getByText("POOL-A").closest("tr")!).getByText("▲");
    const down = within(within(tbody).getByText("POOL-B").closest("tr")!).getByText("▼");
    for (const arrow of [up, down]) {
      const cellContent = arrow.parentElement!;
      expect(cellContent.className).toMatch(/grid-cols-\[14px_1fr\]/);
    }
  });

  it("keeps a pool row on one line instead of wrapping a long symbol onto a second line", async () => {
    renderDashboard();
    await waitForPoolsLoaded();
    // A long symbol like "CL200-WETH/MORPHO" was observed wrapping onto a
    // second line in production, making that row taller than its neighbors
    // — the cell had no whitespace-nowrap, unlike its sm:hidden mobile-card
    // twin which already truncates instead of wrapping.
    const tbody = document.querySelector("tbody")!;
    const td = within(tbody).getByText("POOL-A").closest("td")!;
    expect(td.className).toMatch(/whitespace-nowrap/);
  });

  it("shows a numeric confidence percentage, not just a bar", async () => {
    renderDashboard();
    await waitForPoolsLoaded();
    // POOL-A's confidence is 0.7 -> "70%"; relying only on bar width doesn't
    // let a reader distinguish e.g. 0.77 from 0.78 at a glance. The hot-pools
    // table and its sm:hidden mobile-card twin both render "70%" in jsdom
    // (CSS media queries don't hide anything here), so scope to the table.
    const tbody = document.querySelector("tbody")!;
    expect(within(tbody).getByText("70%")).toBeInTheDocument();
    expect(within(tbody).getByText("60%")).toBeInTheDocument();
  });

  it("flags a near-zero-current-vote pool's $/1k figure as unreliable", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // getByText("POOL-C") is ambiguous — it also appears as an <option> in
    // the bribe-simulator's pool <select> — so scope to the hot-pools table.
    const tbody = document.querySelector("tbody")!;
    const row = within(tbody).getByText("POOL-C").closest("tr")!;
    expect(within(row).getByText("⚠")).toBeInTheDocument();

    // POOL-A/POOL-B have real vote share (10%, 5%) and shouldn't be flagged.
    const rowA = within(tbody).getByText("POOL-A").closest("tr")!;
    expect(within(rowA).queryByText("⚠")).not.toBeInTheDocument();
  });

  it("reserves a fixed-width slot for the ⚠ so the $/1k amount doesn't shift left when it's absent", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // The warning icon used to sit right after the amount in one
    // right-aligned text run, so its presence/absence shifted where the
    // dollar figure itself landed row to row (spotted live) — same
    // underlying cause as the trend/epoch arrow drift. A fixed-width
    // second grid column keeps the amount's position constant either way.
    const tbody = document.querySelector("tbody")!;
    const flaggedAmount = within(within(tbody).getByText("POOL-C").closest("tr")!).getByText("$8.40");
    const unflaggedAmount = within(within(tbody).getByText("POOL-A").closest("tr")!).getByText("$1.10");
    for (const amount of [flaggedAmount, unflaggedAmount]) {
      expect(amount.parentElement!.className).toMatch(/grid-cols-\[1fr_14px\]/);
    }
  });

  it("retitles the hot-pools section and warns when sorted by $/1k votes", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // Default sort (predictedFeesUsd) keeps the "hot pools" framing.
    expect(screen.getByText(/predicted hot pools/i)).toBeInTheDocument();
    expect(screen.queryByText(/thin gauges/i)).not.toBeInTheDocument();

    // Grok round 3: sorting by $/1k votes puts empty-denominator gauges
    // (near-zero votes, trivial fees) at the top under the "hot pools"
    // label, which reads as an opportunity ranking instead of a volatility
    // warning. The section itself must relabel, not just the one cell.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /\$\/1k votes/i }));

    expect(screen.getByText(/thin gauges/i)).toBeInTheDocument();
    expect(screen.queryByText(/predicted hot pools/i)).not.toBeInTheDocument();
    expect(screen.getByText(/most unstable number on the page/i)).toBeInTheDocument();

    // POOL-C (near-zero vote share) should read "no votes yet" instead of
    // a fake-precise "0.0% → 0.0%" in the votes-vs-demand column.
    const tbody = document.querySelector("tbody")!;
    const rowC = within(tbody).getByText("POOL-C").closest("tr")!;
    expect(within(rowC).getByText("no votes yet")).toBeInTheDocument();
  });

  it("shows a stacked ▲▼ affordance on inactive sortable headers, replaced by a single bold arrow once active", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // Previously an inactive sortable header showed no arrow at all,
    // looking identical to the non-sortable "pool" header — no way to
    // tell which columns were clickable without trying.
    const edgeHeader = screen.getByRole("button", { name: /^edge/i });
    expect(edgeHeader).toHaveTextContent("▲");
    expect(edgeHeader).toHaveTextContent("▼");

    const user = userEvent.setup();
    await user.click(edgeHeader);
    expect(edgeHeader).not.toHaveTextContent("▲");
    expect(edgeHeader).toHaveTextContent("▼");
  });

  it("keeps the $/1k-votes warning sort out of the shareable URL (Grok round 4)", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /\$\/1k votes/i }));

    // The in-page view does switch to the warning sort...
    expect(screen.getByText(/thin gauges/i)).toBeInTheDocument();
    // ...but the address bar a user would copy/share stays off it — "don't
    // tweet the warning mode as the homepage".
    expect(window.location.search).not.toMatch(/sort=rewardPer1kVotesUsd/);

    // Sorting by a normal column does restore it into the URL.
    await user.click(screen.getByRole("button", { name: /^edge/i }));
    expect(window.location.search).toMatch(/sort=edgePct/);
  });

  it("shows TVL, current votes, and gauge-share context under a Voter ROI allocation row", async () => {
    renderDashboard();
    await waitForPoolsLoaded();
    // Regression coverage for a real trust gap Grok flagged: two rows with
    // the same weightPct look identical without this — one could be an
    // established gauge, the other a thin one your vote would dominate.
    expect(screen.getByText(/\$1,000,000 TVL/)).toBeInTheDocument();
    expect(screen.getByText(/58,330 votes now/)).toBeInTheDocument();
    expect(screen.getByText(/your vote ≈ 12\.1% of this gauge/)).toBeInTheDocument();
  });

  it("lets the veAERO voting-power input be cleared and retyped without a stuck leading zero", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // Number("") is 0, so clearing the field down to empty and rendering
    // value={0} back would put a literal "0" in the DOM — the next digit
    // typed then appends onto it ("0" + "2" = "02") instead of replacing
    // it, so 10,000 could never become 200 (spotted live: the field got
    // stuck showing "01").
    const votingPowerInput = screen.getAllByRole("spinbutton")[0];
    const user = userEvent.setup();
    await user.clear(votingPowerInput);
    expect(votingPowerInput).toHaveValue(null); // genuinely empty, not "0"
    await user.type(votingPowerInput, "200");
    expect(votingPowerInput).toHaveValue(200);
  });

  it("lets the bribe-budget input be cleared and retyped without a stuck leading zero", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // Same bug, same fix, second occurrence spotted live on this input.
    const bribeBudgetInput = screen.getAllByRole("spinbutton")[1];
    const user = userEvent.setup();
    await user.clear(bribeBudgetInput);
    expect(bribeBudgetInput).toHaveValue(null);
    await user.type(bribeBudgetInput, "750");
    expect(bribeBudgetInput).toHaveValue(750);
  });

  it("deep-links a pool symbol to its exact pool on the protocol's own vote page", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // Confirmed live against aerodrome.finance: /vote?query=<pool address>
    // pre-filters to exactly that one pool.
    const tbody = document.querySelector("tbody")!;
    const link = within(tbody).getByRole("link", { name: "POOL-A" });
    expect(link).toHaveAttribute("href", "https://aerodrome.finance/vote?query=0xpoolA");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("deep-links an LP-yield pool to the liquidity/deposit page instead of vote", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) {
          return jsonResponse({
            ...dashboardPayload,
            lpDeposits: {
              rewardTokenSymbol: "AERO",
              opportunities: [
                {
                  pool: "0xlp1",
                  symbol: "LP-POOL",
                  poolType: "concentrated",
                  stakedTvlUsd: 1000,
                  currentEpochAprPct: 10,
                  predictedNextEpochAprPct: 12,
                  emissionsTrendUsdPerEpoch: 1,
                  confidence: 0.7,
                },
              ],
            },
          });
        }
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
    renderDashboard();
    await waitForPoolsLoaded();

    // Now rendered twice (mobile card + desktop table, both always present
    // in jsdom since it doesn't evaluate the sm: breakpoint) — every copy
    // should point at the same link.
    const links = await screen.findAllByRole("link", { name: "LP-POOL" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "https://aerodrome.finance/liquidity?query=0xlp1");
    }
  });

  it("flags a pool with zero last-epoch fees as new instead of showing a meaningless edge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) {
          return jsonResponse({
            ...dashboardPayload,
            pools: [
              { ...dashboardPayload.pools[0], lp: "0xnew", symbol: "NEW-POOL", lastEpochFeesUsd: 0, edgePct: -26.35 },
              ...dashboardPayload.pools,
            ],
          });
        }
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
    renderDashboard();
    await waitForPoolsLoaded();

    const tbody = document.querySelector("tbody")!;
    const row = within(tbody).getByText("NEW-POOL").closest("tr")!;
    expect(within(row).getByText("new")).toBeInTheDocument();
    // The wild -26.35pp edge (a real example from live feedback) is
    // meaningless without a fee baseline — it shouldn't render at all.
    expect(within(row).queryByText(/-26\.35pp/)).not.toBeInTheDocument();
    expect(within(row).getByText("n/a")).toBeInTheDocument();

    // A pool with real history still shows its actual edge badge.
    const rowA = within(tbody).getByText("POOL-A").closest("tr")!;
    expect(within(rowA).queryByText("new")).not.toBeInTheDocument();
    expect(within(rowA).getByText("+2.00pp")).toBeInTheDocument();
  });

  it("suppresses individual confidence bars once every visible value clusters tightly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) {
          return jsonResponse({
            ...dashboardPayload,
            pools: dashboardPayload.pools.map((p) => ({ ...p, confidence: 0.77 })),
          });
        }
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
    renderDashboard();
    await waitForPoolsLoaded();

    const tbody = document.querySelector("tbody")!;
    const row = within(tbody).getByText("POOL-A").closest("tr")!;
    // The number still renders...
    expect(within(row).getByText("77%")).toBeInTheDocument();
    // ...but no bar-width graphic, since it can't discriminate anything
    // here — every visible pool is the same confidence.
    expect(row.querySelector(".bg-neutral-800.h-1\\.5")).not.toBeInTheDocument();
    expect(screen.getByText(/confidence is calibrated and clusters tightly/i)).toBeInTheDocument();
  });

  it("keeps individual confidence bars when values actually differ (default fixture)", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    const tbody = document.querySelector("tbody")!;
    const row = within(tbody).getByText("POOL-A").closest("tr")!;
    expect(row.querySelector(".bg-neutral-800.h-1\\.5")).toBeInTheDocument();
    expect(screen.queryByText(/confidence is calibrated and clusters tightly/i)).not.toBeInTheDocument();
  });

  it("renders a CSV export control for each allocation objective", async () => {
    renderDashboard();
    await waitForPoolsLoaded();
    expect(screen.getAllByText(/export csv/i).length).toBeGreaterThan(0);
  });

  it("shows a weekly-gauge-voting status chip when Predictive Allocation isn't live yet", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    expect(screen.getByText("weekly gauge voting")).toBeInTheDocument();
    expect(screen.queryByText("Predictive Allocation live")).not.toBeInTheDocument();
    expect(screen.getByText(/Dromos Labs' Predictive Allocation is expected to replace it/i)).toBeInTheDocument();
  });

  it("flips the status chip once Predictive Allocation goes live, no code change needed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) {
          return jsonResponse({ ...dashboardPayload, paStatus: { applicable: true, live: true } });
        }
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
    renderDashboard();
    await waitForPoolsLoaded();

    expect(screen.getByText("Predictive Allocation live")).toBeInTheDocument();
    expect(screen.queryByText("weekly gauge voting")).not.toBeInTheDocument();
  });

  it("hides the PA status chip entirely on a deployment it doesn't apply to (e.g. Velodrome)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) {
          return jsonResponse({ ...dashboardPayload, paStatus: { applicable: false, live: false } });
        }
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
    renderDashboard();
    await waitForPoolsLoaded();

    expect(screen.queryByText("weekly gauge voting")).not.toBeInTheDocument();
    expect(screen.queryByText("Predictive Allocation live")).not.toBeInTheDocument();
    expect(screen.queryByText(/Predictive Allocation is expected to replace it/i)).not.toBeInTheDocument();
  });

  it("shows the wallet-connect prompt (not connected by default in tests)", async () => {
    renderDashboard();
    await waitForPoolsLoaded();
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
  });

  it("lets the header's control chips (epoch countdown, refresh, connect wallet) wrap onto their own lines on narrow viewports", async () => {
    renderDashboard();
    await waitForPoolsLoaded();
    // Without flex-wrap here, these chips are squeezed into one unbreakable
    // row and their own text wraps mid-phrase instead ("votes flip in 4d
    // 3h" splitting across lines) on a phone-width screen — regression
    // guard for that, since jsdom doesn't do real responsive layout.
    const connectButton = screen.getByRole("button", { name: /connect wallet/i });
    const controlsRow = connectButton.closest("div.flex")!;
    expect(controlsRow.className).toMatch(/\bflex-wrap\b/);
  });

  it("gives the LP staking yield table an sm:hidden mobile-card twin, same as the predicted-hot-pools table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) {
          return jsonResponse({
            ...dashboardPayload,
            lpDeposits: {
              rewardTokenSymbol: "AERO",
              opportunities: [
                {
                  pool: "0xlp1",
                  symbol: "LP-POOL",
                  poolType: "concentrated",
                  stakedTvlUsd: 1000,
                  currentEpochAprPct: 10,
                  predictedNextEpochAprPct: 12,
                  emissionsTrendUsdPerEpoch: 1,
                  confidence: 0.7,
                },
              ],
            },
          });
        }
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
    renderDashboard();
    await waitForPoolsLoaded();

    // Grok round 8: "mobile is a wide table" — a 6-column table clipped to
    // ~2 visible columns on a phone hides most of what was sorted by.
    const links = screen.getAllByRole("link", { name: "LP-POOL" });
    expect(links.length).toBe(2); // one in the sm:hidden card, one in the table
    const card = links[0].closest(".sm\\:hidden")!;
    expect(card).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText(/staked/i)).toBeInTheDocument();

    const td = links[1].closest("td")!;
    expect(td.className).toMatch(/whitespace-nowrap/);
  });

  it("renders the forecast-accuracy track record panel from /api/dashboard's trackRecord field", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    expect(screen.getByText(/forecast accuracy/i)).toBeInTheDocument();
    expect(screen.getByText("34.5%")).toBeInTheDocument(); // overall WAPE
    expect(screen.getByText("57.2%")).toBeInTheDocument(); // directional accuracy
    expect(screen.getByText("+5.6%")).toBeInTheDocument(); // skill vs. baseline
    expect(screen.getByText(/624 pts/)).toBeInTheDocument();
    expect(screen.getByText(/conf 0\.30–0\.60/)).toBeInTheDocument();
    expect(screen.getByText(/n=207/)).toBeInTheDocument();
  });

  it("states in plain language whether the forecast beats a naive last-epoch guess", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // "skill vs. naive baseline: +5.6%" doesn't read as an answer to "does
    // this beat just assuming last epoch repeats" without already knowing
    // that's exactly what the baseline is (Grok round 5) — this headline
    // sentence spells it out directly.
    expect(screen.getByText(/more accurate/i)).toBeInTheDocument();
    expect(screen.getByText(/simply assuming each epoch repeats the last one/i)).toBeInTheDocument();
    expect(screen.getByText(/by 5\.6%/)).toBeInTheDocument();
  });

  it("frames a negative skill-vs-baseline honestly as less accurate, not just a signed number", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) {
          return jsonResponse({
            ...dashboardPayload,
            trackRecord: {
              ...dashboardPayload.trackRecord,
              overall: { ...dashboardPayload.trackRecord.overall, skillVsBaselineWapePct: -4.2 },
            },
          });
        }
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
    renderDashboard();
    await waitForPoolsLoaded();

    expect(screen.getByText(/less accurate/i)).toBeInTheDocument();
    expect(screen.getByText(/by 4\.2%/)).toBeInTheDocument();
  });

  it("mutes the confidence bar on a thin (near-zero-vote) row instead of showing it as high confidence", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // POOL-C is the near-zero-vote row (voteSharePct: 0.02) with confidence
    // 0.78 — high enough to render as the "high confidence" sky-blue bar
    // unless muted, which sits contradictorily next to "no votes yet"
    // (Grok round 4: "don't put high confidence next to no votes yet").
    const tbody = document.querySelector("tbody")!;
    const rowC = within(tbody).getByText("POOL-C").closest("tr")!;
    const barC = rowC.querySelector(".bg-neutral-600, .bg-sky-500, .bg-sky-700")!;
    expect(barC.className).toContain("bg-neutral-600");
    expect(within(rowC).getByText("78%").className).toContain("text-neutral-600");

    // POOL-A has real vote share and keeps its normal (non-muted) styling.
    const rowA = within(tbody).getByText("POOL-A").closest("tr")!;
    const barA = rowA.querySelector(".bg-neutral-600, .bg-sky-500, .bg-sky-700")!;
    expect(barA.className).toContain("bg-sky-500");
  });

  it("hydrates from the last cached snapshot instead of blocking on the cold-start spinner, then clears once fresh data lands", async () => {
    window.localStorage.setItem(
      "aero-allocator:dashboard-cache:v1",
      JSON.stringify({ cachedAt: Date.now() - 5 * 60_000, data: dashboardPayload }),
    );
    renderDashboard();

    // Cached pools render on the very first paint — no cold-start spinner.
    expect(screen.getAllByText("POOL-A").length).toBeGreaterThan(0);
    expect(screen.queryByText(/building live snapshot/i)).not.toBeInTheDocument();
    expect(screen.getByText(/showing cached data from 5m ago/i)).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByText(/showing cached data from/i)).not.toBeInTheDocument());
  });

  it("omits the track record panel gracefully when the backtest wasn't available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) return jsonResponse({ ...dashboardPayload, trackRecord: null });
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
    renderDashboard();
    await waitForPoolsLoaded();

    expect(screen.queryByText(/forecast accuracy/i)).not.toBeInTheDocument();
  });

  it("keeps the changelog collapsed by default, expanding it on click", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // Collapsed <details> still puts its content in the DOM (native browser
    // behavior), so assert on visibility via the `open` attribute rather
    // than presence/absence of the text.
    const details = screen.getByText(/what's new/i).closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);

    const user = userEvent.setup();
    await user.click(screen.getByText(/what's new/i));

    expect(details.open).toBe(true);
    expect(screen.getByText(/search box \+ filter chips/i)).toBeInTheDocument();
  });
});

describe("CurrentVsRecommended", () => {
  const poolMeta = new Map([
    ["0xpoola", { symbol: "POOL-A", rewardPer1kVotesUsd: 1.1 }],
    ["0xpoolb", { symbol: "POOL-B", rewardPer1kVotesUsd: 0.9 }],
  ]);

  it("shows a message instead of a comparison when the veNFT hasn't voted yet", () => {
    render(<CurrentVsRecommended currentVotes={[]} votingPower={10_000} recommended={[]} poolMeta={poolMeta} />);
    expect(screen.getByText(/hasn.t voted yet this epoch/i)).toBeInTheDocument();
  });

  it("shows the pp delta between current and recommended for a pool in both", () => {
    render(
      <CurrentVsRecommended
        currentVotes={[{ pool: "0xpoolA", weightPct: 40 }]}
        votingPower={10_000}
        recommended={[
          {
            pool: "0xpoolA",
            symbol: "POOL-A",
            weightPct: 12,
            currentVoteSharePct: 5,
            predictedDemandSharePct: 6,
            predictiveEdgePct: 1,
            tvlUsd: 100,
            currentVotes: 1000,
            expectedRewardUsd: 50,
            confidence: 0.7,
          },
        ]}
        poolMeta={poolMeta}
      />,
    );

    const row = screen.getByText("POOL-A").closest("div")!;
    expect(within(row).getByText("40.0%")).toBeInTheDocument();
    expect(within(row).getByText("12.0%")).toBeInTheDocument();
    expect(within(row).getByText("-28.0pp")).toBeInTheDocument();
  });

  it("shows a pool the wallet currently holds but the model doesn't recommend as a 0% target", () => {
    render(
      <CurrentVsRecommended
        currentVotes={[{ pool: "0xpoolA", weightPct: 100 }]}
        votingPower={10_000}
        recommended={[]}
        poolMeta={poolMeta}
      />,
    );

    const row = screen.getByText("POOL-A").closest("div")!;
    expect(within(row).getByText("100.0%")).toBeInTheDocument();
    expect(within(row).getByText("0.0%")).toBeInTheDocument();
    expect(within(row).getByText("-100.0pp")).toBeInTheDocument();
  });

  it("falls back to a truncated address when a pool isn't in poolMeta or the recommendation", () => {
    render(
      <CurrentVsRecommended
        currentVotes={[{ pool: "0xUnknownPoolAddress00000000000000000000", weightPct: 100 }]}
        votingPower={10_000}
        recommended={[]}
        poolMeta={new Map()}
      />,
    );

    expect(screen.getByText(/^0xunknow.*…$/i)).toBeInTheDocument();
  });

  it("estimates next-epoch $ for staying from last epoch's $/1k rate, and for switching from the recommendation's own model", () => {
    render(
      <CurrentVsRecommended
        // 10,000 votingPower * 40% = 4,000 votes in POOL-A; rewardPer1kVotesUsd
        // 1.1 -> 4,000/1000 * 1.1 = $4.40 estimated if staying.
        currentVotes={[{ pool: "0xpoolA", weightPct: 40 }]}
        votingPower={10_000}
        recommended={[
          {
            pool: "0xpoolB",
            symbol: "POOL-B",
            weightPct: 100,
            currentVoteSharePct: 5,
            predictedDemandSharePct: 6,
            predictiveEdgePct: 1,
            tvlUsd: 100,
            currentVotes: 1000,
            expectedRewardUsd: 77,
            confidence: 0.7,
          },
        ]}
        poolMeta={poolMeta}
      />,
    );

    expect(screen.getByText("$4.4")).toBeInTheDocument();
    expect(screen.getByText("$77")).toBeInTheDocument();
    expect(screen.getByText(/not apples-to-apples/i)).toBeInTheDocument();
  });

  it("flags when a currently-held pool has no $/1k rate to estimate from", () => {
    render(
      <CurrentVsRecommended
        currentVotes={[{ pool: "0xUnrated", weightPct: 100 }]}
        votingPower={10_000}
        recommended={[]}
        poolMeta={new Map()}
      />,
    );

    expect(screen.getByText(/some pools lack a rate and are excluded/i)).toBeInTheDocument();
  });
});
