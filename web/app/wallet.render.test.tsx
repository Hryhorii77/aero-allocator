import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { ConnectButton } from "./wallet";

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
    // The dialog's backdrop covers the page, so "outside" is the backdrop.
    await user.pointer({ keys: "[MouseLeft]", target: screen.getByRole("dialog").parentElement as HTMLElement });
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
