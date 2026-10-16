import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseUnits } from "viem";
import { BASE_USDC, TIP_ADDRESS, TipJar } from "./tip-jar";

const { writeContract } = vi.hoisted(() => ({ writeContract: vi.fn() }));
vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: true, chainId: 8453 }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }),
  useWaitForTransactionReceipt: () => ({ isSuccess: false }),
  useWriteContract: () => ({ writeContract, data: undefined, isPending: false, error: null, reset: vi.fn() }),
}));

describe("TipJar (wallet connected on Base)", () => {
  it("sends a preset amount as a USDC transfer to the tip address", async () => {
    writeContract.mockClear();
    const user = userEvent.setup();
    render(<TipJar />);
    await user.click(screen.getByRole("button", { name: /tip/i }));
    await user.click(screen.getByRole("button", { name: "$5" }));
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: BASE_USDC,
        functionName: "transfer",
        args: [TIP_ADDRESS, parseUnits("5", 6)],
        chainId: 8453,
      }),
    );
  });

  it("sends a typed amount, and keeps send disabled for an invalid one", async () => {
    writeContract.mockClear();
    const user = userEvent.setup();
    render(<TipJar />);
    await user.click(screen.getByRole("button", { name: /tip/i }));
    const input = screen.getByRole("textbox", { name: /custom tip amount/i });
    const send = screen.getByRole("button", { name: "send" });
    expect(send).toBeDisabled();
    await user.type(input, "abc");
    expect(send).toBeDisabled();
    expect(screen.getByText(/enter an amount/i)).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "2.5");
    await user.click(send);
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ args: [TIP_ADDRESS, parseUnits("2.5", 6)] }),
    );
  });
});
