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
  ],
  voterAlloc: { objective: "voter_roi", summary: "test voter_roi summary", allocations: [] },
  protoAlloc: { objective: "protocol_efficiency", summary: "test protocol_efficiency summary", allocations: [] },
  edgeAlloc: { objective: "edge_hunter", summary: "test edge_hunter summary", allocations: [] },
  lpDeposits: { rewardTokenSymbol: "AERO", opportunities: [] },
  voteSwings: { epochProgressPct: 42.5, risers: [], fallers: [] },
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
      Array.from(document.querySelectorAll("tbody tr")).map((tr) => within(tr as HTMLElement).queryByText(/POOL-[AB]/)?.textContent);

    // Default sort is predictedFeesUsd desc: POOL-A (200) before POOL-B (100).
    expect(rowsInOrder()).toEqual(["POOL-A", "POOL-B"]);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /last epoch/i }));

    // lastEpochFeesUsd desc: POOL-B (500) before POOL-A (50).
    expect(rowsInOrder()).toEqual(["POOL-B", "POOL-A"]);
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
});
