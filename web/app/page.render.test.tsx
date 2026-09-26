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
  // Tests that push a ?vp= link would otherwise leak it into the next
  // test's initial state, since votingPower reads the URL on mount.
  window.history.pushState({}, "", "/");
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

    // Default sort is edgePct desc: POOL-A (2), POOL-C (0.01), POOL-B (-1).
    expect(rowsInOrder()).toEqual(["POOL-A", "POOL-C", "POOL-B"]);

    const user = userEvent.setup();
    // "last epoch" is folded into the row expand under vote mode (default
    // on) — surface it as a header again to click it.
    await user.click(screen.getByRole("button", { name: /vote mode/i }));
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

  // jsdom doesn't evaluate the sm: responsive classes that hide one of the
  // mobile-card / desktop-table pair, so both render into the DOM at once
  // here — scope to the desktop table specifically wherever a query would
  // otherwise match both (e.g. "expand POOL-A fee history" exists on both
  // layouts, driving the same shared expandedPool state).
  function desktopPoolsTable() {
    return hotPoolsSection().querySelector("table") as HTMLElement;
  }

  function mobilePoolsGrid() {
    return hotPoolsSection().querySelector(".grid.gap-2.sm\\:hidden") as HTMLElement;
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
    await user.click(within(desktopPoolsTable()).getByRole("button", { name: /expand POOL-A fee history/i }));

    expect(within(desktopPoolsTable()).getByRole("img", { name: /fee history sparkline, rising overall/i })).toBeInTheDocument();
    expect(within(desktopPoolsTable()).getByText(/fees, last 5 completed epochs: \$30 → \$50/i)).toBeInTheDocument();

    await user.click(within(desktopPoolsTable()).getByRole("button", { name: /collapse POOL-A fee history/i }));

    expect(screen.queryByRole("img", { name: /fee history sparkline/i })).not.toBeInTheDocument();
  });

  it("defaults to vote mode: hides last-epoch and votes-vs-demand columns, folding them into the row expand instead", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    expect(screen.getByRole("button", { name: /vote mode/i })).toBeInTheDocument();
    expect(within(desktopPoolsTable()).queryByRole("button", { name: /^last epoch/i })).not.toBeInTheDocument();
    expect(within(desktopPoolsTable()).queryByText(/votes vs demand/i)).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(desktopPoolsTable()).getByRole("button", { name: /expand POOL-A fee history/i }));

    // Folded into the expand panel instead of gone outright.
    expect(within(desktopPoolsTable()).getByText(/last epoch \$50/i)).toBeInTheDocument();
    expect(within(desktopPoolsTable()).getByText(/votes vs demand 10\.0% → 12\.0%/i)).toBeInTheDocument();
  });

  it("also expands to reveal the sparkline on the mobile card layout (previously desktop-only)", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    expect(within(mobilePoolsGrid()).queryByRole("img", { name: /fee history sparkline/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(mobilePoolsGrid()).getByRole("button", { name: /expand POOL-A fee history/i }));

    expect(within(mobilePoolsGrid()).getByRole("img", { name: /fee history sparkline, rising overall/i })).toBeInTheDocument();
  });

  it("shows every column again when vote mode is switched off", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /vote mode/i }));

    expect(within(hotPoolsSection()).getByRole("button", { name: /^last epoch/i })).toBeInTheDocument();
    expect(within(hotPoolsSection()).getByText(/votes vs demand/i)).toBeInTheDocument();
  });

  it("shows a falling sparkline for a pool with declining fee history", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    const user = userEvent.setup();
    await user.click(within(desktopPoolsTable()).getByRole("button", { name: /expand POOL-B fee history/i }));

    expect(within(desktopPoolsTable()).getByRole("img", { name: /fee history sparkline, falling overall/i })).toBeInTheDocument();
  });

  it("explains there isn't enough history yet for a pool with a single data point", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    const user = userEvent.setup();
    await user.click(within(desktopPoolsTable()).getByRole("button", { name: /expand POOL-C fee history/i }));

    expect(within(desktopPoolsTable()).getByText(/not enough completed epochs yet for a trend line/i)).toBeInTheDocument();
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

    // Default sort (edgePct) keeps the "hot pools" framing.
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

    // POOL-C (near-zero vote share) should read "no votes yet" instead of a
    // fake-precise "0.0% → 0.0%" in the votes-vs-demand column — folded into
    // vote mode's row expand, so turn vote mode off to see the column itself.
    await user.click(screen.getByRole("button", { name: /vote mode/i }));
    const tbody = document.querySelector("tbody")!;
    const rowC = within(tbody).getByText("POOL-C").closest("tr")!;
    expect(within(rowC).getByText("no votes yet")).toBeInTheDocument();
  });

  it("shows a stacked ▲▼ affordance on inactive sortable headers, replaced by a single bold arrow once active", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // Previously an inactive sortable header showed no arrow at all,
    // looking identical to the non-sortable "pool" header — no way to
    // tell which columns were clickable without trying. "trend/epoch", not
    // "edge" (the default sort, already active) or "last epoch" (hidden by
    // default under vote mode).
    // Scoped to the hot-pools section — the LP staking table has its own
    // "trend/epoch" sortable header too.
    const trendHeader = within(hotPoolsSection()).getByRole("button", { name: /trend\/epoch/i });
    expect(trendHeader).toHaveTextContent("▲");
    expect(trendHeader).toHaveTextContent("▼");

    const user = userEvent.setup();
    await user.click(trendHeader);
    expect(trendHeader).not.toHaveTextContent("▲");
    expect(trendHeader).toHaveTextContent("▼");
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

    // Sorting by a normal, non-default column does restore it into the URL.
    // (Edge itself is the default sort, so it is deliberately absent — see
    // the default-omission tests below.)
    await user.click(screen.getByRole("button", { name: /predicted fees/i }));
    expect(window.location.search).toMatch(/sort=predictedFeesUsd/);
  });

  it("leaves a first-time visitor's URL clean instead of appending every default", async () => {
    // Landing on aeroallocator.app used to rewrite the address bar to
    // "?sort=edgePct&dir=desc&lpSort=…&vp=10000" before the visitor touched
    // anything, which reads as broken and invites "what did it just add?".
    window.history.pushState({}, "", "/");

    renderDashboard();
    await waitForPoolsLoaded();

    expect(window.location.search).toBe("");
  });

  it("does not republish a remembered amount restored from localStorage", async () => {
    // Same leak, quieter route: a returning holder lands on a clean URL and
    // the restore alone must not put their size back in the address bar.
    window.localStorage.setItem("aero-allocator:voting-power:v1", "2400000");
    window.history.pushState({}, "", "/");

    renderDashboard();
    await waitForPoolsLoaded();

    expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(2_400_000);
    expect(window.location.search).not.toMatch(/vp=/);
  });

  it("does put a hand-typed amount in the URL, so sharing a sized view still works", async () => {
    window.history.pushState({}, "", "/");

    renderDashboard();
    await waitForPoolsLoaded();

    const user = userEvent.setup();
    const input = screen.getAllByRole("spinbutton")[0];
    await user.clear(input);
    await user.type(input, "250000");

    expect(window.location.search).toMatch(/vp=250000/);
  });

  it("keeps republishing an amount that arrived in the link, since it is already public", async () => {
    window.history.pushState({}, "", "/?vp=5000");

    renderDashboard();
    await waitForPoolsLoaded();

    expect(window.location.search).toMatch(/vp=5000/);
  });

  it("shows gauge share on a Voter ROI row, with TVL and current votes behind its expand", async () => {
    renderDashboard();
    await waitForPoolsLoaded();
    // Regression coverage for a real trust gap Grok flagged: two rows with
    // the same weightPct look identical without this — one could be an
    // established gauge, the other a thin one your vote would dominate.
    //
    // The size of the vote and its share of the gauge stay on the row; TVL
    // and current votes sit one tap down in the row expand.
    expect(screen.getByText(/≈ 12\.1% of this gauge/)).toBeInTheDocument();
    expect(screen.queryByText(/\$1,000,000 TVL/)).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /expand POOL-A details/i }));
    expect(screen.getByText(/\$1,000,000 TVL/)).toBeInTheDocument();
    expect(screen.getByText(/58,330 votes now/)).toBeInTheDocument();
  });

  it("leads the Voter ROI panel with the expected-$ total, captioned as voter $ rather than pool fees", async () => {
    renderDashboard();
    await waitForPoolsLoaded();
    // External feedback: readers were conflating the (tiny, correct) expected
    // per-voter reward with pool-level trading fees — the caption now rides
    // with the hero number instead of sitting below the rows as its own line.
    expect(screen.getByText(/your\s+voter \$, not pool fees/i)).toBeInTheDocument();
    // Sum of the fixture's single allocation's expectedRewardUsd (42).
    expect(screen.getByText("$42")).toBeInTheDocument();
  });

  it("doesn't claim the veAERO amount came from a wallet when none is connected", async () => {
    renderDashboard();
    await waitForPoolsLoaded();
    // The "✓ from wallet" indicator should only appear once a real veNFT
    // has actually been auto-detected (see wallet.connected.render.test.tsx
    // for the connected-path coverage) — otherwise it would misrepresent a
    // manually-typed or default number as wallet-sourced.
    expect(screen.queryByText(/from wallet/i)).not.toBeInTheDocument();
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

  it("explains a short Voter ROI list with a dedicated gas-hurdle callout, not just a bare row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) {
          return jsonResponse({
            ...dashboardPayload,
            voterAlloc: { ...dashboardPayload.voterAlloc, gasHurdleDroppedCount: 2 },
          });
        }
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
    renderDashboard();
    await waitForPoolsLoaded();

    expect(screen.getByText(/2 more pools cleared the reward floor but not the gas hurdle/i)).toBeInTheDocument();
  });

  it("says nothing about a gas hurdle when nothing was collapsed", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // Base fixture's voterAlloc has no gasHurdleDroppedCount at all. Scoped
    // to the Voter ROI panel so a stray "gas hurdle" elsewhere on the page
    // (changelog copy, a tooltip) can't make this pass or fail by accident.
    const voterRoiPanel = screen.getByText("Voter ROI").closest("div")!.parentElement as HTMLElement;
    expect(within(voterRoiPanel).queryByText(/gas hurdle/i)).not.toBeInTheDocument();
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
                  stakedTvlUsd: 100000,
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
    // Once in the header, once beside Cast — never in the amount row.
    expect(screen.getAllByRole("button", { name: /connect wallet/i })).toHaveLength(2);
  });

  it("lets the header's status chips (epoch countdown, snapshot freshness, epoch progress) wrap onto their own lines on narrow viewports", async () => {
    renderDashboard();
    await waitForPoolsLoaded();
    // Without flex-wrap here, these chips are squeezed into one unbreakable
    // row and their own text wraps mid-phrase instead ("votes flip in 4d
    // 3h" splitting across lines) on a phone-width screen — regression
    // guard for that, since jsdom doesn't do real responsive layout. Scoped
    // to the status group specifically now that it's split from the
    // actions group (refresh/connect wallet), which doesn't need to wrap —
    // two buttons never squeeze the way a row of status chips does.
    const flipClock = screen.getByText(/votes close in|voting closed|epoch just flipped/i);
    expect(flipClock.closest(".flex-wrap")).not.toBeNull();
  });

  it("replaces the header-only LP table with a real empty state when every pool is filtered out as thin", async () => {
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
                  pool: "0xlpthin",
                  symbol: "THIN-LP",
                  poolType: "concentrated",
                  stakedTvlUsd: 2_000, // under the $50k thin floor
                  currentEpochAprPct: 40_000,
                  predictedNextEpochAprPct: 50_000,
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

    // Previously: heading + a one-line link + a table with a header row and
    // nothing under it, which reads as a failed fetch.
    expect(screen.getByText(/too thin to mean anything/i)).toBeInTheDocument();
    // One quiet line, not a collapsible section with a heading of its own.
    expect(screen.getByText("LP staking yield").closest("details")).toBeNull();
    const unhide = screen.getByRole("button", { name: /show anyway/i });
    expect(unhide.closest("div")!.textContent).toMatch(/too thin to mean anything/i);

    // And the control still works from inside the empty state.
    const user = userEvent.setup();
    await user.click(unhide);
    expect(screen.getAllByRole("link", { name: "THIN-LP" }).length).toBeGreaterThan(0);
  });

  it("remembers a typed veAERO amount for the next visit instead of resetting to the 10,000 default", async () => {
    const { unmount } = renderDashboard();
    await waitForPoolsLoaded();

    const input = screen.getAllByRole("spinbutton")[0];
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "92");
    expect(input).toHaveValue(92);

    unmount();
    renderDashboard();
    await waitForPoolsLoaded();

    expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(92);
  });

  it("lets a shared ?vp= link win over the remembered amount", async () => {
    window.localStorage.setItem("aero-allocator:voting-power:v1", "92");
    window.history.pushState({}, "", "/?vp=5000");

    renderDashboard();
    await waitForPoolsLoaded();

    // Otherwise a link someone sent would quietly show the recipient's own
    // size instead of the one in the link.
    expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(5000);
  });

  it("does not persist the blank value the input passes while it's being cleared", async () => {
    window.localStorage.setItem("aero-allocator:voting-power:v1", "92");
    const { unmount } = renderDashboard();
    await waitForPoolsLoaded();

    const user = userEvent.setup();
    await user.clear(screen.getAllByRole("spinbutton")[0]);

    unmount();
    renderDashboard();
    await waitForPoolsLoaded();

    // Still 92, not 10,000 — clearing the field mid-edit isn't an amount.
    expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(92);
  });

  it("keeps the mobile tab bar in sync with which sections are hidden below sm", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    const voteTab = screen.getByRole("tab", { name: "vote" });
    const moreTab = screen.getByRole("tab", { name: "more" });
    expect(voteTab).toHaveAttribute("aria-selected", "true");

    // jsdom applies no CSS, so assert the class contract the breakpoint
    // relies on: inactive sections carry `hidden`, all of them carry an
    // sm: override so desktop still renders one dense page.
    const lpSection = screen.getByText(/LP staking yield/i).closest("[class*=\"sm:block\"]")!;
    expect(lpSection.className).toMatch(/\bhidden\b/);
    expect(lpSection.className).toMatch(/\bsm:block\b/);

    const user = userEvent.setup();
    await user.click(moreTab);

    expect(moreTab).toHaveAttribute("aria-selected", "true");
    expect(voteTab).toHaveAttribute("aria-selected", "false");
    expect(lpSection.className).not.toMatch(/\bhidden\b/);
  });

  it("collapses a vote-swing signal to one line, with the full rationale behind a tap", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // The epoch-progress clause is identical on every signal, so it's stated
    // once per panel instead of repeated per card.
    expect(screen.getAllByText(/normal trajectory at 42\.5% through the epoch/i).length).toBe(2);
  });

  it("shows 'no baseline' instead of a nine-figure swing for a gauge with no prior votes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) {
          return jsonResponse({
            ...dashboardPayload,
            voteSwings: {
              epochProgressPct: 42.5,
              risers: [
                {
                  pool: "0xnew",
                  symbol: "NEW-GAUGE",
                  currentBribesUsd: 5000,
                  bribeSpikeRatio: null,
                  // What the 1-vote-floor division actually produces.
                  voteSwingPct: 3_287_989_742.5,
                  expectedVotesSoFar: 0,
                  rationale: "…no meaningful baseline to compare against.",
                },
                {
                  pool: "0xreal",
                  symbol: "REAL-GAUGE",
                  currentBribesUsd: 900,
                  bribeSpikeRatio: 2.4,
                  voteSwingPct: 44.8,
                  expectedVotesSoFar: 120_000,
                  rationale: "Bribes running 2.4x expected pace; votes +44.8% …",
                },
              ],
              fallers: [],
            },
          });
        }
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
    renderDashboard();
    await waitForPoolsLoaded();

    expect(screen.getByText(/no baseline/i)).toBeInTheDocument();
    expect(screen.queryByText(/3,?287,?989,?742/)).not.toBeInTheDocument();
    // A gauge that does have a baseline still shows its real number.
    expect(screen.getByText("+44.8%")).toBeInTheDocument();
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
                  stakedTvlUsd: 100000,
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

  it("hides a thin LP-yield pool by default, and reveals it (flagged) via the toggle", async () => {
    // External feedback: "81,007% current / 39,326% predicted on $1.9k TVL
    // looks like a bug even if the math is right" — a pool this thin should
    // not be in the default view at all.
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
                  pool: "0xthin",
                  symbol: "THIN-POOL",
                  poolType: "concentrated",
                  stakedTvlUsd: 1_900,
                  currentEpochAprPct: 81_007,
                  predictedNextEpochAprPct: 39_326,
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

    expect(screen.queryByText("THIN-POOL")).not.toBeInTheDocument();
    const toggle = screen.getByText(/1 thin pool hidden/i);

    const user = userEvent.setup();
    await user.click(toggle);

    expect(screen.getAllByText("THIN-POOL").length).toBeGreaterThan(0);
    expect(screen.getAllByText("thin").length).toBeGreaterThan(0);

    await user.click(screen.getByText(/hide 1 thin pool/i));
    expect(screen.queryByText("THIN-POOL")).not.toBeInTheDocument();
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
    expect(screen.getByText(/first screen answers without a wallet/i)).toBeInTheDocument();
  });

  it("only carries the last two ship days", async () => {
    renderDashboard();
    await waitForPoolsLoaded();
    const details = screen.getByText(/what's new/i).closest("details") as HTMLDetailsElement;
    const dates = [...details.querySelectorAll("li > span:first-child")].map((el) => el.textContent);
    expect(new Set(dates)).toEqual(new Set(["2026-09-25", "2026-09-24"]));
  });

  it("points at the commit history rather than listing every change ever shipped", async () => {
    renderDashboard();
    await waitForPoolsLoaded();

    // The panel is deliberately trimmed to the newest ship days, so the
    // out-link is the only thing standing between a visitor and the older
    // entries — if it ever goes missing, they're silently gone.
    const link = screen.getByRole("link", { name: /commit history/i });
    expect(link).toHaveAttribute("href", "https://github.com/Hryhorii77/aero-allocator/commits/main");
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

  it("leads with the dollar difference between staying and switching", () => {
    render(
      <CurrentVsRecommended
        currentVotes={[{ pool: "0xpoolA", weightPct: 100 }]}
        votingPower={10_000}
        recommended={[
          {
            pool: "0xpoolA",
            symbol: "POOL-A",
            weightPct: 100,
            currentVoteSharePct: 5,
            predictedDemandSharePct: 6,
            predictiveEdgePct: 1,
            tvlUsd: 100,
            currentVotes: 1000,
            expectedRewardUsd: 25,
            confidence: 0.7,
          },
        ]}
        poolMeta={poolMeta}
      />,
    );

    // Staying: 10,000 votes at POOL-A's $1.10/1k = $11. Switching: $25.
    expect(screen.getByText(/≈ \+\$14 to switch/)).toBeInTheDocument();
    // The counts sit in their own spans, so match on the line, not a node.
    const headline = screen.getByText(/You.re in/).closest("span")!;
    expect(headline.textContent).toMatch(/You’re in 1 pool, this split wants 1/);
  });

  it("withholds the dollar difference when a currently-held pool has no $/1k rate to value it with", () => {
    render(
      <CurrentVsRecommended
        // Not in poolMeta, so the "stay" side can't be priced — showing a
        // delta anyway would flatter switching by the unmeasured amount.
        currentVotes={[{ pool: "0xUnratedPool", weightPct: 100 }]}
        votingPower={10_000}
        recommended={[
          {
            pool: "0xpoolA",
            symbol: "POOL-A",
            weightPct: 100,
            currentVoteSharePct: 5,
            predictedDemandSharePct: 6,
            predictiveEdgePct: 1,
            tvlUsd: 100,
            currentVotes: 1000,
            expectedRewardUsd: 25,
            confidence: 0.7,
          },
        ]}
        poolMeta={poolMeta}
      />,
    );

    expect(screen.getByText(/not comparable/i)).toBeInTheDocument();
    expect(screen.queryByText(/to switch/)).not.toBeInTheDocument();
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

    expect(screen.getByText("$4.40")).toBeInTheDocument();
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

describe("EpochCountdown after the vote lock", () => {
  const WEEK_SECONDS = 7 * 24 * 60 * 60;

  it("says voting is closed in the last hour, and counts to the flip instead", async () => {
    // 30 minutes to the flip = 30 minutes past the lock.
    const epochStart = Math.floor(Date.now() / 1000) - WEEK_SECONDS + 30 * 60;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) return jsonResponse({ ...dashboardPayload, epochStart });
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
    renderDashboard();
    const chip = await screen.findByText(/voting closed/i);
    expect(chip.textContent).toMatch(/flips in \d+m/);
    // Not the red "vote now" — there's nothing left to vote.
    expect(chip.textContent).not.toMatch(/vote now/i);
    expect(chip.closest("div")).not.toHaveClass("animate-pulse");
  });

  it("explains the lock in the tooltip", async () => {
    const epochStart = Math.floor(Date.now() / 1000) - WEEK_SECONDS + 3 * 24 * 3600;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) return jsonResponse({ ...dashboardPayload, epochStart });
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
    renderDashboard();
    const chip = await screen.findByText(/votes close in/i);
    expect(chip.closest("div")).toHaveAttribute("title", expect.stringMatching(/Voting locks .* an hour before the epoch flips/));
  });
});

describe("EpochCountdown urgency", () => {
  // BNKR/Grok: "your chip is too polite" — neutral above 12h, amber inside
  // 12h, red with an explicit stale-data warning inside the final 2h.
  const WEEK_SECONDS = 7 * 24 * 60 * 60;

  // Hours until the vote LOCK, which is an hour before the flip — the
  // chip counts to the deadline that matters, not to the flip.
  const LOCK_HOURS = 1;
  function stubFetchWithHoursLeft(hoursLeft: number) {
    const epochStart = Math.floor(Date.now() / 1000) - WEEK_SECONDS + Math.round((hoursLeft + LOCK_HOURS) * 3600);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) return jsonResponse({ ...dashboardPayload, epochStart });
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
  }

  it("says nothing about staleness more than 12h before the flip", async () => {
    stubFetchWithHoursLeft(20);
    renderDashboard();
    const chip = await screen.findByText(/votes close in/i);
    expect(chip.textContent).not.toMatch(/may be stale/i);
  });

  it("turns amber inside 12h but still says nothing about staleness", async () => {
    stubFetchWithHoursLeft(8);
    renderDashboard();
    const chip = await screen.findByText(/votes close in/i);
    expect(chip.textContent).not.toMatch(/may be stale/i);
  });

  it("pushes to vote inside the final 2h, without repeating the freshness chip's refresh instruction", async () => {
    stubFetchWithHoursLeft(1);
    renderDashboard();

    const chip = await screen.findByText(/votes close in/i);
    expect(chip.textContent).toMatch(/vote now/i);
    // The chip beside it owns "stale/refresh"; two red pills ending in the
    // same word was the thing to avoid.
    expect(chip.textContent).not.toMatch(/refresh/i);
  });
});

describe("Dashboard — copy buttons", () => {
  it("links the share card at the amount currently on screen", async () => {
    renderDashboard();
    await waitForPoolsLoaded();
    expect(screen.getByRole("link", { name: /share card/i })).toHaveAttribute("href", "/api/share?vp=10000");
  });

  it("copies whole-percent weights, and a one-line share text with the visitor's amount", async () => {
    // A live-looking epoch, so the share text carries a real "closes in".
    const epochStart = Math.floor(Date.now() / 1000) - 4 * 24 * 3600;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) return jsonResponse({ ...dashboardPayload, epochStart });
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
    renderDashboard();
    await waitForPoolsLoaded();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "copy weights" }));
    const weights = await navigator.clipboard.readText();
    expect(weights.split("\n")[0]).toMatch(/^Aerodrome Allocator voter_roi · 10,000 veAERO · expected \$42 next epoch$/);
    expect(weights).toMatch(/\npcts: 100$/);

    await user.click(screen.getByRole("button", { name: "copy share text" }));
    const share = await navigator.clipboard.readText();
    expect(share).toMatch(/^10,000 veAERO → ~\$42 expected next epoch · 1 pool · votes close in \d+d \d+h · aeroallocator\.app$/);
  });
});

