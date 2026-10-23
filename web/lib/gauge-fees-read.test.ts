import { describe, expect, it, vi } from "vitest";

vi.mock("aero-allocator/config", () => ({
  PRESET: { defaultRpcUrl: "https://public.example" },
  RPC_URL: "https://private.example",
  RPC_URL_FALLBACK: "https://public.example",
}));
vi.mock("aero-allocator/prices", () => ({ getPrices: vi.fn() }));

vi.mock("./fee-ledger-store", () => ({ loadLedger: vi.fn(), saveLedger: vi.fn() }));

import { logRpcUrls } from "./gauge-fees-read";

describe("logRpcUrls", () => {
  it("tries the public node first, then the configured one, without duplicates", () => {
    expect(logRpcUrls()).toEqual(["https://public.example", "https://private.example"]);
  });
  it("uses a non-Base chain's own public nodes", async () => {
    const { chainById } = await import("./aero-chains");
    expect(logRpcUrls(chainById(1)!)).toEqual(chainById(1)!.rpcs);
  });
  it("prefers a chain's dedicated log nodes over its general ones", async () => {
    const { chainById } = await import("./aero-chains");
    expect(logRpcUrls(chainById(42161)!)).toEqual(["https://arb1.arbitrum.io/rpc"]);
    expect(logRpcUrls(chainById(57073)!)).toEqual(["https://rpc-qnd.inkonchain.com"]);
  });
});
