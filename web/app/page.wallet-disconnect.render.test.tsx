import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DISPLAY_PRESET } from "@/lib/protocol";

// A real WagmiProvider auto-reconnects to whatever the wallet extension last
// authorized, which page.render.test.tsx (a real, disconnected provider)
// can't exercise — this file mocks wagmi directly so a connect-then-
// disconnect transition can be simulated deterministically, mirroring
// wallet.connected.render.test.tsx's approach but for the full Dashboard.
const { useAccountMock, useReadContractMock } = vi.hoisted(() => ({
  useAccountMock: vi.fn((): { address: string | undefined; isConnected: boolean; chainId: number | undefined } => ({
    address: "0xabc0000000000000000000000000000000abcd",
    isConnected: true,
    chainId: DISPLAY_PRESET.chain.id,
  })),
  useReadContractMock: vi.fn(() => ({
    data: [{ id: 118577n, voting_amount: 92n * 10n ** 18n, votes: [{ lp: "0xpoolA", weight: 10_000n }] }],
    isError: false,
  })),
}));

vi.mock("wagmi", () => ({
  useAccount: useAccountMock,
  useConnect: () => ({ connectors: [], connect: vi.fn(), isPending: false }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSwitchChain: () => ({ switchChain: vi.fn() }),
  useReadContract: useReadContractMock,
  useWriteContract: () => ({ writeContract: vi.fn(), data: undefined, isPending: false, error: undefined, reset: vi.fn() }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}));

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
      feeHistory: [40, 45, 50],
    },
  ],
  voterAlloc: {
    objective: "voter_roi",
    summary: "test voter_roi summary",
    allocations: [
      {
        pool: "0xpoolA",
        symbol: "POOL-A",
        weightPct: 100,
        currentVoteSharePct: 10,
        predictedDemandSharePct: 12,
        predictiveEdgePct: 2,
        tvlUsd: 1_000_000,
        currentVotes: 58_330,
        votesAllocated: 92,
        expectedRewardUsd: 2,
        confidence: 0.7,
      },
    ],
  },
  protoAlloc: { objective: "protocol_efficiency", summary: "test protocol_efficiency summary", allocations: [] },
  edgeAlloc: { objective: "edge_hunter", summary: "test edge_hunter summary", allocations: [] },
  lpDeposits: { rewardTokenSymbol: "AERO", opportunities: [] },
  voteSwings: { epochProgressPct: 42.5, risers: [], fallers: [] },
  trackRecord: null,
  paStatus: { applicable: true, live: false },
};

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

// StrictMode on purpose: React's dev-only double-invoked effects are exactly
// what exposed the real bug here (a "have we mounted yet" guard gets
// consumed by the phantom second invocation) — rendering without it would
// let a regression on that front pass silently.
function renderDashboard() {
  const queryClient = new QueryClient();
  const tree = (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Dashboard />
      </QueryClientProvider>
    </StrictMode>
  );
  const utils = render(tree);
  return {
    ...utils,
    rerenderDashboard: () =>
      utils.rerender(
        <StrictMode>
          <QueryClientProvider client={queryClient}>
            <Dashboard />
          </QueryClientProvider>
        </StrictMode>,
      ),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  useAccountMock.mockReturnValue({
    address: "0xabc0000000000000000000000000000000abcd",
    isConnected: true,
    chainId: DISPLAY_PRESET.chain.id,
  });
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

describe("Dashboard reacting to the wallet disconnecting after a veNFT was already detected", () => {
  it("clears the 'from wallet' badge and current-vs-recommended panel once isConnected flips false", async () => {
    // The exact bug reported externally: the header correctly showed
    // "connect wallet" (disconnected), but the ROI card still claimed
    // "92 veAERO ✓ from wallet" from an earlier connection that was never
    // cleared — a real trust gap, not just a stale-looking number.
    const { rerenderDashboard } = renderDashboard();

    await screen.findAllByText("POOL-A");
    await screen.findByText(/from wallet/i);
    await screen.findByText(/your current split vs recommended/i);
    expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(92);

    useAccountMock.mockReturnValue({ address: undefined, isConnected: false, chainId: undefined });
    rerenderDashboard();

    expect(screen.queryByText(/from wallet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/your current split vs recommended/i)).not.toBeInTheDocument();
    // The veAERO amount itself is wallet-derived too — left at 92 after a
    // real disconnect it would keep showing a stale balance next to a
    // recommendation split nobody actually holds anymore (external
    // feedback: "clear the counter... once the wallet disconnected").
    await waitFor(() => expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(10000));
  });

  it("does not stomp a shared link's ?vp= amount via a phantom StrictMode remount when no wallet ever connects", async () => {
    // A naive "skip only the very first effect run" guard looks right in a
    // single render, but breaks under React StrictMode's dev-only
    // double-invoked effects: the phantom second invocation (which fires
    // synchronously on mount, before any user interaction) consumes the
    // guard and wrongly fires the reset even though no wallet ever
    // connected. Caught live: opening a shared ?vp=5000 link with no wallet
    // connected silently showed 10,000 instead.
    useAccountMock.mockReturnValue({ address: undefined, isConnected: false, chainId: undefined });
    useReadContractMock.mockReturnValue({ data: [], isError: false });
    window.history.pushState({}, "", "/?vp=5000");

    renderDashboard();
    await screen.findAllByText("POOL-A");

    expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(5000);
  });
});
