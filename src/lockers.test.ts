import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLockers, normalizeVotes } from "./lockers.js";
import * as dataModule from "./data.js";

afterEach(() => vi.restoreAllMocks());

const v = (lp: string, weight: bigint) => ({ lp: lp as `0x${string}`, weight });

describe("normalizeVotes", () => {
  it("returns nothing for a lock that hasn't voted", () => {
    expect(normalizeVotes([])).toEqual([]);
  });

  it("converts relative weights into percentages of the lock's own total", () => {
    // veSugar's LpVotes.weight is relative (the same convention Voter.vote()
    // uses), not a 0-100 or 0-10000 scale — the raw numbers here sum to 400,
    // which must come out as 25/75, not 100/300.
    expect(normalizeVotes([v("0xa", 100n), v("0xb", 300n)])).toEqual([
      { pool: "0xa", weightPct: 25 },
      { pool: "0xb", weightPct: 75 },
    ]);
  });

  it("survives raw weights far beyond Number.MAX_SAFE_INTEGER", () => {
    // Real veNFT weights are 18-decimal token amounts — a 2M veAERO lock's
    // weight is ~2e24, which loses precision the moment it touches a JS
    // number. Staying in BigInt until the final divide is the whole point.
    const huge = 2_000_000n * 10n ** 18n;
    expect(normalizeVotes([v("0xa", huge), v("0xb", huge)])).toEqual([
      { pool: "0xa", weightPct: 50 },
      { pool: "0xb", weightPct: 50 },
    ]);
  });

  it("keeps two decimal places of precision, matching the dashboard's conversion", () => {
    // 1/3 each → 33.33, the same figure web/app/wallet.tsx produces. If these
    // two ever diverge, the sweep and the connected dashboard would report
    // different current splits for the same lock.
    const r = normalizeVotes([v("0xa", 1n), v("0xb", 1n), v("0xc", 1n)]);
    expect(r.map((x) => x.weightPct)).toEqual([33.33, 33.33, 33.33]);
  });

  it("does not divide by zero when every weight is zero", () => {
    expect(normalizeVotes([v("0xa", 0n), v("0xb", 0n)])).toEqual([]);
  });
});

// A stand-in for veSugar.all(limit, offset) with the two behaviours that
// broke the first sweep: `limit` counts RESULTS (so pages span more ids than
// they return when ids are missing), and dense pages revert.
function fakeVeSugar(opts: { existingIds: number[]; revertAtOrAbove?: number }) {
  const { existingIds, revertAtOrAbove = Infinity } = opts;
  const calls: Array<{ limit: number; offset: number }> = [];
  const readContract = async ({ functionName, args }: { functionName: string; args: readonly bigint[] }) => {
    if (functionName === "ve") return "0xve";
    if (functionName === "tokenId") return BigInt(Math.max(...existingIds));
    const [limit, offset] = [Number(args[0]), Number(args[1])];
    calls.push({ limit, offset });
    if (limit >= revertAtOrAbove) throw new Error("execution reverted");
    return existingIds
      .filter((id) => id >= offset)
      .slice(0, limit)
      .map((id) => ({
        id: BigInt(id),
        account: `0xacct${id}` as `0x${string}`,
        decimals: 18,
        amount: 10n ** 18n,
        voting_amount: 10n ** 24n, // 1,000,000 ve — comfortably over any threshold
        expires_at: 0n,
        voted_at: 0n,
        votes: [],
        permanent: true,
      }));
  };
  return { client: { readContract }, calls };
}

