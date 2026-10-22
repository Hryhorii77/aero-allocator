import { describe, expect, it, vi } from "vitest";

vi.mock("aero-allocator/config", () => ({
  PRESET: { defaultRpcUrl: "https://public.example" },
  RPC_URL: "https://private.example",
  RPC_URL_FALLBACK: "https://public.example",
}));
vi.mock("aero-allocator/prices", () => ({ getPrices: vi.fn() }));

import { logRpcUrls } from "./gauge-fees-read";

describe("logRpcUrls", () => {
  it("tries the public node first, then the configured one, without duplicates", () => {
    expect(logRpcUrls()).toEqual(["https://public.example", "https://private.example"]);
  });
});
