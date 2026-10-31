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

const putJson = (path: string, value: unknown, cond: { allowOverwrite: boolean; ifMatch?: string }) =>
  put(path, JSON.stringify(value), { access: "private", addRandomSuffix: false, contentType: "application/json", ...cond });

/** Saves only over the version that was read (or only if there was none), never after a failed read. */
export async function saveIfUnchanged(path: string, value: unknown, read: Exclude<Loaded<unknown>, { state: "error" }>, tag: string): Promise<SaveResult> {
  try {
    await putJson(path, value, read.state === "ok" ? { allowOverwrite: true, ifMatch: read.etag } : { allowOverwrite: false });
    return "saved";
  } catch (e) {
    // Another run wrote first (changed ETag, or the file appeared since we saw none). Its write stands; the next cron run picks up from it.
    const conflict = e instanceof BlobPreconditionFailedError || (read.state === "missing" && e instanceof Error && /already exists/i.test(e.message));
    if (!conflict) {
      log(tag, "save-failed", e);
      return "failed";
    }
    // Safety net: the ETag comes from the blob's read URL and the condition is checked by the API. If those two ever disagreed on its form,
    // every save would be refused and the record would silently stop. So on a refused overwrite, read again: an unchanged ETag means nobody
    // else wrote and the refusal was spurious, so log it loudly and save without the condition (the read just succeeded, so this never
    // writes over a record it couldn't read). A real overlap changes the ETag and stays refused.
    if (read.state === "ok") {
      const again = await getBlob(path, { access: "private", useCache: false }).catch(() => undefined);
      if (again && again.statusCode === 200 && again.blob.etag === read.etag) {
        await again.stream?.cancel().catch(() => {});
        log(tag, "etag-mismatch", e);
        try {
          await putJson(path, value, { allowOverwrite: true });
          return "saved";
        } catch (e2) {
          log(tag, "save-failed", e2);
          return "failed";
        }
      }
      await again?.stream?.cancel().catch(() => {});
    }
    log(tag, "save-conflict", e);
    return "conflict";
  }
}
