import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { SaeroPosition } from "@/lib/saero";

const read = vi.hoisted(() => ({ readContract: vi.fn(), readContracts: vi.fn() }));
vi.mock("wagmi/actions", () => read);
vi.mock("@/lib/wagmi", () => ({ wagmiConfig: {} }));

import { PositionAdviceLine } from "./position-advice-line";

const g = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const E18 = 10n ** 18n;
const position: SaeroPosition = { tokenId: 7n, staked: 10_000, votingPower: 10_000, endSec: 0, isPermanent: true, committed: 10_000, parked: 0, parkedRaw: 0n, onBaseRaw: 10_000n * E18, lastAllocatedSec: 0 };

function stubFetch(ok = true) {
  const gauges = [1, 2].map((n) => ({ gauge: g(n), pool: g(n + 100), symbol: `P${n}`, weight: n === 1 ? 1_000_000 : 300_000, sharePct: 1, capPerWeek: 1, activated: true, incentivesUsdPerWeek: 0, incentivesUsdPer1k: 0 }));
  const fees = [{ gauge: g(1), feesUsdPerDay: 100, windowHours: 30 }, { gauge: g(2), feesUsdPerDay: 5000, windowHours: 30 }];
  const spy = vi.fn(async (url: string) => ({ ok, json: async () => (url.includes("fees") ? { fees, windowHours: 30 } : { gauges }) }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("PositionAdviceLine", () => {
  beforeEach(() => {
    read.readContract.mockReset().mockResolvedValue([g(1)]);
    read.readContracts.mockReset().mockResolvedValue([10_000n * E18]);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("says what staying costs and reports it to the list", async () => {
    stubFetch();
    const onCost = vi.fn();
    render(<PositionAdviceLine position={position} onCost={onCost} />);
    expect(await screen.findByText(/staying costs about \$\d/)).toBeInTheDocument();
    expect(onCost).toHaveBeenCalledWith(7n, expect.any(Number));
    expect(onCost.mock.calls[0][1]).toBeGreaterThan(0);
  });

  it("shows nothing, and reports nothing, when the gauge read fails", async () => {
    stubFetch(false);
    const onCost = vi.fn();
    const { container } = render(<PositionAdviceLine position={position} onCost={onCost} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(onCost).not.toHaveBeenCalled();
  });

  it("shows nothing when where the position sits can't be read", async () => {
    stubFetch();
    read.readContract.mockRejectedValue(new Error("rpc down"));
    const onCost = vi.fn();
    const { container } = render(<PositionAdviceLine position={position} onCost={onCost} />);
    await waitFor(() => expect(read.readContract).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(onCost).not.toHaveBeenCalled();
  });
});
