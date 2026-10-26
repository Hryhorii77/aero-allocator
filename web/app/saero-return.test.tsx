import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const OWNER = "0x9b3F205E43dc9FcC1cc2Fe6d9dCD0357769A6Bae";
const account = vi.hoisted(() => ({ address: undefined as string | undefined, chainId: 8453 as number | undefined }));
const write = vi.hoisted(() => ({ writeContract: vi.fn(), reset: vi.fn(), switchChain: vi.fn() }));
const sim = vi.hoisted(() => ({ simulateContract: vi.fn() }));
vi.mock("wagmi", () => ({
  useAccount: () => account,
  useSwitchChain: () => ({ switchChain: write.switchChain }),
  useWriteContract: () => ({ writeContract: write.writeContract, reset: write.reset, data: undefined, isPending: false, error: null }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}));
vi.mock("wagmi/actions", () => sim);
vi.mock("wagmi/chains", () => ({ base: { id: 8453 } }));
vi.mock("@/lib/wagmi", () => ({ wagmiConfig: {} }));

import { SaeroReturn } from "./saero-return";
import { DEALLOC_GAUGE } from "@/lib/allocate";
import type { SaeroPosition } from "@/lib/saero";

const position: SaeroPosition = {
  tokenId: 15308n,
  staked: 102.13,
  votingPower: 90.47,
  endSec: 1_900_000_000,
  isPermanent: false,
  committed: 102.13,
  parked: 0,
  parkedRaw: 0n,
  onBaseRaw: 102n * 10n ** 18n,
  lastAllocatedSec: 1,
};

describe("SaeroReturn", () => {
  beforeEach(() => {
    account.address = OWNER;
    account.chainId = 8453;
    write.writeContract.mockReset();
    write.switchChain.mockReset();
    sim.simulateContract.mockReset();
  });

  it("shows nothing for a position with no power on Base gauges", () => {
    const { container } = render(<SaeroReturn position={{ ...position, onBaseRaw: 0n, parkedRaw: 5n * 10n ** 18n }} cooldownReady />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the wait it is given, 47 hours when it is not", () => {
    const { unmount } = render(<SaeroReturn position={position} cooldownReady waitHours={24} />);
    fireEvent.click(screen.getByRole("button", { name: "return to idle…" }));
    expect(screen.getByText(/the 24-hour wait starts again/)).toBeInTheDocument();
    unmount();
    render(<SaeroReturn position={position} cooldownReady />);
    fireEvent.click(screen.getByRole("button", { name: "return to idle…" }));
    expect(screen.getByText(/the 47-hour wait starts again/)).toBeInTheDocument();
  });

  it("explains what happens, then simulates and sends one marker entry for the whole amount with no ETH", async () => {
    sim.simulateContract.mockResolvedValue({});
    render(<SaeroReturn position={position} cooldownReady />);
    fireEvent.click(screen.getByRole("button", { name: "return to idle…" }));
    expect(screen.getByText(/the 47-hour wait starts again/)).toBeInTheDocument();
    expect(screen.getByText(/No ETH is needed on Base/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "return to idle" }));
    await waitFor(() => expect(write.writeContract).toHaveBeenCalledTimes(1));
    const call = write.writeContract.mock.calls[0][0];
    expect(call.functionName).toBe("allocate");
    expect(call.args[1]).toEqual([]);
    expect(call.args[2][0].gauges).toEqual([{ gauge: DEALLOC_GAUGE, allocated: 102n * 10n ** 18n, data: "0x" }]);
    expect(call.value).toBeUndefined();
    expect(sim.simulateContract.mock.calls[0][1]).toMatchObject({ functionName: "allocate", account: OWNER });
  });

  it("does not ask the wallet when the contract would reject it, and says why in plain words", async () => {
    sim.simulateContract.mockRejectedValue({ shortMessage: "reverted", cause: { data: { errorName: "CooldownActive" } } });
    render(<SaeroReturn position={position} cooldownReady />);
    fireEvent.click(screen.getByRole("button", { name: "return to idle…" }));
    fireEvent.click(screen.getByRole("button", { name: "return to idle" }));
    expect(await screen.findByText(/would reject this: this position was allocated too recently: the wait after its last allocation has not ended\. Nothing was sent/)).toBeInTheDocument();
    expect(write.writeContract).not.toHaveBeenCalled();
  });

  it("is disabled during the cooldown", () => {
    render(<SaeroReturn position={position} cooldownReady={false} />);
    fireEvent.click(screen.getByRole("button", { name: "return to idle…" }));
    expect(screen.getByRole("button", { name: "return to idle" })).toBeDisabled();
    expect(screen.getByText(/Still in cooldown/)).toBeInTheDocument();
  });

  it("asks to switch to Base first when the wallet is on another chain, without simulating or sending", () => {
    account.chainId = 1;
    render(<SaeroReturn position={position} cooldownReady />);
    fireEvent.click(screen.getByRole("button", { name: "return to idle…" }));
    fireEvent.click(screen.getByRole("button", { name: "switch to Base" }));
    expect(write.switchChain).toHaveBeenCalledWith({ chainId: 8453 });
    expect(sim.simulateContract).not.toHaveBeenCalled();
    expect(write.writeContract).not.toHaveBeenCalled();
  });
});
