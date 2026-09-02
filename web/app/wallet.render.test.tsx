import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { ConnectButton, VotePanel } from "./wallet";

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
    // wagmiConfig (lib/wagmi.ts) registers injected() and coinbaseWallet().
    expect(await screen.findByText(/injected/i)).toBeInTheDocument();
    expect(screen.getByText(/coinbase/i)).toBeInTheDocument();
  });
});

describe("VotePanel (disconnected)", () => {
  const allocations = [{ pool: "0xpool1", symbol: "TEST/USDC", weightPct: 100 }];

  it("prompts to connect a wallet rather than showing the vote controls", () => {
    renderWithProviders(<VotePanel allocations={allocations} />);
    expect(screen.getByText(/connect a wallet to cast this allocation/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cast vote/i })).not.toBeInTheDocument();
  });

  it("still offers the no-wallet calldata option while disconnected", () => {
    renderWithProviders(<VotePanel allocations={allocations} />);
    expect(screen.getByPlaceholderText(/veNFT id/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy calldata/i })).toBeInTheDocument();
  });

  it("disables the copy-calldata button until a veNFT id is entered", () => {
    renderWithProviders(<VotePanel allocations={allocations} />);
    expect(screen.getByRole("button", { name: /copy calldata/i })).toBeDisabled();
  });
});
