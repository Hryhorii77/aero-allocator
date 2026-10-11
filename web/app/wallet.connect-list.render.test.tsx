import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { connectMock, resetMock, state } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  resetMock: vi.fn(),
  state: {
    isPending: false,
    connectors: [] as Array<{ uid: string; id: string; name: string; type: string }>,
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

import { ConnectButton } from "./wallet";

const generic = { uid: "1", id: "injected", name: "Injected", type: "injected" };
const rabby = { uid: "2", id: "io.rabby", name: "Rabby Wallet", type: "injected" };
const coinbase = { uid: "3", id: "coinbaseWalletSDK", name: "Coinbase Wallet", type: "coinbaseWallet" };

beforeEach(() => {
  connectMock.mockClear();
  resetMock.mockClear();
  state.isPending = false;
  state.connectors = [generic, coinbase];
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
});
