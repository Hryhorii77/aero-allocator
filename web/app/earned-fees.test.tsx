import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EarnedAll } from "@/lib/earned";

const reader = vi.hoisted(() => ({ readEarnedAll: vi.fn() }));
vi.mock("@/lib/earned-read", () => reader);

import { EarnedFees } from "./earned-fees";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const line = (symbol: string, amount: number, usd: number | null) => ({ token: USDC, symbol, amount, usd });
const sum = (lines: ReturnType<typeof line>[]) => ({ lines, totalUsd: lines.reduce((s, l) => s + (l.usd ?? 0), 0), unpriced: lines.some((l) => l.usd === null) });

describe("EarnedFees", () => {
  afterEach(() => cleanup());

  it("reads nothing until asked, then shows fees and incentives per chain with the total", async () => {
    const all: EarnedAll = {
      chains: [
        { chainId: 8453, name: "Base", fees: sum([line("USDC", 1.5, 1.5)]), incentives: sum([line("RSGP", 30, 0.75)]), totalUsd: 2.25, unpriced: false },
        { chainId: 10, name: "OP", fees: sum([line("OP", 2, null)]), incentives: sum([]), totalUsd: 0, unpriced: true },
      ],
      totalUsd: 2.25,
      atLeast: true,
      skipped: ["Arc"],
    };
    reader.readEarnedAll.mockResolvedValue(all);
    render(<EarnedFees tokenId={15308n} />);
    expect(reader.readEarnedAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "show earnings so far" }));
    expect((await screen.findByText(/Unclaimed so far/)).closest("p")).toHaveTextContent("at least $2.25");
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Base: fees $1.50 (1.5 USDC) · incentives $0.75 (30 RSGP)");
    expect(rows[1]).toHaveTextContent("OP: fees ≥ $0.00 (2 OP)");
    expect(screen.getByText(/Not read just now: Arc/)).toBeInTheDocument();
  });

  it("says so when nothing is unclaimed", async () => {
    reader.readEarnedAll.mockResolvedValue({ chains: [], totalUsd: 0, atLeast: false, skipped: [] });
    render(<EarnedFees tokenId={1n} />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/Nothing unclaimed on the gauges/)).toBeInTheDocument();
  });

  it("says so when the read fails", async () => {
    reader.readEarnedAll.mockImplementation(() => Promise.reject(new Error("rpc")));
    render(<EarnedFees tokenId={1n} />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/Couldn.t read the earnings/)).toBeInTheDocument();
  });
});
