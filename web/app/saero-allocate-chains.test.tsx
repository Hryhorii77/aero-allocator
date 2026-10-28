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
const leaf = vi.hoisted(() => ({ readLeafChain: vi.fn() }));
vi.mock("@/lib/leaf-read", () => leaf);

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
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => (url.includes("allocation-fee") ? { chainId: 10, gauges: 1, chainStep: "1000", gaugeStep: "2000", gaugeBase: "1000", perGauge: "1000", total: "3000", returnCost: "145" } : body) })));
}
function mockChainFetch(opts: { noFeesOn?: number } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const chain = Number(new URL(url, "http://x").searchParams.get("chain"));
      const gauge = chain === 5042 ? g(0xa1) : g(0xb1);
      const baseTwo = chain === 8453;
      const body = url.includes("allocation-fee")
        ? { chainId: chain, gauges: 1, chainStep: "1000", gaugeStep: "2000", gaugeBase: "1000", perGauge: "1000", total: "3000", returnCost: "145" }
        : url.includes("gauge-fees")
          ? { chainId: chain, generatedAt: Date.now(), fees: chain === opts.noFeesOn ? [] : [{ gauge, feesUsdPerDay: 500, windowHours: 30 }, ...(baseTwo ? [{ gauge: g(0xb2), feesUsdPerDay: 300, windowHours: 30 }] : [])] }
          : url.includes("api/gauges")
            ? { chainId: chain, generatedAt: Date.now(), totalWeight: 1, gauges: [{ gauge, pool: g(0xc1), symbol: chain === 5042 ? "WETH/USDC" : "A/B", weight: 2_000_000, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0 }, ...(baseTwo ? [{ gauge: g(0xb2), pool: g(0xc2), symbol: "C/D", weight: 2_000_000, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0 }] : [])] }
            : spread;
      return { ok: true, json: async () => body };
    }),
  );
}
const sendButton = async () => {
  const b = await screen.findByRole("button", { name: "send this step" });
  await waitFor(() => expect(b).toBeEnabled());
  return b;
};
const open = () => fireEvent.click(screen.getByRole("button", { name: /allocate across chains…/ }));

