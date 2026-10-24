import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import Page from "./page";

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

function renderPage() {
  return render(
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={new QueryClient()}>
        <Page />
      </QueryClientProvider>
    </WagmiProvider>,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.localStorage.clear();
  fetchMock = vi.fn(async (url: string | URL) => {
    if (String(url).includes("/api/protocol")) return jsonResponse({ protocol: "aerodrome", voterAddress: "0xvoter", veSugarAddress: "0xvesugar" });
    return { ok: false, status: 500 } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.pushState({}, "", "/");
});

describe("Page", () => {
  it("is only the sAERO page: no weekly vote sections, clock or snapshot, and it never asks for the weekly data", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: /Where to allocate your sAERO/ })).toBeInTheDocument();
    expect(screen.getByText("Your sAERO positions")).toBeInTheDocument();
    expect(screen.getByText(/Where to allocate your sAERO: gauges ranked/)).toBeInTheDocument();
    // The what's-new log may still mention old features by name; the page itself must not show them.
    const outsideLog = (re: RegExp) => screen.queryAllByText(re).filter((el) => !el.closest("details"));
    for (const gone of [/Where to vote your/, /Voter ROI/, /predicted hot pools/i, /cast vote/i, /votes close in|voting closed/i, /snapshot \d+\w* ago/i]) {
      expect(outsideLog(gone)).toEqual([]);
    }
    const asked = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(asked.some((u) => /\/api\/(dashboard|bribe|snapshot|vote-swings|lp-deposit|allocation\b|v1)/.test(u))).toBe(false);
    // A jump bar in the header gets you to each section.
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getByRole("link", { name: "Gauges" })).toHaveAttribute("href", "#gauges");
    expect(within(nav).getByRole("link", { name: "Positions" })).toHaveAttribute("href", "#positions");
    // One wallet button, the header's.
    expect(screen.getAllByRole("button", { name: /connect wallet/i })).toHaveLength(1);
  });
});
