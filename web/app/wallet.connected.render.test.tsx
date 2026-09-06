import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DISPLAY_PRESET } from "@/lib/protocol";

const { useWriteContractMock, writeContractMock } = vi.hoisted(() => {
  const writeContractMock = vi.fn();
  return {
    writeContractMock,
    useWriteContractMock: vi.fn(() => ({
      writeContract: writeContractMock,
      data: undefined,
      isPending: false,
      error: undefined,
      reset: vi.fn(),
    })),
  };
});

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
  writeContractMock.mockClear();
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

describe("VotePanel (casting into a near-empty gauge)", () => {
  // currentVotes: 0 + votesAllocated: 8_000 -> this vote alone would be
  // ~100% of the gauge, i.e. the case Grok flagged: nothing stopped the
  // actual cast into a gauge only this vote is populating.
  const dominantAllocations = [
    { pool: "0xpool1", symbol: "THIN/USDC", weightPct: 100, currentVotes: 0, votesAllocated: 8_000 },
  ];

  async function selectNft() {
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole("combobox"), "93");
    return user;
  }

  it("blocks the vote behind a confirmation instead of casting immediately", async () => {
    renderWithProviders(<VotePanel allocations={dominantAllocations} />);
    const user = await selectNft();

    await user.click(screen.getByRole("button", { name: /cast vote/i }));

    expect(screen.getByText(/majority of the gauge/i)).toBeInTheDocument();
    expect(screen.getByText(/THIN\/USDC.*≈100% of this gauge/)).toBeInTheDocument();
    expect(writeContractMock).not.toHaveBeenCalled();
  });

  it("casts the vote once the user confirms", async () => {
    renderWithProviders(<VotePanel allocations={dominantAllocations} />);
    const user = await selectNft();

    await user.click(screen.getByRole("button", { name: /cast vote/i }));
    await user.click(screen.getByRole("button", { name: /cast anyway/i }));

    expect(writeContractMock).toHaveBeenCalledTimes(1);
  });

  it("cancels without casting", async () => {
    renderWithProviders(<VotePanel allocations={dominantAllocations} />);
    const user = await selectNft();

    await user.click(screen.getByRole("button", { name: /cast vote/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByText(/majority of the gauge/i)).not.toBeInTheDocument();
    expect(writeContractMock).not.toHaveBeenCalled();
  });

  it("does not gate an allocation that isn't dominant over its gauge", async () => {
    const allocations = [{ pool: "0xpool1", symbol: "TEST/USDC", weightPct: 100, currentVotes: 58_330, votesAllocated: 8_000 }];
    renderWithProviders(<VotePanel allocations={allocations} />);
    const user = await selectNft();

    await user.click(screen.getByRole("button", { name: /cast vote/i }));

    expect(screen.queryByText(/majority of the gauge/i)).not.toBeInTheDocument();
    expect(writeContractMock).toHaveBeenCalledTimes(1);
  });
});
