import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { getPresetSplit, setPresetSplit } from "@/lib/preset-split";
import { TopAllocatorsPanel } from "./top-allocators";

const g = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const gauges = [1, 2, 3].map((n) => ({ gauge: g(n), pool: g(n + 100), symbol: `P${n}`, weight: 990_000, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0 }));
const fees = { chainId: 8453, generatedAt: 0, windowHours: 40, fees: [{ gauge: g(1), feesUsdPerDay: 1000, windowHours: 40 }, { gauge: g(2), feesUsdPerDay: 500, windowHours: 40 }, { gauge: g(3), feesUsdPerDay: 100, windowHours: 40 }] };
const data = {
  generatedAt: Date.UTC(2026, 10, 3, 14, 5),
  totalPower: 1_000_000_000,
  allocators: [
    { tokenId: "10426", power: 207_210_030, onBase: 106_692_444, parts: [{ gauge: g(2), pct: 50 }, { gauge: g(3), pct: 50 }] },
    { tokenId: "20366", power: 27_810_000, onBase: 17_070_000, parts: [{ gauge: g(1), pct: 100 }], autopilot: true },
    { tokenId: "8305", power: 9_131_028, onBase: 0, parts: [] },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  setPresetSplit(null);
});

describe("TopAllocatorsPanel", () => {
  it("reads the allocators only when opened, then prices each split for your amount next to the best split", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => data }));
    vi.stubGlobal("fetch", f);
    render(<TopAllocatorsPanel gauges={gauges} fees={fees} amount={10_000} />);
    expect(f).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "biggest allocators" }));
    expect(await screen.findByText(/#10426/)).toHaveTextContent("207.2M power (20.7% of all) · 51% on Base");
    // Their split for 10,000: 5,000 into P2 ($500/day) and P3 ($100/day), each then holding 995,000: 500 x 5k/995k + 100 x 5k/995k = $3.02.
    // The best split puts all 10,000 into P1 ($1,000/day): 1000 x 10,000 / 1,000,000 = $10.00.
    const row = screen.getByText(/#10426/).closest("li")!;
    expect(row).toHaveTextContent("for you $3.02/day · best split $10.00");
    expect(row).toHaveTextContent("P2 50% · P3 50%");
    expect(screen.getByText(/Nothing on Base gauges right now/)).toBeInTheDocument();
    expect(screen.getByText(/at 14:05 UTC/)).toBeInTheDocument();
    // Autopilot's pools are labelled, so they aren't mistaken for one holder's choice; ordinary positions aren't.
    expect(screen.getByText(/#20366/).closest("li")).toHaveTextContent("Aero Autopilot");
    expect(row).not.toHaveTextContent("Aero Autopilot");
  });

  it("copies a split for the allocate panel and says where to find it, without sending anything", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => data })));
    render(<TopAllocatorsPanel gauges={gauges} fees={fees} amount={10_000} />);
    fireEvent.click(screen.getByRole("button", { name: "biggest allocators" }));
    await screen.findByText(/#10426/);
    fireEvent.click(screen.getAllByRole("button", { name: "use this split" })[0]);
    expect(getPresetSplit()).toEqual({ from: "position #10426", parts: data.allocators[0].parts });
    expect(screen.getByText(/Open .allocate….* on your position below/)).toBeInTheDocument();
  });

  it("says so plainly when the read fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    render(<TopAllocatorsPanel gauges={gauges} fees={fees} amount={10_000} />);
    fireEvent.click(screen.getByRole("button", { name: "biggest allocators" }));
    expect(await screen.findByText(/Could not read the positions just now/)).toBeInTheDocument();
  });
});
