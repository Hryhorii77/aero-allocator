import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AutopilotComparePanel } from "./autopilot-compare";

const g = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const gauges = [1].map((n) => ({ gauge: g(n), pool: g(n + 100), symbol: `P${n}`, weight: 990_000, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0 }));
const fees = { chainId: 8453, generatedAt: 0, windowHours: 40, fees: [{ gauge: g(1), feesUsdPerDay: 1000, windowHours: 40 }] };
// One pool of 1,000,000 power: 600,000 on a Base gauge paying $1,000/day with 2,000,000 in it, 300,000 on OP, 100,000 off every gauge.
const data = {
  generatedAt: Date.UTC(2026, 10, 3, 16, 30),
  skipped: [],
  pools: [
    {
      tokenId: "20366",
      power: 1_000_000,
      chains: [
        { chainId: 8453, name: "Base", gauges: [{ gauge: "0xb", label: "B", allocated: 600_000, rateUsdPerDay: 1000, weight: 2_000_000, priced: true }] },
        { chainId: 10, name: "OP", gauges: [{ gauge: "0xo", label: "O", allocated: 300_000, rateUsdPerDay: 600, weight: 1_000_000, priced: true }] },
      ],
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("AutopilotComparePanel", () => {
  it("reads only when opened, then shows what a deposit would pay you next to the best split, and where the pool's power sits", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => data }));
    vi.stubGlobal("fetch", f);
    render(<AutopilotComparePanel gauges={gauges} fees={fees} amount={10_000} />);
    expect(f).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "compare with Autopilot" }));
    const row = (await screen.findByText(/Autopilot pool #20366/)).closest("li")!;
    // The pool earns $480/day on 1M power; 10,000 deposited gets a little under 1% of it ($4.75), the best split $10 (all in P1).
    expect(row).toHaveTextContent(/for you \$4\.7\d\/day · best split \$10\.00/);
    expect(row).toHaveTextContent("Base 60% · OP 30% · not on any gauge 10%");
    expect(screen.getByText(/before Autopilot.s own fee, which Aero hasn.t published/)).toBeInTheDocument();
    expect(screen.getByText(/queue of up to 47 hours/)).toBeInTheDocument();
  });

  it("says so plainly when the read fails, or when no pool holds power", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const { unmount } = render(<AutopilotComparePanel gauges={gauges} fees={fees} amount={10_000} />);
    fireEvent.click(screen.getByRole("button", { name: "compare with Autopilot" }));
    expect(await screen.findByText(/Could not read Autopilot.s pools/)).toBeInTheDocument();
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ...data, pools: [] }) })));
    render(<AutopilotComparePanel gauges={gauges} fees={fees} amount={10_000} />);
    fireEvent.click(screen.getByRole("button", { name: "compare with Autopilot" }));
    expect(await screen.findByText(/No Autopilot pool holds any power/)).toBeInTheDocument();
  });
});
