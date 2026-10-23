import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const OWNER = "0x9b3F205E43dc9FcC1cc2Fe6d9dCD0357769A6Bae";
const account = vi.hoisted(() => ({ address: undefined as string | undefined, chainId: 8453 as number | undefined }));
const write = vi.hoisted(() => ({ writeContract: vi.fn(), reset: vi.fn() }));
const sim = vi.hoisted(() => ({ simulateContract: vi.fn() }));
vi.mock("wagmi", () => ({
  useAccount: () => account,
  useSwitchChain: () => ({ switchChain: vi.fn() }),
  useWriteContract: () => ({ writeContract: write.writeContract, reset: write.reset, data: undefined, isPending: false, error: null }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}));
vi.mock("wagmi/actions", () => sim);
vi.mock("wagmi/chains", () => ({ base: { id: 8453 } }));
vi.mock("@/lib/wagmi", () => ({ wagmiConfig: {} }));

import { equalShares, SaeroAllocate } from "./saero-allocate";
import type { SaeroPosition } from "@/lib/saero";

const g = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const position: SaeroPosition = {
  tokenId: 6045n,
  staked: 1000,
  votingPower: 900,
  endSec: 0,
  isPermanent: true,
  committed: 1000,
  parked: 1000,
  parkedRaw: 1000n * 10n ** 18n,
  onBaseRaw: 0n,
  lastAllocatedSec: 0,
};

function mockFetch() {
  const gauges = [1, 2, 3, 4].map((n) => ({ gauge: g(n), pool: g(n + 100), symbol: `P${n}`, weight: 1_000_000, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0 }));
  const fees = gauges.map((x, i) => ({ gauge: x.gauge, feesUsdPerDay: 1000 - i * 100, windowHours: 20 }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => (url.includes("fees") ? { fees, windowHours: 20 } : { gauges }) })));
}

describe("equalShares", () => {
  it("adds up to exactly 100", () => {
    expect(equalShares(3)).toEqual([33.33, 33.33, 33.34]);
    expect(equalShares(1)).toEqual([100]);
    expect(equalShares(0)).toEqual([]);
    for (const n of [2, 3, 6, 7, 9, 10]) expect(equalShares(n).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });
});

describe("SaeroAllocate", () => {
  beforeEach(() => {
    account.address = OWNER;
    account.chainId = 8453;
    write.writeContract.mockReset();
    sim.simulateContract.mockReset();
    mockFetch();
  });

  it("prefills the best three gauges at 100% total and sends allocate after a clean simulation", async () => {
    sim.simulateContract.mockResolvedValue({});
    render(<SaeroAllocate position={position} cooldownReady />);
    fireEvent.click(screen.getByRole("button", { name: /allocate…/ }));
    expect(await screen.findByText(/Shares add up to 100%/)).toBeInTheDocument();
    expect(screen.getByLabelText("share of P1")).toHaveValue("33.33");
    fireEvent.click(screen.getByRole("button", { name: "allocate" }));
    await waitFor(() => expect(write.writeContract).toHaveBeenCalledTimes(1));
    const call = write.writeContract.mock.calls[0][0];
    expect(call.functionName).toBe("allocate");
    expect(call.args[1]).toEqual([{ chainId: 8453n, delta: 1000n * 10n ** 18n, gasLimit: 0n, value: 0n }]);
    expect(call.args[2][0].gauges.reduce((a: bigint, x: { allocated: bigint }) => a + x.allocated, 0n)).toBe(1000n * 10n ** 18n);
  });

  it("does not ask the wallet when the simulation says the contract would reject it", async () => {
    sim.simulateContract.mockRejectedValue({ shortMessage: "CooldownActive()" });
    render(<SaeroAllocate position={position} cooldownReady />);
    fireEvent.click(screen.getByRole("button", { name: /allocate…/ }));
    await screen.findByText(/Shares add up to 100%/);
    fireEvent.click(screen.getByRole("button", { name: "allocate" }));
    expect(await screen.findByText(/would reject this: CooldownActive\(\)\. Nothing was sent/)).toBeInTheDocument();
    expect(write.writeContract).not.toHaveBeenCalled();
  });

  it("blocks sending while shares don't add up to 100", async () => {
    render(<SaeroAllocate position={position} cooldownReady />);
    fireEvent.click(screen.getByRole("button", { name: /allocate…/ }));
    await screen.findByText(/Shares add up to 100%/);
    fireEvent.change(screen.getByLabelText("share of P1"), { target: { value: "50" } });
    expect(screen.getByText(/must be 100%/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "allocate" })).toBeDisabled();
  });

  it("is disabled during the cooldown", async () => {
    render(<SaeroAllocate position={position} cooldownReady={false} />);
    fireEvent.click(screen.getByRole("button", { name: /allocate…/ }));
    await screen.findByText(/Shares add up to 100%/);
    expect(screen.getByRole("button", { name: "allocate" })).toBeDisabled();
    expect(screen.getByText(/Still in cooldown/)).toBeInTheDocument();
  });

  it("explains when all power sits on other chains", () => {
    render(<SaeroAllocate position={{ ...position, parkedRaw: 0n, onBaseRaw: 0n }} cooldownReady />);
    expect(screen.getByText(/other chains/)).toBeInTheDocument();
  });
});
