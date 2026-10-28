import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const account = vi.hoisted(() => ({ address: "0x9b3F205E43dc9FcC1cc2Fe6d9dCD0357769A6Bae" as string | undefined, chainId: 8453 as number | undefined }));
const write = vi.hoisted(() => ({ writeContract: vi.fn(), reset: vi.fn() }));
const tx = vi.hoisted(() => ({ hash: undefined as string | undefined, receipt: undefined as { status: string } | undefined }));
const act = vi.hoisted(() => ({ simulateContract: vi.fn(), estimateGas: vi.fn(), readContract: vi.fn(), readContracts: vi.fn() }));
vi.mock("wagmi", () => ({
  useAccount: () => account,
  useSwitchChain: () => ({ switchChain: vi.fn() }),
  useWriteContract: () => ({ writeContract: write.writeContract, reset: write.reset, data: tx.hash, isPending: false, error: null }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, data: tx.receipt }),
}));
vi.mock("wagmi/actions", () => act);
vi.mock("wagmi/chains", () => ({ base: { id: 8453 } }));
vi.mock("@/lib/wagmi", () => ({ wagmiConfig: {} }));

import { SaeroAllocateChains } from "./saero-allocate-chains";
import type { SaeroPosition } from "@/lib/saero";

const g = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const E = 10n ** 18n;
const position: SaeroPosition = { tokenId: 15308n, staked: 1000, votingPower: 900, endSec: 0, isPermanent: true, committed: 1000, parked: 1000, parkedRaw: 1000n * E, onBaseRaw: 0n, lastAllocatedSec: 0 };

const part = (gauge: string, symbol: string, pct: number) => ({ gauge, symbol, pct, usdPerDay: 1 });
const split = (chains: unknown[]) => ({
  amount: 900, days: 1.96, ethUsd: 2300, generatedAt: Date.now(), skipped: [], baseOnly: null,
  best: { chains, usdPerDay: 20, feeUsd: 0.5, netUsd: 38, weakestHours: 30, spiky: false, confidence: "solid" },
});
const spread = split([
  { chainId: 8453, name: "Base", pct: 60, usdPerDay: 12, feeUsd: 0, parts: [part(g(5), "A/B", 60)] },
  { chainId: 10, name: "OP", pct: 40, usdPerDay: 8, feeUsd: 0.5, parts: [part(g(9), "C/D", 40)] },
]);
const baseOnly = split([{ chainId: 8453, name: "Base", pct: 100, usdPerDay: 20, feeUsd: 0, parts: [part(g(5), "A/B", 100)] }]);

function mockFetch(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => (url.includes("allocation-fee") ? { chainId: 10, gauges: 1, chainStep: "1000", gaugeStep: "2000", total: "3000", returnCost: "0" } : body) })));
}
function mockChainFetch(opts: { noFeesOn?: number } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const chain = Number(new URL(url, "http://x").searchParams.get("chain"));
      const gauge = chain === 5042 ? g(0xa1) : g(0xb1);
      const body = url.includes("allocation-fee")
        ? { chainId: chain, gauges: 1, chainStep: "1000", gaugeStep: "2000", total: "3000", returnCost: "0" }
        : url.includes("gauge-fees")
          ? { chainId: chain, generatedAt: Date.now(), fees: chain === opts.noFeesOn ? [] : [{ gauge, feesUsdPerDay: 500, windowHours: 30 }] }
          : url.includes("api/gauges")
            ? { chainId: chain, generatedAt: Date.now(), totalWeight: 1, gauges: [{ gauge, pool: g(0xc1), symbol: chain === 5042 ? "WETH/USDC" : "A/B", weight: 2_000_000, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0 }] }
            : spread;
      return { ok: true, json: async () => body };
    }),
  );
}
const open = () => fireEvent.click(screen.getByRole("button", { name: /allocate across chains…/ }));

beforeEach(() => {
  vi.clearAllMocks();
  tx.hash = undefined;
  tx.receipt = undefined;
  act.readContract.mockResolvedValue([]);
  act.readContracts.mockResolvedValue([0n, 0n, 0n, 0n, 0n]);
  act.simulateContract.mockResolvedValue({});
  act.estimateGas.mockResolvedValue(1_000_000n);
});

