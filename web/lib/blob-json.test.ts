// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("@vercel/blob", async (orig) => ({ ...(await orig<typeof import("@vercel/blob")>()), get, put }));

import { BlobPreconditionFailedError, BlobServiceNotAvailable } from "@vercel/blob";
import { loadForUpdate, saveIfUnchanged } from "./blob-json";

type Rec = { version: 1; items: number[] };
const isRec = (x: unknown): x is Rec => (x as Rec)?.version === 1 && Array.isArray((x as Rec)?.items);
const found = (body: string, etag = '"e1"') => ({ statusCode: 200, stream: new Response(body).body, headers: new Headers(), blob: { etag } });

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadForUpdate", () => {
  it("reads the record and its ETag from origin, not the CDN cache", async () => {
    get.mockResolvedValue(found(JSON.stringify({ version: 1, items: [1, 2] })));
    expect(await loadForUpdate("x.json", isRec, "t")).toEqual({ state: "ok", value: { version: 1, items: [1, 2] }, etag: '"e1"' });
    expect(get).toHaveBeenCalledWith("x.json", { access: "private", useCache: false });
  });

  it("calls a 404 missing, which is the only case a writer may start a new record from", async () => {
    get.mockResolvedValue(null);
    expect(await loadForUpdate("x.json", isRec, "t")).toEqual({ state: "missing" });
  });

  it("calls a failed read, garbled JSON or a record of the wrong shape an error, never missing", async () => {
    get.mockRejectedValueOnce(new BlobServiceNotAvailable());
    expect(await loadForUpdate("x.json", isRec, "t")).toEqual({ state: "error" });
    get.mockResolvedValueOnce(found("{not json"));
    expect(await loadForUpdate("x.json", isRec, "t")).toEqual({ state: "error" });
    get.mockResolvedValueOnce(found(JSON.stringify({ version: 2, items: [] })));
    expect(await loadForUpdate("x.json", isRec, "t")).toEqual({ state: "error" });
  });
});

describe("saveIfUnchanged", () => {
  it("overwrites only the version it read (ifMatch on the ETag)", async () => {
    put.mockResolvedValue({});
    expect(await saveIfUnchanged("x.json", { version: 1, items: [1] }, { state: "ok", value: {}, etag: '"e1"' }, "t")).toBe("saved");
    expect(put.mock.calls[0][2]).toMatchObject({ allowOverwrite: true, ifMatch: '"e1"', addRandomSuffix: false });
  });

  it("creates a first record without overwriting one that appeared meanwhile", async () => {
    put.mockResolvedValue({});
    await saveIfUnchanged("x.json", { version: 1, items: [] }, { state: "missing" }, "t");
    expect(put.mock.calls[0][2]).toMatchObject({ allowOverwrite: false });
    expect(put.mock.calls[0][2]).not.toHaveProperty("ifMatch");
  });

  it("reports a conflict when another run wrote first (the ETag moved on), and a plain failure otherwise", async () => {
    put.mockRejectedValueOnce(new BlobPreconditionFailedError());
    get.mockResolvedValueOnce(found(JSON.stringify({ version: 1, items: [9] }), '"newer"'));
    expect(await saveIfUnchanged("x.json", {}, { state: "ok", value: {}, etag: '"old"' }, "t")).toBe("conflict");
    expect(put).toHaveBeenCalledTimes(1);
    put.mockRejectedValueOnce(new Error("This blob already exists, use `allowOverwrite: true` if you want to overwrite it."));
    expect(await saveIfUnchanged("x.json", {}, { state: "missing" }, "t")).toBe("conflict");
    put.mockRejectedValueOnce(new BlobServiceNotAvailable());
    expect(await saveIfUnchanged("x.json", {}, { state: "ok", value: {}, etag: '"e1"' }, "t")).toBe("failed");
  });

  it("saves anyway when the refusal was spurious: nobody wrote (same ETag on a fresh read), so the record can't silently stop", async () => {
    put.mockRejectedValueOnce(new BlobPreconditionFailedError()).mockResolvedValueOnce({});
    get.mockResolvedValueOnce(found(JSON.stringify({ version: 1, items: [1] }), '"e1"'));
    expect(await saveIfUnchanged("x.json", { version: 1, items: [1, 2] }, { state: "ok", value: {}, etag: '"e1"' }, "t")).toBe("saved");
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1][2]).toMatchObject({ allowOverwrite: true });
    expect(put.mock.calls[1][2]).not.toHaveProperty("ifMatch");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("etag-mismatch"));
  });
});