beforeEach(() => {
  vi.clearAllMocks();
  tx.hash = undefined;
  tx.receipt = undefined;
  act.readContract.mockResolvedValue([]);
  leaf.readLeafChain.mockResolvedValue({ chainId: 0, gauges: [], total: 0n, idle: 0n, lastAllocatedSec: 0, cooldownSec: 169_200 });
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
    fireEvent.click(await sendButton());
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
    fireEvent.click(await sendButton());
    expect(await screen.findByText(/would reject this: CooldownActive\(\)\. Nothing was sent/)).toBeInTheDocument();
    expect(write.writeContract).not.toHaveBeenCalled();
  });

  it("plans the return to idle first when Base's share goes down, and blocks it during the Base wait", async () => {
    mockFetch(spread);
    render(<SaeroAllocateChains position={{ ...position, parkedRaw: 0n, onBaseRaw: 1000n * E }} cooldownReady={false} />);
    open();
    expect(await screen.findByText(/2 transactions, one after the other/)).toBeInTheDocument();
    expect(screen.getAllByText(/Move part of the Base allocation back to idle/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "send this step" })).toBeDisabled();
    expect(screen.getByText(/Still in cooldown/)).toBeInTheDocument();
  });

  describe("a position that already has power on another chain", () => {
    const OP_AMOUNT = 40n * E;
    const leafState = (o: object = {}) => ({ chainId: 10, gauges: [{ gauge: g(9), amount: OP_AMOUNT }], total: OP_AMOUNT, idle: 0n, lastAllocatedSec: 0, cooldownSec: 169_200, ...o });
    beforeEach(() => {
      mockChainFetch();
      act.readContracts.mockResolvedValue([0n, OP_AMOUNT, 0n, 0n, 0n, 0n]);
      leaf.readLeafChain.mockResolvedValue(leafState());
    });

    it("lists the chain and its gauges, and offers the best gauges and a return to idle instead of the new-split buttons", async () => {
      render(<SaeroAllocateChains position={position} cooldownReady />);
      open();
      expect(await screen.findByText(/This position has power on other chains/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "choose the chains myself" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "set the best gauges" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "return to idle" })).toBeEnabled();
    });

    it("returns a chain's power with the marker, carrying the return cost on top of the message fee", async () => {
      render(<SaeroAllocateChains position={position} cooldownReady />);
      open();
      fireEvent.click(await screen.findByRole("button", { name: "return to idle" }));
      await waitFor(() => expect(write.writeContract).toHaveBeenCalledTimes(1));
      const sent = write.writeContract.mock.calls[0][0];
      const d = sent.args[2][0];
      expect(d.chainId).toBe(10n);
      expect(d.gauges).toHaveLength(1);
      expect(d.gauges[0].allocated).toBe(OP_AMOUNT);
      expect(d.value).toBe(2200n + 145n); // outbound fee with the 10% margin, plus the exact return cost
      expect(sent.value).toBe(d.value);
      expect(sent.args[1]).toEqual([]);
    });

    it("sets the best gauges for the chain's power with the whole budget spread over them", async () => {
      render(<SaeroAllocateChains position={position} cooldownReady />);
      open();
      fireEvent.click(await screen.findByRole("button", { name: "set the best gauges" }));
      await waitFor(() => expect(write.writeContract).toHaveBeenCalledTimes(1));
      const d = write.writeContract.mock.calls[0][0].args[2][0];
      expect(d.gauges.reduce((a: bigint, x: { allocated: bigint }) => a + x.allocated, 0n)).toBe(OP_AMOUNT);
      expect(d.value).toBe(2200n);
    });

    it("offers nothing while the chain's own wait is running", async () => {
      leaf.readLeafChain.mockResolvedValue(leafState({ lastAllocatedSec: Math.floor(Date.now() / 1000) - 60 }));
      render(<SaeroAllocateChains position={position} cooldownReady />);
      open();
      expect((await screen.findAllByText(/wait ends in/)).length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "set the best gauges" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "return to idle" })).toBeDisabled();
    });

    it("offers nothing while Aero's last message is still on its way (the chain and Base don't agree)", async () => {
      leaf.readLeafChain.mockResolvedValue(leafState({ gauges: [], total: 0n, idle: 0n }));
      render(<SaeroAllocateChains position={position} cooldownReady />);
      open();
      expect((await screen.findAllByText(/still on its way/)).length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "return to idle" })).toBeDisabled();
    });

    it("offers nothing when the chain's own node can't be read", async () => {
      leaf.readLeafChain.mockResolvedValue(null);
      render(<SaeroAllocateChains position={position} cooldownReady />);
      open();
      expect((await screen.findAllByText(/Could not read OP's own node/)).length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "return to idle" })).toBeDisabled();
    });
  });

  it("shows no transaction in the chosen-chains mode until another chain has a percentage", async () => {
    mockChainFetch();
    render(<SaeroAllocateChains position={position} cooldownReady />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "choose the chains myself" }));
    expect(await screen.findByText(/Type a percentage for at least one chain/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "send this step" })).toBeNull();
    expect(screen.queryByText(/Next:/)).toBeNull();
    // a typo is not "nothing typed": it gets its own message and still no transaction
    fireEvent.change(screen.getByLabelText("percent of the position on Arc"), { target: { value: "abc" } });
    expect(screen.queryByRole("button", { name: "send this step" })).toBeNull();
  });

  it("picks the gauges inside a chain when asked, each with its own share", async () => {
    mockChainFetch();
    render(<SaeroAllocateChains position={position} cooldownReady />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "choose the chains myself" }));
    fireEvent.change(screen.getByLabelText("percent of the position on Arc"), { target: { value: "30" } });
    const summary = await screen.findByText(/Pick the gauges on Base myself/, {}, { timeout: 4000 });
    expect(summary.textContent).toMatch(/best split now/);
    fireEvent.click(screen.getByLabelText("use A/B on Base"));
    fireEvent.click(screen.getByLabelText("use C/D on Base"));
    fireEvent.change(screen.getByLabelText("percent of Base on A/B"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("percent of Base on C/D"), { target: { value: "40" } });
    // 70% on Base, split 60/40 by the owner: 42% and 28% of the whole
    expect(await screen.findByText(/A\/B 42%/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/C\/D 28%/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("percent of Base on C/D"), { target: { value: "30" } });
    expect(await screen.findByText(/Base: The gauges you picked add up to 90%, not 100%/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "send this step" })).toBeNull();
  });

  it("moves power straight from one chain to another as a return and then a send, and offers the return first", async () => {
    mockChainFetch();
    act.readContracts.mockResolvedValue([0n, 40n * E, 0n, 0n, 0n, 0n]);
    leaf.readLeafChain.mockImplementation(async (c: number) => (c === 10 ? { chainId: 10, gauges: [{ gauge: g(9), amount: 40n * E }], total: 40n * E, idle: 0n, lastAllocatedSec: 0, cooldownSec: 169_200 } : { chainId: c, gauges: [], total: 0n, idle: 0n, lastAllocatedSec: 0, cooldownSec: 169_200 }));
    render(<SaeroAllocateChains position={{ ...position, parkedRaw: 0n, onBaseRaw: 0n }} cooldownReady />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "choose the chains myself" }));
    fireEvent.change(screen.getByLabelText("percent of the position on Arc"), { target: { value: "100" } });
    expect(await screen.findByText(/2 transactions, one after the other/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getAllByText(/Return power from one chain to idle/).length).toBeGreaterThan(0);
    fireEvent.click(await sendButton());
    await waitFor(() => expect(write.writeContract).toHaveBeenCalledTimes(1));
    const sent = write.writeContract.mock.calls[0][0];
    expect(sent.args[1]).toEqual([]);
    expect(sent.args[2].map((d: { chainId: bigint }) => d.chainId)).toEqual([10n]);
    expect(sent.args[2][0].gauges).toHaveLength(1);
    expect(sent.args[2][0].gauges[0].allocated).toBe(40n * E);
    expect(sent.value).toBe(sent.args[2][0].value);
  });

  it("says a return is on its way, not that the chain's wait is running, once the chain has applied it", async () => {
    mockChainFetch();
    act.readContracts.mockResolvedValue([0n, 40n * E, 0n, 0n, 0n, 0n]);
    // the chain already released half (its own record shows 20) and started its wait; Base has not been credited yet
    leaf.readLeafChain.mockResolvedValue({ chainId: 10, gauges: [{ gauge: g(9), amount: 20n * E }], total: 20n * E, idle: 0n, lastAllocatedSec: Math.floor(Date.now() / 1000) - 60, cooldownSec: 169_200 });
    render(<SaeroAllocateChains position={{ ...position, parkedRaw: 0n, onBaseRaw: 0n }} cooldownReady />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "choose the chains myself" }));
    fireEvent.change(screen.getByLabelText("percent of the position on Arc"), { target: { value: "100" } });
    expect((await screen.findAllByText(/still on its way/, {}, { timeout: 4000 })).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "send this step" })).toBeDisabled();
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
