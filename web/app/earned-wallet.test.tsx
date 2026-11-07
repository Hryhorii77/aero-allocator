import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EarnedAll, EarnedChain } from "@/lib/earned";
import { combinePositions } from "@/lib/earned";

const reader = vi.hoisted(() => ({ readEarnedAll: vi.fn() }));
vi.mock("@/lib/earned-read", () => reader);

import { EarnedWalletTotal } from "./earned-wallet";

const empty = { lines: [], totalUsd: 0, unpriced: false };
const chain = (chainId: number, name: string, usd: number): EarnedChain => ({
  chainId,
  name,
  fees: { lines: [{ token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", amount: usd, usd }], totalUsd: usd, unpriced: false },
  incentives: empty,
  totalUsd: usd,
  unpriced: false,
});
const all = (chains: EarnedChain[], extra: Partial<EarnedAll> = {}): EarnedAll => ({ chains, totalUsd: chains.reduce((s, c) => s + c.totalUsd, 0), atLeast: false, skipped: [], ...extra });

describe("combinePositions", () => {
  it("adds every position and chain up, largest first", () => {
    const w = combinePositions([
      { tokenId: 1n, all: all([chain(8453, "Base", 10), chain(10, "OP", 2)]) },
      { tokenId: 2n, all: all([chain(8453, "Base", 5)]) },
      { tokenId: 3n, all: all([]) },
    ]);
    expect(w.totalUsd).toBe(17);
    expect(w.atLeast).toBe(false);
    expect(w.chains).toEqual([
      { chainId: 8453, name: "Base", totalUsd: 15 },
      { chainId: 10, name: "OP", totalUsd: 2 },
    ]);
    expect(w.positions.map((p) => [p.tokenId, p.totalUsd])).toEqual([
      [1n, 12],
      [2n, 5],
      [3n, 0],
    ]);
  });

  it("is a floor when a position or a chain wasn't read", () => {
    const w = combinePositions([
      { tokenId: 1n, all: all([chain(8453, "Base", 10)], { skipped: ["Arc"] }) },
      { tokenId: 2n, all: null },
    ]);
    expect(w).toMatchObject({ totalUsd: 10, atLeast: true, failed: [2n], skipped: ["Arc"] });
    expect(w.positions[0].atLeast).toBe(true);
  });
});

describe("EarnedWalletTotal", () => {
  afterEach(() => cleanup());

  it("reads every position once when pressed and shows one total, per chain and per position", async () => {
    const byId: Record<string, EarnedAll> = {
      "1": all([chain(8453, "Base", 1.5)]),
      "2": all([chain(8453, "Base", 2), chain(57073, "Ink", 0.25)]),
      "3": all([]),
    };
    reader.readEarnedAll.mockImplementation(async (id: bigint) => byId[id.toString()]);
    render(<EarnedWalletTotal tokenIds={[1n, 2n, 3n]} />);
    expect(reader.readEarnedAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "show earnings for all 3 positions" }));
    const total = await screen.findByText(/Unclaimed across all 3 positions/);
    expect(total.closest("p")).toHaveTextContent("Unclaimed across all 3 positions: $3.75");
    expect(reader.readEarnedAll).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/^Base:/).closest("p")).toHaveTextContent("Base: $3.50 · Ink: $0.25");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["#2: $2.25", "#1: $1.50", "#3: $0.00"]);
  });

  it("says 'at least' and names what wasn't read", async () => {
    reader.readEarnedAll.mockImplementation(async (id: bigint) => {
      if (id === 2n) throw new Error("rpc");
      return all([chain(8453, "Base", 4)], { skipped: ["Arc"] });
    });
    render(<EarnedWalletTotal tokenIds={[1n, 2n]} />);
    fireEvent.click(screen.getByRole("button"));
    expect((await screen.findByText(/Unclaimed across/)).closest("p")).toHaveTextContent("at least $4.00");
    expect(screen.getByText(/Not read just now: positions #2; Arc for some positions/)).toBeInTheDocument();
  });

  it("says so when nothing could be read", async () => {
    reader.readEarnedAll.mockImplementation(() => Promise.reject(new Error("rpc")));
    render(<EarnedWalletTotal tokenIds={[1n, 2n]} />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/Couldn.t read the earnings/)).toBeInTheDocument();
  });
});
