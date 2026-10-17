import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { connectMock, resetMock, state } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  resetMock: vi.fn(),
  state: {
    isPending: false,
    connectors: [] as Array<{ uid: string; id: string; name: string; type: string; icon?: string }>,
  },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: undefined, isConnected: false }),
  useConnect: () => ({
    connectors: state.connectors,
    connect: connectMock,
    isPending: state.isPending,
    reset: resetMock,
  }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false, error: undefined }),
  useReadContract: () => ({ data: undefined, isError: false }),
  useWriteContract: () => ({ writeContract: vi.fn(), data: undefined, isPending: false, error: undefined, reset: vi.fn() }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}));

import { ConnectButton, coinbaseWalletDappLink } from "./wallet";

const generic = { uid: "1", id: "injected", name: "Injected", type: "injected" };
const rabby = { uid: "2", id: "io.rabby", name: "Rabby Wallet", type: "injected", icon: "data:image/svg+xml;base64,AAAA" };
const coinbase = { uid: "3", id: "coinbaseWalletSDK", name: "Coinbase Wallet", type: "coinbaseWallet" };

beforeEach(() => {
  connectMock.mockClear();
  resetMock.mockClear();
  state.isPending = false;
  state.connectors = [generic, coinbase];
  localStorage.clear();
});

describe("ConnectButton (disconnected)", () => {
  it("lists the generic Browser Wallet when no wallet announced itself by name", async () => {
    const user = userEvent.setup();
    render(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: /connect wallet/i }));
    expect(screen.getByText("Browser Wallet")).toBeInTheDocument();
  });

  it("hides the generic Browser Wallet once a named injected wallet is detected", async () => {
    state.connectors = [generic, rabby, coinbase];
    const user = userEvent.setup();
    render(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: /connect wallet/i }));
    expect(screen.queryByText("Browser Wallet")).not.toBeInTheDocument();
    expect(screen.getByText("Rabby Wallet")).toBeInTheDocument();
    expect(screen.getByText("Coinbase Wallet")).toBeInTheDocument();
  });

  it("does not lock while a wallet request is pending: clicking cancels and reopens the list", async () => {
    state.isPending = true;
    const user = userEvent.setup();
    render(<ConnectButton />);
    const button = screen.getByRole("button", { name: /approve in wallet/i });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Browser Wallet")).toBeInTheDocument();
  });

  it("groups wallets as Installed (announced by name) and Popular, in a Connect a Wallet dialog", async () => {
    state.connectors = [generic, rabby, coinbase];
    const user = userEvent.setup();
    render(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: /connect wallet/i }));
    const dialog = screen.getByRole("dialog", { name: /connect a wallet/i });
    expect(dialog).toHaveTextContent(/Installed\s*Rabby Wallet/);
    expect(dialog).toHaveTextContent(/Popular\s*Coinbase Wallet/);
    expect(dialog.querySelector("img")).not.toBeNull();
  });

  it("tags the last-used wallet as Recent", async () => {
    state.connectors = [generic, rabby, coinbase];
    localStorage.setItem("wagmi.recentConnectorId", JSON.stringify("io.rabby"));
    const user = userEvent.setup();
    render(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: /connect wallet/i }));
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  it("connects with the picked wallet and closes the dialog", async () => {
    state.connectors = [generic, rabby, coinbase];
    const user = userEvent.setup();
    render(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: /connect wallet/i }));
    await user.click(screen.getByRole("button", { name: /rabby wallet/i }));
    expect(connectMock).toHaveBeenCalledWith({ connector: rabby });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ConnectButton on a phone's normal browser (no injected provider)", () => {
  const walletConnect = { uid: "4", id: "walletConnect", name: "WalletConnect", type: "walletConnect" };
  const phoneUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

  beforeEach(() => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(phoneUA);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers Coinbase Wallet and Other wallets (WalletConnect's window), without the dead Browser Wallet", async () => {
    state.connectors = [generic, coinbase, walletConnect];
    const user = userEvent.setup();
    render(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: /connect wallet/i }));
    expect(connectMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: /connect a wallet/i });
    expect(dialog).toHaveTextContent("Coinbase Wallet");
    expect(dialog).toHaveTextContent("Other wallets");
    expect(screen.queryByText("Browser Wallet")).not.toBeInTheDocument();
  });

  it("'Other wallets' connects through the WalletConnect connector", async () => {
    state.connectors = [generic, coinbase, walletConnect];
    const user = userEvent.setup();
    render(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: /connect wallet/i }));
    await user.click(screen.getByText("Other wallets"));
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock.mock.calls[0][0]).toMatchObject({ connector: walletConnect });
  });

  it("Coinbase Wallet reopens this page inside the Coinbase Wallet app instead of using the SDK popup", async () => {
    state.connectors = [generic, coinbase, walletConnect];
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ href: "https://aeroallocator.app/?vp=500", assign } as unknown as Location);
    const user = userEvent.setup();
    render(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: /connect wallet/i }));
    await user.click(screen.getByText("Coinbase Wallet"));
    expect(assign).toHaveBeenCalledWith(
      "https://go.cb-w.com/dapp?cb_url=https%3A%2F%2Faeroallocator.app%2F%3Fvp%3D500",
    );
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("builds the Coinbase Wallet dapp link with the page address encoded", () => {
    expect(coinbaseWalletDappLink("https://aeroallocator.app/?a=1&b=2")).toBe(
      "https://go.cb-w.com/dapp?cb_url=https%3A%2F%2Faeroallocator.app%2F%3Fa%3D1%26b%3D2",
    );
  });

  it("without WalletConnect configured, at least drops the Browser Wallet entry that can never connect", async () => {
    state.connectors = [generic, coinbase];
    const user = userEvent.setup();
    render(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: /connect wallet/i }));
    expect(connectMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Browser Wallet")).not.toBeInTheDocument();
    expect(screen.getByText("Coinbase Wallet")).toBeInTheDocument();
  });

  it("keeps the normal list inside a wallet app's own browser (injected provider present)", async () => {
    (window as unknown as { ethereum?: unknown }).ethereum = {};
    try {
      state.connectors = [generic, coinbase, walletConnect];
      const user = userEvent.setup();
      render(<ConnectButton />);
      await user.click(screen.getByRole("button", { name: /connect wallet/i }));
      expect(connectMock).not.toHaveBeenCalled();
      expect(screen.getByText("Browser Wallet")).toBeInTheDocument();
    } finally {
      delete (window as unknown as { ethereum?: unknown }).ethereum;
    }
  });
});

describe("ConnectButton on desktop with WalletConnect configured", () => {
  it("lists Other wallets (WalletConnect: scan a QR with a phone wallet) next to the other options", async () => {
    state.connectors = [generic, coinbase, { uid: "4", id: "walletConnect", name: "WalletConnect", type: "walletConnect" }];
    const user = userEvent.setup();
    render(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: /connect wallet/i }));
    expect(connectMock).not.toHaveBeenCalled();
    expect(screen.getByText("Other wallets")).toBeInTheDocument();
  });
});
