import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { AddressLookup, ConnectButton, VotePanel } from "./wallet";

// The lookup's only chain read. Mocked at the action, not the transport, so
// these tests pin what the component does with VeSugar's answer — and that
// it goes to the RPC directly rather than through any /api route.
const { readContractMock } = vi.hoisted(() => ({ readContractMock: vi.fn() }));
vi.mock("wagmi/actions", () => ({ readContract: readContractMock }));

function renderWithProviders(children: React.ReactNode) {
  const queryClient = new QueryClient();
  return render(
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>,
  );
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

describe("ConnectButton", () => {
  it("shows a connect prompt when no wallet is connected", () => {
    renderWithProviders(<ConnectButton />);
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
  });

  it("lists the configured connectors when opened", async () => {
    renderWithProviders(<ConnectButton />);
    screen.getByRole("button", { name: /connect wallet/i }).click();
    // wagmiConfig (lib/wagmi.ts) registers injected() and coinbaseWallet();
    // "Injected" is relabeled to "Browser Wallet" since it's builder jargon.
    expect(await screen.findByText(/browser wallet/i)).toBeInTheDocument();
    expect(screen.getByText(/coinbase/i)).toBeInTheDocument();
  });

  it("closes the wallet list on click-outside, Escape, or the close button", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <div>
        <ConnectButton />
        <button>outside</button>
      </div>,
    );
    const open = () => user.click(screen.getByRole("button", { name: /connect wallet/i }));

    await open();
    expect(await screen.findByText(/browser wallet/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /outside/i }));
    expect(screen.queryByText(/browser wallet/i)).not.toBeInTheDocument();

    await open();
    expect(await screen.findByText(/browser wallet/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByText(/browser wallet/i)).not.toBeInTheDocument();

    await open();
    expect(await screen.findByText(/browser wallet/i)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText(/browser wallet/i)).not.toBeInTheDocument();
  });

  it("filters out non-EVM wallet connectors from the list", async () => {
    renderWithProviders(<ConnectButton />);
    screen.getByRole("button", { name: /connect wallet/i }).click();
    await screen.findByText(/browser wallet/i);
    for (const name of ["Plug", "Keplr", "TronLink", "Temple"]) {
      expect(screen.queryByText(new RegExp(name, "i"))).not.toBeInTheDocument();
    }
  });
});

describe("VotePanel (disconnected)", () => {
  const allocations = [{ pool: "0xpool1", symbol: "TEST/USDC", weightPct: 100 }];

  it("prompts to connect a wallet rather than showing the vote controls", () => {
    renderWithProviders(<VotePanel allocations={allocations} />);
    // Connect lives next to the one step that needs it, and says the
    // numbers don't.
    expect(screen.getByText(/connect to cast in one tx/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cast vote/i })).not.toBeInTheDocument();
  });

  it("still offers the no-wallet calldata option while disconnected", () => {
    renderWithProviders(<VotePanel allocations={allocations} />);
    expect(screen.getByPlaceholderText(/veNFT id/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy calldata/i })).toBeInTheDocument();
  });

  it("lets the contract address wrap instead of overflowing its card (spotted live on a narrow viewport)", async () => {
    renderWithProviders(<VotePanel allocations={allocations} />);
    const address = await screen.findByText("0xvoter");
    expect(address.className).toMatch(/\bbreak-all\b/);
  });

  it("disables the copy-calldata button until a veNFT id is entered", () => {
    renderWithProviders(<VotePanel allocations={allocations} />);
    expect(screen.getByRole("button", { name: /copy calldata/i })).toBeDisabled();
  });
});

describe("AddressLookup", () => {
  const holder = "0x1111111111111111111111111111111111111111";

  it("fills the combined voting power and blended split of every lock at that address", async () => {
    readContractMock.mockResolvedValueOnce([
      { id: 1n, voting_amount: 3000n * 10n ** 18n, votes: [{ lp: "0xPoolA", weight: 1n }] },
      { id: 2n, voting_amount: 1000n * 10n ** 18n, votes: [{ lp: "0xPoolB", weight: 1n }] },
      // No voting power (expired lock) — ignored, same as the connected path.
      { id: 3n, voting_amount: 0n, votes: [] },
    ]);
    const onFound = vi.fn();
    renderWithProviders(<AddressLookup onFound={onFound} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: /address to look up/i }), holder);
    await waitFor(() => expect(screen.getByRole("button", { name: /look up/i })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /look up/i }));

    await waitFor(() => expect(onFound).toHaveBeenCalledTimes(1));
    const [votingPower, votes, address] = onFound.mock.calls[0];
    expect(votingPower).toBe(4000);
    expect(votes).toEqual([
      { pool: "0xpoola", weightPct: 75 },
      { pool: "0xpoolb", weightPct: 25 },
    ]);
    expect(address).toBe(holder);
    // Straight to VeSugar, never via our own API with the address in it.
    expect(readContractMock.mock.calls[0][1]).toMatchObject({ functionName: "byAccount", args: [holder] });
    const fetchCalls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(fetchCalls.some(([url]) => String(url).toLowerCase().includes(holder))).toBe(false);
  });

  it("says so and leaves the amount alone when the address holds no voting power", async () => {
    readContractMock.mockResolvedValueOnce([]);
    const onFound = vi.fn();
    renderWithProviders(<AddressLookup onFound={onFound} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: /address to look up/i }), holder);
    await waitFor(() => expect(screen.getByRole("button", { name: /look up/i })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /look up/i }));

    expect(await screen.findByText(/no veAERO locks with voting power there/i)).toBeInTheDocument();
    expect(onFound).not.toHaveBeenCalled();
  });

  it("rejects something that isn't an address without reading the chain", async () => {
    readContractMock.mockClear();
    renderWithProviders(<AddressLookup onFound={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: /address to look up/i }), "vitalik.eth");
    await waitFor(() => expect(screen.getByRole("button", { name: /look up/i })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /look up/i }));

    expect(await screen.findByText(/isn.t an address/i)).toBeInTheDocument();
    expect(readContractMock).not.toHaveBeenCalled();
  });
});
