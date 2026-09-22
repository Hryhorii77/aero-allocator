import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DISPLAY_PRESET } from "@/lib/protocol";

const { useWriteContractMock, writeContractMock, useReadContractMock } = vi.hoisted(() => {
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
    useReadContractMock: vi.fn(() => ({
      data: [{ id: 93n, voting_amount: 93n * 10n ** 18n, votes: [] as Array<{ lp: string; weight: bigint }> }],
      isError: false,
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
  useReadContract: useReadContractMock,
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
  useReadContractMock.mockClear();
  useReadContractMock.mockReturnValue({ data: [{ id: 93n, voting_amount: 93n * 10n ** 18n, votes: [] }], isError: false });
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

  it("auto-selects the detected veNFT immediately, without waiting for a checkbox click", async () => {
    // The 10,000 default was the #1 reason people asked "does this predict
    // my next epoch" — it's wrong for almost everyone with a real lock, and
    // required an extra manual click to fix. This should need zero clicks
    // once a veNFT is found.
    const onNftSelected = vi.fn();
    renderWithProviders(<VotePanel allocations={allocations} onNftSelected={onNftSelected} />);

    expect(await screen.findByText(/re-sized for veNFT #93/i)).toBeInTheDocument();
    expect(onNftSelected).toHaveBeenCalledWith(93, []);
  });

  it("auto-selects every detected veNFT by default and combines their voting power (multi-veNFT batch)", async () => {
    // A wallet with several locks (Flight School + an older max lock) should
    // get its full combined voting power immediately, not just the first
    // one — batching all of them into one signature is the point.
    useReadContractMock.mockReturnValue({
      data: [
        { id: 93n, voting_amount: 93n * 10n ** 18n, votes: [] },
        { id: 44n, voting_amount: 44n * 10n ** 18n, votes: [] },
      ],
      isError: false,
    });
    const onNftSelected = vi.fn();
    renderWithProviders(<VotePanel allocations={allocations} onNftSelected={onNftSelected} />);

    await screen.findByText(/re-sized for 2 selected veNFTs/i);
    expect(onNftSelected).toHaveBeenCalledWith(137, []); // 93 + 44
    expect(screen.getByRole("checkbox", { name: "veNFT #93" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "veNFT #44" })).toBeChecked();
  });

  it("unchecking a veNFT drops it from the combined voting power", async () => {
    useReadContractMock.mockReturnValue({
      data: [
        { id: 93n, voting_amount: 93n * 10n ** 18n, votes: [] },
        { id: 44n, voting_amount: 44n * 10n ** 18n, votes: [] },
      ],
      isError: false,
    });
    const onNftSelected = vi.fn();
    renderWithProviders(<VotePanel allocations={allocations} onNftSelected={onNftSelected} />);
    await screen.findByText(/re-sized for 2 selected veNFTs/i);
    onNftSelected.mockClear();

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "veNFT #44" }));

    expect(onNftSelected).toHaveBeenCalledWith(93, []);
    expect(screen.getByText(/re-sized for veNFT #93/i)).toBeInTheDocument();
  });

  it("normalizes a veNFT's raw on-chain vote weights to percentages of its own total", async () => {
    // LpVotes.weight is relative (same convention Voter.vote() itself
    // uses), not already a 0-100 scale — this is the correctness-critical
    // conversion the current-vs-recommended comparison depends on.
    useReadContractMock.mockReturnValue({
      data: [
        {
          id: 93n,
          voting_amount: 93n * 10n ** 18n,
          votes: [
            { lp: "0xpoolA", weight: 7000n },
            { lp: "0xpoolB", weight: 3000n },
          ],
        },
      ],
      isError: false,
    });
    const onNftSelected = vi.fn();
    renderWithProviders(<VotePanel allocations={allocations} onNftSelected={onNftSelected} />);

    await screen.findByText(/re-sized for veNFT #93/i);

    expect(onNftSelected).toHaveBeenCalledWith(93, [
      { pool: "0xpoolA", weightPct: 70 },
      { pool: "0xpoolB", weightPct: 30 },
    ]);
  });

  it("does not claim a re-size happened when no veNFT is detected", () => {
    useReadContractMock.mockReturnValue({ data: [], isError: false });
    renderWithProviders(<VotePanel allocations={allocations} onNftSelected={vi.fn()} />);
    expect(screen.queryByText(/re-sized for veNFT/i)).not.toBeInTheDocument();
  });
});

describe("VotePanel (multi-veNFT batch cast)", () => {
  // A real, checksummed address — unlike the single-vote path (which just
  // forwards raw args to the mocked writeContract), buildMulticallVoteArgs
  // really ABI-encodes each inner vote() call via viem, which validates
  // address checksums, so a placeholder like "0xpool1" would throw here.
  const allocations = [{ pool: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "TEST/USDC", weightPct: 100 }];

  it("batches every selected veNFT into one Multicall3.aggregate3 call instead of N separate votes", async () => {
    useReadContractMock.mockReturnValue({
      data: [
        { id: 93n, voting_amount: 93n * 10n ** 18n, votes: [] },
        { id: 44n, voting_amount: 44n * 10n ** 18n, votes: [] },
      ],
      isError: false,
    });
    renderWithProviders(<VotePanel allocations={allocations} onNftSelected={vi.fn()} />);
    await screen.findByText(/re-sized for 2 selected veNFTs/i);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /cast 2 votes/i }));

    expect(writeContractMock).toHaveBeenCalledTimes(1);
    const call = writeContractMock.mock.calls[0][0];
    expect(call.functionName).toBe("aggregate3");
    expect(call.address).toBe("0xcA11bde05977b3631167028862bE2a173976CA11");
    const [calls] = call.args;
    expect(calls).toHaveLength(2);
    expect(calls.every((c: { target: string }) => c.target === "0xvoter")).toBe(true);
  });

  it("still casts a plain vote() (not a multicall) when only one veNFT is selected", async () => {
    renderWithProviders(<VotePanel allocations={allocations} onNftSelected={vi.fn()} />);
    await screen.findByText(/re-sized for veNFT #93/i);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^cast vote$/i }));

    expect(writeContractMock).toHaveBeenCalledTimes(1);
    expect(writeContractMock.mock.calls[0][0].functionName).toBe("vote");
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
    // A single detected veNFT is auto-selected on mount — nothing to click,
    // just wait for that selection to actually land before proceeding. This
    // describe block doesn't pass onNftSelected, so the "re-sized" message
    // other tests wait on never renders here — wait on the checkbox itself.
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "veNFT #93" })).toBeChecked());
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