describe("Dashboard — bribe simulator price", () => {
  const bribe = (usdPer1kIncrementalVotes: number | null) => ({
    pool: "0xpoolA",
    symbol: "POOL-A",
    bribeBudgetUsd: 5000,
    baselineVoteSharePct: 1,
    projectedVoteSharePct: 2,
    voteShareGainPct: 1,
    usdPer1kIncrementalVotes,
    diluted: [],
    assumptions: "test assumptions",
  });

  function stubWithBribe(result: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/bribe")) return jsonResponse(result);
        if (s.includes("/api/dashboard")) return jsonResponse(dashboardPayload);
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
  }

  it("shows what one dollar buys, alongside the $ per 1k votes it's the inverse of", async () => {
    stubWithBribe(bribe(4)); // $4 per 1k votes → 250 votes per $1
    renderDashboard();
    await waitForPoolsLoaded();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "simulate" }));

    expect(await screen.findByText("votes bought per $1")).toBeInTheDocument();
    expect(screen.getByText("$4.00")).toBeInTheDocument();
    expect(screen.getByText("250")).toBeInTheDocument();
  });

  it("says n/a rather than dividing by nothing when the simulation has no price", async () => {
    stubWithBribe(bribe(null));
    renderDashboard();
    await waitForPoolsLoaded();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "simulate" }));

    const label = await screen.findByText("votes bought per $1");
    expect(label.nextElementSibling?.textContent).toBe("n/a");
  });
});

