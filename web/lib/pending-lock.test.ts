import { afterEach, describe, expect, it, vi } from "vitest";
import { PENDING_LOCK_MS, pendingLeftMs, setPending } from "./pending-lock";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("pending lock", () => {
  it("blocks a position and chain for the window after a send, then lets go", () => {
    setPending(15308n, 5042, 1_000);
    expect(pendingLeftMs(15308n, 5042, 1_000 + 60_000)).toBe(PENDING_LOCK_MS - 60_000);
    expect(pendingLeftMs(15308n, 5042, 1_000 + PENDING_LOCK_MS + 1)).toBe(0);
    expect(pendingLeftMs(15308n, 10, 1_000)).toBe(0);
    expect(pendingLeftMs(1n, 5042, 1_000)).toBe(0);
  });
  it("does nothing, and does not throw, when storage is unavailable", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(() => setPending(1n, 1)).not.toThrow();
    expect(pendingLeftMs(1n, 1)).toBe(0);
  });
});