describe("fetchLockers", () => {
  it("never returns the same lock twice when pages overlap", async () => {
    // The overlap is unavoidable, so the dedup has to be real. Ids here are
    // sparse (every 3rd exists, as burned locks leave holes), so the page
    // starting at id 1 returns 50 results reaching id ~148 — far past where
    // the next offset (51) begins, and the two pages then return many of the
    // same locks. Appending instead of keying by tokenId would report those
    // whales several times each and inflate the market size, which is the one
    // direction of error this sweep exists to avoid.
    const sparse = Array.from({ length: 100 }, (_, i) => i * 3 + 1);
    const { client } = fakeVeSugar({ existingIds: sparse });
    vi.spyOn(dataModule, "getClient").mockReturnValue(client as never);

    const scan = await fetchLockers({ minVotingPower: 1, maxTokenId: 300, concurrency: 1 });

    const ids = scan.lockers.map((l) => l.tokenId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.map(Number).sort((a, b) => a - b)).toEqual(sparse);
  });

  it("covers every lock even though pages are stepped by result count, not id span", async () => {
    const ids = Array.from({ length: 137 }, (_, i) => (i + 1) * 3); // every 3rd id exists
    const { client } = fakeVeSugar({ existingIds: ids });
    vi.spyOn(dataModule, "getClient").mockReturnValue(client as never);

    const scan = await fetchLockers({ minVotingPower: 1, maxTokenId: 411, concurrency: 3 });

    expect(scan.lockers).toHaveLength(ids.length);
  });

  it("splits a reverting page instead of dropping it", async () => {
    // Dense ranges blow the eth_call gas budget at the full page size. Backing
    // off and retrying the identical call just fails again; halving succeeds.
    const ids = Array.from({ length: 60 }, (_, i) => i + 1);
    const { client, calls } = fakeVeSugar({ existingIds: ids, revertAtOrAbove: 50 });
    vi.spyOn(dataModule, "getClient").mockReturnValue(client as never);

    const scan = await fetchLockers({ minVotingPower: 1, maxTokenId: 60, concurrency: 1 });

    expect(scan.failedOffsets).toEqual([]);
    expect(scan.lockers).toHaveLength(60);
    expect(calls.some((c) => c.limit < 50)).toBe(true);
  });

  it("splits a reverting page immediately, without sleeping through a backoff first", async () => {
    // The fix that took a full sweep from ~2.5h to minutes: a revert means
    // the page is over the node's gas budget, so re-issuing it unchanged can
    // only fail again. Dense ranges revert on nearly every page, so paying
    // withRetry's 1s + 2s before each split dominated the whole run.
    const ids = Array.from({ length: 60 }, (_, i) => i + 1);
    const { client } = fakeVeSugar({ existingIds: ids, revertAtOrAbove: 50 });
    vi.spyOn(dataModule, "getClient").mockReturnValue(client as never);

    const started = Date.now();
    const scan = await fetchLockers({ minVotingPower: 1, maxTokenId: 60, concurrency: 1 });

    expect(scan.lockers).toHaveLength(60);
    // Comfortably under even a single 1s backoff, let alone one per page.
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("still backs off and retries when the failure is transient rather than a revert", async () => {
    // The inverse case: a dropped connection at the same page size is worth
    // waiting out, because the identical call may well succeed next time.
    const ids = Array.from({ length: 10 }, (_, i) => i + 1);
    let failuresLeft = 1;
    const readContract = async ({ functionName, args }: { functionName: string; args: readonly bigint[] }) => {
      if (functionName === "ve") return "0xve";
      if (functionName === "tokenId") return 10n;
      if (failuresLeft-- > 0) throw new Error("socket hang up");
      return ids.slice(0, Number(args[0])).map((id) => ({
        id: BigInt(id),
        account: "0xacct" as `0x${string}`,
        decimals: 18,
        amount: 10n ** 18n,
        voting_amount: 10n ** 24n,
        expires_at: 0n,
        voted_at: 0n,
        votes: [],
        permanent: true,
      }));
    };
    vi.spyOn(dataModule, "getClient").mockReturnValue({ readContract } as never);

    const scan = await fetchLockers({ minVotingPower: 1, maxTokenId: 10, concurrency: 1 });

    // Recovered at the original page size — never had to shrink.
    expect(scan.lockers).toHaveLength(10);
    expect(scan.failedOffsets).toEqual([]);
  }, 20_000);

  it("excludes locks below the voting-power threshold", async () => {
    const { client } = fakeVeSugar({ existingIds: [1, 2, 3] });
    vi.spyOn(dataModule, "getClient").mockReturnValue(client as never);

    // Each fake lock is 1,000,000 ve; nothing clears a 2,000,000 bar.
    const scan = await fetchLockers({ minVotingPower: 2_000_000, maxTokenId: 3, concurrency: 1 });

    expect(scan.lockers).toEqual([]);
  });

  it("returns the biggest locks first", async () => {
    const { client } = fakeVeSugar({ existingIds: [1, 2, 3] });
    vi.spyOn(dataModule, "getClient").mockReturnValue(client as never);

    const scan = await fetchLockers({ minVotingPower: 1, maxTokenId: 3, concurrency: 1 });

    const powers = scan.lockers.map((l) => l.votingPower);
    expect(powers).toEqual([...powers].sort((a, b) => b - a));
  });
});