describe("Dashboard — highlighted token pools", () => {
  const BNKR = "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b";
  const pool = (over: Record<string, unknown>) => ({ ...dashboardPayload.pools[0], ...over });

  function stubWith(pools: unknown[], voteSwings?: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("/api/dashboard")) return jsonResponse({ ...dashboardPayload, pools, ...(voteSwings ? { voteSwings } : {}) });
        if (s.includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
        throw new Error(`unexpected fetch: ${s}`);
      }),
    );
  }

  it("badges a pool that holds BNKR by address, in the table and the mobile card, but not a look-alike", async () => {
    stubWith([
      pool({ lp: "0xreal", symbol: "CL200-BNKR/WETH", token0: BNKR, token1: "0xweth" }),
      // Same NAME, different token — must not get the badge.
      pool({ lp: "0xfake", symbol: "CL200-BNKR/USDC", token0: "0x9999999999999999999999999999999999999999", token1: "0xusdc", edgePct: 1 }),
    ]);
    renderDashboard();
    await screen.findAllByText("CL200-BNKR/WETH");

    const table = document.querySelector("table") as HTMLElement;
    const realRow = within(table).getByText("CL200-BNKR/WETH").closest("tr")!;
    const fakeRow = within(table).getByText("CL200-BNKR/USDC").closest("tr")!;
    expect(within(realRow).getByText("BNKR")).toBeInTheDocument();
    expect(within(fakeRow).queryByText("BNKR")).not.toBeInTheDocument();
    expect(within(realRow).getByText("BNKR").getAttribute("title")).toMatch(/not a recommendation/i);

    const grid = document.querySelector(".grid.gap-2.sm\\:hidden") as HTMLElement;
    expect(within(grid).getAllByText("BNKR")).toHaveLength(1);
  });

  it("marks the same pool in the vote swings, looked up from the snapshot", async () => {
    stubWith(
      [pool({ lp: "0xreal", symbol: "CL200-BNKR/WETH", token0: BNKR, token1: "0xweth" })],
      {
        epochProgressPct: 42.5,
        risers: [{ pool: "0xREAL", symbol: "CL200-BNKR/WETH", currentBribesUsd: 500, bribeSpikeRatio: 3, voteSwingPct: 20, expectedVotesSoFar: 1000, rationale: "r" }],
        fallers: [],
      },
    );
    renderDashboard();
    await screen.findAllByText("CL200-BNKR/WETH");

    // "Vote swings" is the section title and each panel's heading; any of them sits inside the same <details>.
    const swings = screen.getAllByText("Vote swings")[0].closest("details") as HTMLElement;
    expect(within(swings).getByText("BNKR")).toBeInTheDocument();
  });

  it("shows no badge when the payload carries no token addresses (an older cached snapshot)", async () => {
    stubWith([pool({ lp: "0xold", symbol: "CL200-BNKR/WETH" })]);
    renderDashboard();
    await screen.findAllByText("CL200-BNKR/WETH");
    expect(screen.queryByText("BNKR")).not.toBeInTheDocument();
  });
});

