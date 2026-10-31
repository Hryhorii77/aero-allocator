import { BlobPreconditionFailedError, get as getBlob, put } from "@vercel/blob";

/**
 * Read-modify-write for the JSON blobs that can't be rebuilt from the chain (the track record and the 90-day daily record).
 *
 * The plain loaders turn every failure into `null`, which the writers used to read as "no record yet": one failed or garbled read
 * would have started a fresh file over months of history. Here a missing blob (404) and a failed read are different answers, a
 * writer never saves after a failed read, and the save carries the ETag it read (`ifMatch`), so a run that overlapped another one
 * can't overwrite what that run just wrote. A first write uses `allowOverwrite: false` for the same reason.
 */
export type Loaded<T> = { state: "missing" } | { state: "ok"; value: T; etag: string } | { state: "error" };
export type SaveResult = "saved" | "conflict" | "failed";

const log = (tag: string, reason: string, e: unknown) =>
  console.error(JSON.stringify({ level: "error", tag, reason, message: e instanceof Error ? e.message : String(e) }));

/** Reads from origin, not the CDN cache: the ETag must be the current one or the conditional save fails for no reason. */
export async function loadForUpdate<T>(path: string, valid: (x: unknown) => x is T, tag: string): Promise<Loaded<T>> {
  try {
    const res = await getBlob(path, { access: "private", useCache: false });
    if (res === null) return { state: "missing" };
    if (res.statusCode !== 200 || !res.stream) throw new Error(`unexpected status ${res.statusCode}`);
    const parsed: unknown = JSON.parse(await new Response(res.stream).text());
    // A file that exists but doesn't parse as a record is NOT missing: overwriting it would destroy whatever it holds.
    if (!valid(parsed)) throw new Error("stored record failed validation");
    return { state: "ok", value: parsed, etag: res.blob.etag };
  } catch (e) {
    log(tag, "load-failed", e);
    return { state: "error" };
  }
}

/** Saves only over the version that was read (or only if there was none), never after a failed read. */
export async function saveIfUnchanged(path: string, value: unknown, read: Exclude<Loaded<unknown>, { state: "error" }>, tag: string): Promise<SaveResult> {
  try {
    await put(path, JSON.stringify(value), {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
      ...(read.state === "ok" ? { allowOverwrite: true, ifMatch: read.etag } : { allowOverwrite: false }),
    });
    return "saved";
  } catch (e) {
    // Another run wrote first (changed ETag, or the file appeared since we saw none). Its write stands; the next cron run picks up from it.
    const conflict = e instanceof BlobPreconditionFailedError || (read.state === "missing" && e instanceof Error && /already exists/i.test(e.message));
    log(tag, conflict ? "save-conflict" : "save-failed", e);
    return conflict ? "conflict" : "failed";
  }
}
