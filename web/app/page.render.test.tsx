import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import Dashboard from "./page";

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
    },
  ],
  voterAlloc: { objective: "voter_roi", summary: "test voter_roi summary", allocations: [] },
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

  it("shows a numeric confidence percentage, not just a bar", async () => {
    renderDashboard();
    await waitForPoolsLoaded();
    // POOL-A's confidence is 0.7 -> "70%"; relying only on bar width doesn't
    // let a reader distinguish e.g. 0.77 from 0.78 at a glance.
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
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

  it("renders a CSV export control for each allocation objective", async () => {
    renderDashboard();
    await waitForPoolsLoaded();
    expect(screen.getAllByText(/export csv/i).length).toBeGreaterThan(0);
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
});
