import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DISPLAY_PRESET } from "@/lib/protocol";

const { disconnectMock, switchChainMock, account } = vi.hoisted(() => ({
  disconnectMock: vi.fn(),
  switchChainMock: vi.fn(),
  account: { chainId: 0 as number | undefined },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0xf325610a2f9a0fB8BB92b472B8904349ea65C2ED",
    isConnected: true,
    chainId: account.chainId,
    connector: { name: "Rabby Wallet" },
  }),
  useConnect: () => ({ connectors: [], connect: vi.fn(), isPending: false }),
  useDisconnect: () => ({ disconnect: disconnectMock }),
  useSwitchChain: () => ({ switchChain: switchChainMock, isPending: false, error: undefined }),
  useReadContract: () => ({ data: undefined, isError: false }),
  useWriteContract: () => ({ writeContract: vi.fn(), data: undefined, isPending: false, error: undefined, reset: vi.fn() }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}));

import { ConnectButton } from "./wallet";

beforeEach(() => {
  disconnectMock.mockClear();
  switchChainMock.mockClear();
  account.chainId = DISPLAY_PRESET.chain.id;
});

describe("ConnectButton (connected)", () => {
  it("opens an account panel instead of disconnecting on click", async () => {
    const user = userEvent.setup();
    render(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: /wallet/i }));
    expect(disconnectMock).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /wallet/i })).toBeInTheDocument();
    expect(screen.getByText("Rabby Wallet")).toBeInTheDocument();
    expect(screen.getByText(DISPLAY_PRESET.networkName)).toBeInTheDocument();
  });

  it("disconnects only from the panel's disconnect row, then closes", async () => {
    const user = userEvent.setup();
    render(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: /wallet/i }));
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape without disconnecting", async () => {
    const user = userEvent.setup();
    render(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: /wallet/i }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it("flags a wrong network on the button and offers a switch", async () => {
    account.chainId = 1;
    const user = userEvent.setup();
    render(<ConnectButton />);
    await user.click(screen.getByRole("button", { name: /wrong network/i }));
    await user.click(screen.getByRole("button", { name: new RegExp(`switch to ${DISPLAY_PRESET.networkName}`, "i") }));
    expect(switchChainMock).toHaveBeenCalledWith({ chainId: DISPLAY_PRESET.chain.id });
  });
});
