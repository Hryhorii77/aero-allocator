import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { AllChainsSplitPanel, horizonText, ReadingNote } from "./all-chains-split";

const acrossBase = { chains: [{ chainId: 8453, name: "Base", pct: 100, usdPerDay: 20, feeUsd: 0, parts: [{ symbol: "A/B", gauge: "0x1", pct: 100, usdPerDay: 20 }] }], usdPerDay: 20, feeUsd: 0, netUsd: 40, weakestHours: 30, spiky: false, confidence: "solid" };
const spread = {
  chains: [
    { chainId: 8453, name: "Base", pct: 60, usdPerDay: 12, feeUsd: 0, parts: [{ symbol: "A/B", gauge: "0x1", pct: 60, usdPerDay: 12 }] },
    { chainId: 1, name: "Ethereum", pct: 40, usdPerDay: 9, feeUsd: 2.7, parts: [{ symbol: "C/D", gauge: "0x2", pct: 40, usdPerDay: 9 }] },
  ],
  usdPerDay: 21,
  feeUsd: 2.7,
  netUsd: 60,
  weakestHours: 30,
  spiky: false,
  confidence: "solid",
};
const body = (best: object) => ({ amount: 1000, days: 30, ethUsd: 2300, generatedAt: Date.now(), best, baseOnly: acrossBase, skipped: [] });

afterEach(() => vi.unstubAllGlobals());

describe("AllChainsSplitPanel", () => {
  it("reads nothing until pressed, then says when staying on Base is best", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => body(acrossBase) }));
    vi.stubGlobal("fetch", f);
    render(<AllChainsSplitPanel amount={1000} />);
    expect(f).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "compare all chains" }));
    expect(await screen.findByText(/Staying on Base is the best use/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(f).toHaveBeenCalledWith("/api/all-chains-split?amount=1000");
  });

  it("shows each chain's share, the ETH fee and the gain over Base alone, and points to the position's allocate-across-chains button", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body(spread) })));
    render(<AllChainsSplitPanel amount={1000} />);
    fireEvent.click(screen.getByRole("button", { name: "compare all chains" }));
    expect(await screen.findByText(/across 2 chains/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/\+\$20\.00/)).toBeInTheDocument();
    expect(screen.getByText(/about \$2\.70 in ETH to send power here/)).toBeInTheDocument();
    expect(screen.getByText(/allocate across chains…/)).toBeInTheDocument();
  });

  it("asks for the chosen horizon and says so when the read fails", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    vi.stubGlobal("fetch", f);
    render(<AllChainsSplitPanel amount={1000} />);
    fireEvent.click(screen.getByRole("button", { name: "compare all chains" }));
    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    expect(await screen.findByText(/Could not read the chains just now/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(f).toHaveBeenLastCalledWith("/api/all-chains-split?amount=1000&days=30");
  });
});

describe("ReadingNote", () => {
  afterEach(() => vi.useRealTimers());
  it("counts the seconds while a read runs and says why it takes a while", () => {
    vi.useFakeTimers();
    render(<ReadingNote />);
    expect(screen.getByRole("status")).toHaveTextContent(/Reading every chain… 0 s/);
    expect(screen.getByRole("status")).toHaveTextContent(/up to about 20 seconds/);
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.getByRole("status")).toHaveTextContent(/Reading every chain… 7 s/);
  });
  it("shows while the panel waits for the read", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<AllChainsSplitPanel amount={1000} />);
    fireEvent.click(screen.getByRole("button", { name: "compare all chains" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Reading every chain/);
  });
});

describe("horizonText", () => {
  it("says hours for the wait and days for longer", () => {
    expect(horizonText(1.9583)).toBe("47 hours");
    expect(horizonText(7)).toBe("7 days");
  });
});
