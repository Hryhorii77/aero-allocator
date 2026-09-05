import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DISPLAY_PRESET } from "@/lib/protocol";

const { useWriteContractMock } = vi.hoisted(() => ({
  useWriteContractMock: vi.fn(() => ({
    writeContract: vi.fn(),
    data: undefined,
    isPending: false,
    error: undefined,
    reset: vi.fn(),
  })),
}));

// A real WagmiProvider requires an actual connected injected wallet, which
// isn't available in jsdom — mocked here so the "veNFT selected -> votingPower
// synced" path (the disconnect Grok round 2 flagged) can be exercised without
// a live wallet connection.
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc0000000000000000000000000000000abcd", isConnected: true, chainId: DISPLAY_PRESET.chain.id }),
  useConnect: () => ({ connectors: [], connect: vi.fn(), isPending: false }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSwitchChain: () => ({ switchChain: vi.fn() }),
  useReadContract: () => ({
    data: [{ id: 93n, voting_amount: 93n * 10n ** 18n }],
    isError: false,
  }),
  useWriteContract: useWriteContractMock,
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}));

import { VotePanel } from "./wallet";

function renderWithProviders(children: React.ReactNode) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" }),
      }) as Response,
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VotePanel (connected, with detected veNFTs)", () => {
  const allocations = [{ pool: "0xpool1", symbol: "TEST/USDC", weightPct: 100 }];

  it("reports the selected veNFT's real voting balance so the caller can re-size weights for it", async () => {
    const onNftSelected = vi.fn();
    renderWithProviders(<VotePanel allocations={allocations} onNftSelected={onNftSelected} />);

    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole("combobox"), "93");

    expect(onNftSelected).toHaveBeenCalledWith(93);
    expect(screen.getByText(/re-sized for veNFT #93/i)).toBeInTheDocument();
  });

  it("does not claim a re-size happened before any veNFT is selected", () => {
    renderWithProviders(<VotePanel allocations={allocations} onNftSelected={vi.fn()} />);
    expect(screen.queryByText(/re-sized for veNFT/i)).not.toBeInTheDocument();
  });
});
