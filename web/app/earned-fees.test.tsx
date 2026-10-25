import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const read = vi.hoisted(() => ({ readContract: vi.fn(), readContracts: vi.fn() }));
vi.mock("wagmi/actions", () => read);
vi.mock("@/lib/wagmi", () => ({ wagmiConfig: {} }));

import { EarnedFees } from "./earned-fees";

const GAUGE = "0xCBa7452690663D6789C0115fe889C9da85Bf8c56";
const MGR = "0x39686Eb0f6D6ABb4e55297427687b13D256fae26";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ZEC = "0xB2000000000000000000008501b13360000cb2EC";

function script() {
  read.readContract.mockResolvedValue([GAUGE]);
  read.readContracts
    .mockResolvedValueOnce([MGR])
    .mockResolvedValueOnce([[26_386n, 2_398n], USDC, ZEC])
    .mockResolvedValueOnce([
      { status: "success", result: 6 },
      { status: "success", result: "USDC" },
      { status: "success", result: 8 },
      { status: "success", result: "cbZEC" },
    ]);
}

describe("EarnedFees", () => {
  beforeEach(() => {
    read.readContract.mockReset();
    read.readContracts.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("reads nothing until asked, then shows the unclaimed fees in tokens and dollars", async () => {
    script();
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ prices: { [USDC.toLowerCase()]: 1 } }) }));
    vi.stubGlobal("fetch", f);
    render(<EarnedFees tokenId={15308n} />);
    expect(read.readContract).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "show fees earned so far" }));
    const line = (await screen.findByText(/Unclaimed fees on its current gauges/)).closest("p");
    expect(line).toHaveTextContent("at least $0.03");
    expect(line).toHaveTextContent("0.026386 USDC");
    expect(line).toHaveTextContent("0.000024 cbZEC");
    // Only public token addresses are sent for pricing; the position isn't.
    const url = String((f.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("/api/token-prices?tokens=");
    expect(url).not.toContain("15308");
  });

  it("says so when the position has no gauges, and when the read fails", async () => {
    read.readContract.mockResolvedValue([]);
    const a = render(<EarnedFees tokenId={1n} />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/No unclaimed fees on the gauges/)).toBeInTheDocument();
    a.unmount();
    read.readContract.mockRejectedValue(new Error("rpc"));
    render(<EarnedFees tokenId={1n} />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/Couldn.t read the earned fees/)).toBeInTheDocument();
  });
});