describe("AeroLaunchNotice", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the launch instant the article gives in both of its forms", async () => {
    const { AERO_LAUNCH_AT_MS } = await import("./page");
    // "October 21, 2026 at 8:00 PM EDT (October 22, 00:00 UTC)"
    expect(AERO_LAUNCH_AT_MS).toBe(Date.parse("2026-10-22T00:00:00Z"));
    expect(AERO_LAUNCH_AT_MS).toBe(Date.parse("2026-10-21T20:00:00-04:00"));
  });

  it("states the date and what this app covers, and links the source, before launch", async () => {
    const { AeroLaunchNotice, AERO_LAUNCH_AT_MS } = await import("./page");
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS - 24 * 3600 * 1000);
    render(<AeroLaunchNotice />);

    expect(await screen.findByText(/Aero launches 22 Oct 2026, 00:00 UTC/)).toBeInTheDocument();
    // Attributed to Aero, not asserted as our own claim, and says what this app covers.
    expect(screen.getByText(/weekly voting is replaced by continuous Predictive Allocation and veAERO must be upgraded/)).toBeInTheDocument();
    expect(screen.getByText(/covers the\s+classic weekly gauge vote for now/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Aero.s FAQ/i });
    expect(link).toHaveAttribute("href", "https://aero.xyz/articles/aero-predictive-allocation-faq/");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("is gone once the launch instant has passed, rather than going on saying 'launches'", async () => {
    const { AeroLaunchNotice, AERO_LAUNCH_AT_MS } = await import("./page");
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS);
    const { container } = render(<AeroLaunchNotice />);
    // The effect runs after mount; give it a tick, then it must still be empty.
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Aero launches/)).not.toBeInTheDocument();
  });
});
