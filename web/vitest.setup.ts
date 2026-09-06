import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL's own auto-cleanup only self-registers when it detects Jest/Vitest
// globals (`globals: true` in config) — this project imports
// describe/it/expect explicitly instead, so without this, unmounted DOM
// from one test leaks into the next within the same file and produces
// spurious "found multiple elements" failures.
afterEach(cleanup);

// jsdom's `window` is aliased to `globalThis` in this vitest environment, so
// `localStorage` resolves to Node's own experimental global instead of
// jsdom's implementation — which is undefined without a --localstorage-file
// flag (logs a warning and breaks any code that reads/writes it). Replace it
// with a real in-memory Storage so tests see the same localStorage behavior
// a browser would.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  writable: true,
  configurable: true,
});

afterEach(() => globalThis.localStorage.clear());