describe("SaeroAllocateChains", () => {
  it("shows the split and the one transaction, simulates it, then sends it with the ETH and gas headroom", async () => {
    mockFetch(spread);
    render(<SaeroAllocateChains position={position} cooldownReady />);
    expect(screen.queryByText(/Spread this position/)).toBeNull();
    open();
    expect(await screen.findByText(/One transaction/)).toBeInTheDocument();
    expect(screen.getByText(/C\/D 40%/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "send this step" }));
    await waitFor(() => expect(write.writeContract).toHaveBeenCalledTimes(1));
    const sent = write.writeContract.mock.calls[0][0];
    expect(act.simulateContract).toHaveBeenCalledTimes(1);
    expect(sent.gas).toBe(1_300_000n);
    expect(sent.value).toBe(3300n + 0n); // (1000 + 2000) with the 10% margin
    expect(sent.args[1].map((c: { chainId: bigint }) => c.chainId)).toEqual([10n, 8453n]);
  });

  it("sends nothing when the simulation says the contract would reject it", async () => {
    mockFetch(spread);
    act.simulateContract.mockRejectedValue({ shortMessage: "CooldownActive()" });
    render(<SaeroAllocateChains position={position} cooldownReady />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "send this step" }));
    expect(await screen.findByText(/would reject this: CooldownActive\(\)\. Nothing was sent/)).toBeInTheDocument();
    expect(write.writeContract).not.toHaveBeenCalled();
  });

  it("plans the return to idle first when Base's share goes down, and blocks it during the Base wait", async () => {
    mockFetch(spread);
    render(<SaeroAllocateChains position={{ ...position, parkedRaw: 0n, onBaseRaw: 1000n * E }} cooldownReady={false} />);
    open();
    expect(await screen.findByText(/2 transactions, one after the other/)).toBeInTheDocument();
    expect(screen.getByText(/Move part of the Base allocation back to idle/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "send this step" })).toBeDisabled();
    expect(screen.getByText(/Still in cooldown/)).toBeInTheDocument();
  });

  it("leaves a position that already has power on another chain to Aero's app", async () => {
    mockFetch(spread);
    act.readContracts.mockResolvedValue([5n * E, 0n, 0n, 0n, 0n]);
    render(<SaeroAllocateChains position={position} cooldownReady />);
    open();
    expect(await screen.findByText(/already has power on other chains/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "send this step" })).toBeNull();
  });

  it("plans a split typed chain by chain, with Base keeping the rest, and sends it", async () => {
    mockChainFetch();
    render(<SaeroAllocateChains position={position} cooldownReady />);
    open();
    await screen.findByRole("button", { name: "choose the chains myself" });
    fireEvent.click(screen.getByRole("button", { name: "choose the chains myself" }));
    fireEvent.change(screen.getByLabelText("percent of the position on Arc"), { target: { value: "30" } });
    expect(screen.getAllByText(/Base keeps/).some((el) => /70%/.test(el.textContent ?? ""))).toBe(true);
    expect(await screen.findByText(/WETH\/USDC 30%/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/One transaction/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "send this step" }));
    await waitFor(() => expect(write.writeContract).toHaveBeenCalledTimes(1));
    const sent = write.writeContract.mock.calls[0][0];
    expect(sent.args[1].map((c: { chainId: bigint }) => c.chainId)).toEqual([5042n, 8453n]);
    expect(sent.args[1][0].delta).toBe(300n * E);
    expect(sent.args[1][1].delta).toBe(700n * E);
  });

  it("lets any chain take a share, not only Arc, and refuses shares above 100%", async () => {
    mockChainFetch();
    render(<SaeroAllocateChains position={position} cooldownReady />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "choose the chains myself" }));
    for (const name of ["Ethereum", "OP", "Arbitrum", "Ink", "Robinhood Chain", "Arc"]) expect(screen.getByLabelText(`percent of the position on ${name}`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("percent of the position on OP"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("percent of the position on Arc"), { target: { value: "50" } });
    expect(await screen.findByText(/add up to more than 100%/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "send this step" })).toBeNull();
  });

  it("says so when a chosen chain has no gauge that can be ranked yet", async () => {
    mockChainFetch({ noFeesOn: 5042 });
    render(<SaeroAllocateChains position={position} cooldownReady />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "choose the chains myself" }));
    fireEvent.change(screen.getByLabelText("percent of the position on Arc"), { target: { value: "30" } });
    expect(await screen.findByText(/No gauge on Arc has a fee estimate yet/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "send this step" })).toBeNull();
  });

  it("sends you to the plain allocate button when Base alone is the best use", async () => {
    mockFetch(baseOnly);
    render(<SaeroAllocateChains position={position} cooldownReady />);
    open();
    expect(await screen.findByText(/Staying on Base is the best use/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "send this step" })).toBeNull();
  });

  it("says a reverted transaction changed nothing, and re-reads the position after a confirmed one", async () => {
    mockFetch(spread);
    const onAllocated = vi.fn();
    tx.hash = "0xabc";
    tx.receipt = { status: "reverted" };
    const { unmount } = render(<SaeroAllocateChains position={position} cooldownReady onAllocated={onAllocated} />);
    open();
    expect(await screen.findByText(/mined but failed, so nothing changed/)).toBeInTheDocument();
    expect(onAllocated).not.toHaveBeenCalled();
    unmount();
    tx.receipt = { status: "success" };
    render(<SaeroAllocateChains position={position} cooldownReady onAllocated={onAllocated} />);
    expect(onAllocated).toHaveBeenCalledTimes(1);
  });
});
