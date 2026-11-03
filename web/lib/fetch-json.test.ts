import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, fetchJsonOrNull, HttpError } from "./fetch-json";

afterEach(() => vi.unstubAllGlobals());

describe("fetchJson", () => {
  it("returns the parsed body on a 2xx answer and asks for exactly the URL given", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ a: 1 }) }));
    vi.stubGlobal("fetch", f);
    expect(await fetchJson<{ a: number }>("/api/x?y=1")).toEqual({ a: 1 });
    expect(f).toHaveBeenCalledWith("/api/x?y=1");
  });
  it("rejects with the HTTP status on a non-2xx answer, and passes a network error through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })));
    await expect(fetchJson("/api/x")).rejects.toMatchObject({ name: "HttpError", status: 429 });
    await expect(fetchJson("/api/x")).rejects.toBeInstanceOf(HttpError);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(fetchJson("/api/x")).rejects.toThrow("Failed to fetch");
  });
});

describe("fetchJsonOrNull", () => {
  it("is null on a bad status or no answer, and the body otherwise", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    expect(await fetchJsonOrNull("/api/x")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await fetchJsonOrNull("/api/x")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => [1] })));
    expect(await fetchJsonOrNull<number[]>("/api/x")).toEqual([1]);
  });
});
