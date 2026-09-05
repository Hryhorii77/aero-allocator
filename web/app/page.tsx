"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ConnectButton, VotePanel } from "./wallet";
import { DISPLAY_PRESET, SIBLING_PRESET } from "@/lib/protocol";

const SIBLING_URL = process.env.NEXT_PUBLIC_SIBLING_URL;

interface PoolRow {
  lp: string;
  symbol: string;
  poolType: string;
  tvlUsd: number;
  predictedFeesUsd: number;
  lastEpochFeesUsd: number;
  feeTrendUsdPerEpoch: number;
  currentBribesUsd: number;
  voteSharePct: number;
  demandSharePct: number;
  edgePct: number;
  rewardPer1kVotesUsd: number;
  confidence: number;
}

type PoolSortKey = "predictedFeesUsd" | "lastEpochFeesUsd" | "feeTrendUsdPerEpoch" | "edgePct" | "rewardPer1kVotesUsd" | "confidence";
type LpSortKey = "stakedTvlUsd" | "currentEpochAprPct" | "predictedNextEpochAprPct" | "emissionsTrendUsdPerEpoch" | "confidence";

const POOL_SORT_KEYS: PoolSortKey[] = [
  "predictedFeesUsd",
  "lastEpochFeesUsd",
  "feeTrendUsdPerEpoch",
  "edgePct",
  "rewardPer1kVotesUsd",
  "confidence",
];
const LP_SORT_KEYS: LpSortKey[] = [
  "stakedTvlUsd",
  "currentEpochAprPct",
  "predictedNextEpochAprPct",
  "emissionsTrendUsdPerEpoch",
  "confidence",
];

interface Snapshot {
  generatedAt: number;
  epochStart: number;
  epochProgressPct: number;
  pools: PoolRow[];
}

interface AllocationRow {
  pool: string;
  symbol: string;
  weightPct: number;
  currentVoteSharePct: number;
  predictedDemandSharePct: number;
  predictiveEdgePct: number;
  tvlUsd: number;
  currentVotes: number;
  votesAllocated?: number;
  expectedRewardUsd?: number;
  confidence: number;
}

interface Allocation {
  objective: string;
  summary: string;
  votingPowerVe?: number;
  allocations: AllocationRow[];
}

interface LpOpportunity {
  pool: string;
  symbol: string;
  poolType: string;
  stakedTvlUsd: number;
  currentEpochAprPct: number;
  predictedNextEpochAprPct: number;
  emissionsTrendUsdPerEpoch: number;
  confidence: number;
}

interface LpDepositReport {
  rewardTokenSymbol: string;
  opportunities: LpOpportunity[];
}

interface VoteSwingSignal {
  pool: string;
  symbol: string;
  currentBribesUsd: number;
  bribeSpikeRatio: number | null;
  voteSwingPct: number;
  rationale: string;
}

interface VoteSwingReport {
  epochProgressPct: number;
  risers: VoteSwingSignal[];
  fallers: VoteSwingSignal[];
}

interface BribeSimResult {
  pool: string;
  symbol: string;
  bribeBudgetUsd: number;
  baselineVoteSharePct: number;
  projectedVoteSharePct: number;
  voteShareGainPct: number;
  usdPer1kIncrementalVotes: number | null;
  diluted: Array<{ pool: string; symbol: string; voteLoss: number }>;
  assumptions: string;
}

interface TrackRecord {
  epochsWindow: number;
  poolsAnalyzed: number;
  samplePoints: number;
  overall: {
    maeUsd: number;
    wapePct: number;
    directionalAccuracyPct: number;
    skillVsBaselineWapePct: number;
  };
  byConfidence: Array<{ range: string; n: number; wapePct: number }>;
  methodology: string;
}

export const usd = (n: number) =>
  n >= 1000 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// Split from downloadCsv so the string-building (header order, quoting of
// values containing commas/quotes/newlines) has a direct unit test —
// downloadCsv itself is just DOM/Blob plumbing around this.
export function toCsv(rows: Array<Record<string, string | number>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
}

function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) return;
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportAllocationCsv(objective: string, allocations: AllocationRow[]) {
  downloadCsv(
    `aero-allocator-${objective}-${new Date().toISOString().slice(0, 10)}.csv`,
    allocations.map((a) => ({
      pool: a.pool,
      symbol: a.symbol,
      weightPct: a.weightPct,
      currentVoteSharePct: a.currentVoteSharePct,
      predictedDemandSharePct: a.predictedDemandSharePct,
      predictiveEdgePct: a.predictiveEdgePct,
      expectedRewardUsd: a.expectedRewardUsd ?? "",
      confidence: a.confidence,
    })),
  );
}

function ExportCsvButton({ objective, allocations }: { objective: string; allocations: AllocationRow[] }) {
  return (
    <button
      onClick={() => exportAllocationCsv(objective, allocations)}
      className="rounded-lg border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:border-neutral-500 hover:text-white"
    >
      export CSV
    </button>
  );
}

function EdgeBadge({ edge }: { edge: number }) {
  const positive = edge > 0.05;
  const negative = edge < -0.05;
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 font-mono text-xs ${
        positive
          ? "bg-emerald-950 text-emerald-400"
          : negative
            ? "bg-rose-950 text-rose-400"
            : "bg-neutral-800 text-neutral-400"
      }`}
    >
      {edge > 0 ? "+" : ""}
      {edge.toFixed(2)}pp
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  // The bar alone doesn't discriminate well: live confidence tends to
  // cluster tightly (e.g. most pools sit around 0.75-0.80), so a handful of
  // percentage points of bar-width difference is sub-pixel at this size —
  // the number is what actually communicates the difference.
  return (
    <div className="flex items-center gap-1.5" title={`confidence ${value}`}>
      <div className="h-1.5 w-8 shrink-0 rounded bg-neutral-800">
        <div
          className={`h-full rounded ${value >= 0.6 ? "bg-sky-500" : value >= 0.4 ? "bg-sky-700" : "bg-neutral-600"}`}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="font-mono text-xs text-neutral-400">{Math.round(value * 100)}%</span>
    </div>
  );
}

const WEEK_SECONDS = 7 * 24 * 60 * 60;

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "epoch just flipped";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / (24 * 60));
  const h = Math.floor((totalMin % (24 * 60)) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function EpochCountdown({ epochStart }: { epochStart: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const nextFlipMs = (epochStart + WEEK_SECONDS) * 1000;
  const remainingMs = nextFlipMs - now;
  const hoursLeft = remainingMs / (60 * 60 * 1000);
  const urgent = hoursLeft <= 6;
  const soon = hoursLeft <= 24;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${
        urgent
          ? "animate-pulse border-rose-800 bg-rose-950/40"
          : soon
            ? "border-amber-800 bg-amber-950/30"
            : "border-neutral-800 bg-neutral-900/40"
      }`}
      title={`Next epoch flips ${new Date(nextFlipMs).toUTCString()}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          urgent ? "bg-rose-400" : soon ? "bg-amber-400" : "bg-neutral-500"
        }`}
      />
      <span
        className={`font-mono text-xs ${
          urgent ? "text-rose-300" : soon ? "text-amber-300" : "text-neutral-400"
        }`}
      >
        votes flip in {formatCountdown(remainingMs)}
      </span>
    </div>
  );
}

function WeightBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2 flex-1 rounded bg-neutral-800">
      <div className={`h-full rounded ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  title,
}: {
  label: string;
  sortKey: K;
  sort: { key: K; dir: "asc" | "desc" };
  onSort: (key: K) => void;
  title?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className="px-4 py-2.5 text-right" title={title}>
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-neutral-300 ${active ? "text-neutral-200" : ""}`}
      >
        {label}
        <span className="w-2.5 text-[10px]">{active ? (sort.dir === "desc" ? "▼" : "▲") : ""}</span>
      </button>
    </th>
  );
}

function AllocationRows({
  allocations,
  color,
  right,
}: {
  allocations: AllocationRow[];
  color: string;
  right: (a: AllocationRow) => ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      {allocations.map((a) => {
        // votesAllocated is only set for voter_roi — the pool's implied
        // "your vote as % of this gauge" only means something once you're
        // sizing an absolute vote count against the gauge's existing votes,
        // which is exactly the split Grok flagged as invisible: two rows
        // with identical weightPct can be a huge or a tiny gauge underneath.
        const gaugeSharePct =
          a.votesAllocated !== undefined && a.currentVotes + a.votesAllocated > 0
            ? (a.votesAllocated / (a.currentVotes + a.votesAllocated)) * 100
            : undefined;
        return (
          <div key={a.pool}>
            <div className="flex items-center gap-3">
              <span className="w-40 truncate text-sm text-neutral-200" title={a.symbol}>
                {a.symbol}
              </span>
              <WeightBar pct={a.weightPct} color={color} />
              <span className="w-14 text-right font-mono text-sm text-neutral-100">{a.weightPct.toFixed(1)}%</span>
              {right(a)}
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-600">
              {usd(a.tvlUsd)} TVL · {Math.round(a.currentVotes).toLocaleString("en-US")} votes now
              {gaugeSharePct !== undefined && ` · your vote ≈ ${gaugeSharePct.toFixed(1)}% of this gauge`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [voterAlloc, setVoterAlloc] = useState<Allocation | null>(null);
  const [protoAlloc, setProtoAlloc] = useState<Allocation | null>(null);
  const [edgeAlloc, setEdgeAlloc] = useState<Allocation | null>(null);
  const [lpDeposits, setLpDeposits] = useState<LpDepositReport | null>(null);
  const [voteSwings, setVoteSwings] = useState<VoteSwingReport | null>(null);
  const [trackRecord, setTrackRecord] = useState<TrackRecord | null>(null);
  // Read from the URL (if shared) so loadAll's very first fetch already
  // uses the right value — the alternative (fetch once with the default,
  // then again with the URL's value once an effect runs) is a real race:
  // whichever of the two responses lands last wins. Safe to read
  // window here — this state never renders anything until `snapshot` is
  // set (client-only), so there's nothing for SSR/hydration to mismatch.
  const [votingPower, setVotingPower] = useState(() => {
    if (typeof window === "undefined") return 10000;
    const vp = Number(new URLSearchParams(window.location.search).get("vp"));
    return vp > 0 ? vp : 10000;
  });
  const [loading, setLoading] = useState(true);
  const [allocLoading, setAllocLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bribePool, setBribePool] = useState("");
  const [bribeBudget, setBribeBudget] = useState(5000);
  const [bribeResult, setBribeResult] = useState<BribeSimResult | null>(null);
  const [bribeLoading, setBribeLoading] = useState(false);
  const [bribeError, setBribeError] = useState<string | null>(null);
  const [poolSort, setPoolSort] = useState<{ key: PoolSortKey; dir: "asc" | "desc" }>({
    key: "predictedFeesUsd",
    dir: "desc",
  });
  const togglePoolSort = (key: PoolSortKey) =>
    setPoolSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  const [lpSort, setLpSort] = useState<{ key: LpSortKey; dir: "asc" | "desc" }>({
    key: "predictedNextEpochAprPct",
    dir: "desc",
  });
  const toggleLpSort = (key: LpSortKey) =>
    setLpSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  // Read sort choice from the URL once on mount, so a shared link (e.g.
  // "sorted by edge") opens showing the same view. votingPower's own
  // useState initializer above already handles the vp param — doing it
  // there instead of here means loadAll's one fetch uses the right value
  // from the start, rather than this needing a second, racing fetch.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sortKey = params.get("sort");
    if (sortKey && POOL_SORT_KEYS.includes(sortKey as PoolSortKey)) {
      setPoolSort({ key: sortKey as PoolSortKey, dir: params.get("dir") === "asc" ? "asc" : "desc" });
    }
    const lpSortKey = params.get("lpSort");
    if (lpSortKey && LP_SORT_KEYS.includes(lpSortKey as LpSortKey)) {
      setLpSort({ key: lpSortKey as LpSortKey, dir: params.get("lpDir") === "asc" ? "asc" : "desc" });
    }
  }, []);

  // Keep the URL in sync so the current view is always shareable.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("sort", poolSort.key);
    params.set("dir", poolSort.dir);
    params.set("lpSort", lpSort.key);
    params.set("lpDir", lpSort.dir);
    params.set("vp", String(votingPower));
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [poolSort, lpSort, votingPower]);

  const loadAll = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      // One route, one snapshot build server-side — each app/api/*/route.ts
      // is its own serverless function once deployed, so fetching this in
      // pieces would cost one independent cold snapshot build per route.
      const res = await fetch(`/api/dashboard?votingPower=${votingPower}${refresh ? "&refresh=1" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `dashboard: HTTP ${res.status}`);
      const snap: Snapshot = { generatedAt: data.generatedAt, epochStart: data.epochStart, epochProgressPct: data.epochProgressPct, pools: data.pools };
      setSnapshot(snap);
      setVoterAlloc(data.voterAlloc);
      setProtoAlloc(data.protoAlloc);
      setEdgeAlloc(data.edgeAlloc);
      setLpDeposits(data.lpDeposits);
      setVoteSwings(data.voteSwings);
      setTrackRecord(data.trackRecord);
      if (!bribePool && snap.pools.length > 0) setBribePool(snap.pools[0].lp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const recomputeVoterWithPower = async (vp: number) => {
    setAllocLoading(true);
    try {
      const res = await fetch(`/api/dashboard?votingPower=${vp}`);
      const data = await res.json();
      setVoterAlloc(data.voterAlloc);
    } finally {
      setAllocLoading(false);
    }
  };

  const recomputeVoter = () => recomputeVoterWithPower(votingPower);

  const simulateBribe = async () => {
    if (!bribePool || bribeBudget <= 0) return;
    setBribeLoading(true);
    setBribeError(null);
    try {
      const res = await fetch(`/api/bribe?pool=${bribePool}&bribeBudgetUsd=${bribeBudget}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setBribeResult(body);
    } catch (e) {
      setBribeError(e instanceof Error ? e.message : String(e));
      setBribeResult(null);
    } finally {
      setBribeLoading(false);
    }
  };

  const pools = [...(snapshot?.pools.filter((p) => p.predictedFeesUsd > 0) ?? [])]
    .sort((a, b) => (poolSort.dir === "desc" ? b[poolSort.key] - a[poolSort.key] : a[poolSort.key] - b[poolSort.key]))
    .slice(0, 20);

  const lpOpportunities = [...(lpDeposits?.opportunities ?? [])].sort((a, b) =>
    lpSort.dir === "desc" ? b[lpSort.key] - a[lpSort.key] : a[lpSort.key] - b[lpSort.key],
  );

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {DISPLAY_PRESET.displayName} <span className="text-sky-400">Allocator</span>
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            Next-epoch fee-demand forecast for {DISPLAY_PRESET.displayName} on {DISPLAY_PRESET.networkName} —
            reward where demand is going, not where it was.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {SIBLING_URL && (
            <a
              href={SIBLING_URL}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-400 hover:border-neutral-500 hover:text-white"
            >
              switch to {SIBLING_PRESET.displayName}
            </a>
          )}
          {snapshot && <EpochCountdown epochStart={snapshot.epochStart} />}
          {snapshot && (
            <div className="text-right">
              <div className="mb-1 font-mono text-xs text-neutral-400">
                epoch {snapshot.epochProgressPct.toFixed(1)}% elapsed
              </div>
              <div className="h-1.5 w-40 rounded bg-neutral-800">
                <div
                  className="h-full rounded bg-sky-500"
                  style={{ width: `${snapshot.epochProgressPct}%` }}
                />
              </div>
            </div>
          )}
          <button
            onClick={() => loadAll(true)}
            disabled={loading}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500 hover:text-white disabled:opacity-40"
          >
            {loading ? "loading…" : "refresh"}
          </button>
          <ConnectButton />
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading && !snapshot && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-6 py-16 text-center">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-sky-400" />
          <p className="text-sm text-neutral-400">
            Building live snapshot from {DISPLAY_PRESET.networkName} — scanning all pools and 8 epochs of history.
          </p>
          <p className="mt-1 text-xs text-neutral-500">Cold start takes about a minute; then it&apos;s cached.</p>
        </div>
      )}

      {snapshot && (
        <>
          <section className="mb-10">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-400">
              Predicted hot pools
            </h2>
            <div className="overflow-x-auto rounded-xl border border-neutral-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 bg-neutral-900/60 text-left font-mono text-xs text-neutral-500">
                    <th className="px-4 py-2.5">pool</th>
                    <SortHeader label="predicted fees" sortKey="predictedFeesUsd" sort={poolSort} onSort={togglePoolSort} />
                    <SortHeader label="last epoch" sortKey="lastEpochFeesUsd" sort={poolSort} onSort={togglePoolSort} />
                    <SortHeader
                      label="trend/epoch"
                      sortKey="feeTrendUsdPerEpoch"
                      sort={poolSort}
                      onSort={togglePoolSort}
                      title="Slope of a linear regression over trailing epochs, USD per epoch — not simply predicted minus last epoch, so it can point a different direction than that single-epoch comparison."
                    />
                    <th className="px-4 py-2.5 text-right">votes vs demand</th>
                    <SortHeader label="edge" sortKey="edgePct" sort={poolSort} onSort={togglePoolSort} />
                    <SortHeader label="$/1k votes" sortKey="rewardPer1kVotesUsd" sort={poolSort} onSort={togglePoolSort} />
                    <SortHeader label="conf" sortKey="confidence" sort={poolSort} onSort={togglePoolSort} />
                  </tr>
                </thead>
                <tbody>
                  {pools.map((p) => (
                    <tr key={p.lp} className="border-b border-neutral-800/60 last:border-0 hover:bg-neutral-900/40">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-neutral-100">{p.symbol}</span>
                        <span className="ml-2 font-mono text-xs text-neutral-500">{p.poolType}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-neutral-100">{usd(p.predictedFeesUsd)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-neutral-400">{usd(p.lastEpochFeesUsd)}</td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono ${
                          p.feeTrendUsdPerEpoch > 0
                            ? "text-emerald-400"
                            : p.feeTrendUsdPerEpoch < 0
                              ? "text-rose-400"
                              : "text-neutral-500"
                        }`}
                      >
                        {p.feeTrendUsdPerEpoch > 0 ? "▲" : p.feeTrendUsdPerEpoch < 0 ? "▼" : "–"}{" "}
                        {usd(Math.abs(p.feeTrendUsdPerEpoch))}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-neutral-300">
                        {p.voteSharePct.toFixed(1)}% → {p.demandSharePct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <EdgeBadge edge={p.edgePct} />
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-neutral-300">
                        <span
                          title={
                            p.voteSharePct < 0.1
                              ? "Current vote share is near zero — this $/1k figure is based on very few votes and can swing wildly the moment anyone votes here. Not a reliable signal on its own."
                              : undefined
                          }
                        >
                          ${p.rewardPer1kVotesUsd.toFixed(2)}
                          {p.voteSharePct < 0.1 && <span className="ml-1 text-amber-500">⚠</span>}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <ConfidenceBar value={p.confidence} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              Edge = predicted fee-demand share − current vote share. Positive edge means the pool is
              under-incentivized relative to where trading demand is heading. Click a column header to sort —
              top 20 pools by that column, not just a reorder of the top 20 by fees.
            </p>
          </section>

          <section className="mb-10 grid gap-6 lg:grid-cols-3">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-medium text-white">
                  Voter ROI <span className="text-xs font-normal text-neutral-500">dilution-aware split</span>
                </h3>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={votingPower}
                    onChange={(e) => setVotingPower(Number(e.target.value))}
                    className="w-24 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-right font-mono text-sm text-neutral-200 focus:border-sky-600 focus:outline-none"
                  />
                  <span className="text-xs text-neutral-500">{DISPLAY_PRESET.veTokenSymbol}</span>
                  <button
                    onClick={recomputeVoter}
                    disabled={allocLoading}
                    className="rounded-lg bg-sky-600 px-3 py-1 text-sm text-white hover:bg-sky-500 disabled:opacity-40"
                  >
                    {allocLoading ? "…" : "recompute"}
                  </button>
                  {voterAlloc && <ExportCsvButton objective="voter_roi" allocations={voterAlloc.allocations} />}
                </div>
              </div>
              {voterAlloc && (
                <>
                  <AllocationRows
                    allocations={voterAlloc.allocations}
                    color="bg-sky-500"
                    right={(a) => (
                      <span className="w-20 text-right font-mono text-xs text-emerald-400">
                        {a.expectedRewardUsd !== undefined ? `+${usd(a.expectedRewardUsd)}` : ""}
                      </span>
                    )}
                  />
                  <p className="mt-4 border-t border-neutral-800 pt-3 text-xs leading-relaxed text-neutral-400">
                    {voterAlloc.summary}
                  </p>
                  <VotePanel
                    allocations={voterAlloc.allocations}
                    onNftSelected={(vp) => {
                      setVotingPower(vp);
                      recomputeVoterWithPower(vp);
                    }}
                  />
                </>
              )}
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-medium text-white">
                  Protocol efficiency{" "}
                  <span className="text-xs font-normal text-neutral-500">allocate ∝ demand</span>
                </h3>
                {protoAlloc && <ExportCsvButton objective="protocol_efficiency" allocations={protoAlloc.allocations} />}
              </div>
              {protoAlloc && (
                <>
                  <AllocationRows
                    allocations={protoAlloc.allocations}
                    color="bg-violet-500"
                    right={(a) => (
                      <span className="w-20 text-right font-mono text-xs text-neutral-500">
                        now {a.currentVoteSharePct.toFixed(1)}%
                      </span>
                    )}
                  />
                  <p className="mt-4 border-t border-neutral-800 pt-3 text-xs leading-relaxed text-neutral-400">
                    {protoAlloc.summary}
                  </p>
                </>
              )}
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-medium text-white">
                  Edge hunter{" "}
                  <span className="text-xs font-normal text-neutral-500">biggest trustworthy mispricings</span>
                </h3>
                {edgeAlloc && edgeAlloc.allocations.length > 0 && (
                  <ExportCsvButton objective="edge_hunter" allocations={edgeAlloc.allocations} />
                )}
              </div>
              {edgeAlloc && edgeAlloc.allocations.length > 0 ? (
                <>
                  <AllocationRows
                    allocations={edgeAlloc.allocations}
                    color="bg-amber-500"
                    right={(a) => <EdgeBadge edge={a.predictiveEdgePct} />}
                  />
                  <p className="mt-4 border-t border-neutral-800 pt-3 text-xs leading-relaxed text-neutral-400">
                    {edgeAlloc.summary}
                  </p>
                </>
              ) : (
                <p className="text-sm text-neutral-500">No positive-edge pools right now.</p>
              )}
            </div>
          </section>

          <section className="mb-10">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-400">
              LP staking yield {lpDeposits && <span className="text-neutral-600">({lpDeposits.rewardTokenSymbol} emissions, not fees)</span>}
            </h2>
            <div className="overflow-x-auto rounded-xl border border-neutral-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 bg-neutral-900/60 text-left font-mono text-xs text-neutral-500">
                    <th className="px-4 py-2.5">pool</th>
                    <SortHeader label="staked TVL" sortKey="stakedTvlUsd" sort={lpSort} onSort={toggleLpSort} />
                    <SortHeader label="current APR" sortKey="currentEpochAprPct" sort={lpSort} onSort={toggleLpSort} />
                    <SortHeader
                      label="predicted APR"
                      sortKey="predictedNextEpochAprPct"
                      sort={lpSort}
                      onSort={toggleLpSort}
                    />
                    <SortHeader
                      label="trend/epoch"
                      sortKey="emissionsTrendUsdPerEpoch"
                      sort={lpSort}
                      onSort={toggleLpSort}
                      title="Slope of a linear regression over trailing epochs, USD per epoch — not simply predicted minus last epoch, so it can point a different direction than that single-epoch comparison."
                    />
                    <SortHeader label="conf" sortKey="confidence" sort={lpSort} onSort={toggleLpSort} />
                  </tr>
                </thead>
                <tbody>
                  {lpOpportunities.map((o) => (
                    <tr key={o.pool} className="border-b border-neutral-800/60 last:border-0 hover:bg-neutral-900/40">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-neutral-100">{o.symbol}</span>
                        <span className="ml-2 font-mono text-xs text-neutral-500">{o.poolType}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-neutral-400">{usd(o.stakedTvlUsd)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-neutral-300">
                        {o.currentEpochAprPct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-emerald-400">
                        {o.predictedNextEpochAprPct.toFixed(1)}%
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono ${
                          o.emissionsTrendUsdPerEpoch > 0
                            ? "text-emerald-400"
                            : o.emissionsTrendUsdPerEpoch < 0
                              ? "text-rose-400"
                              : "text-neutral-500"
                        }`}
                      >
                        {o.emissionsTrendUsdPerEpoch > 0 ? "▲" : o.emissionsTrendUsdPerEpoch < 0 ? "▼" : "–"}{" "}
                        {usd(Math.abs(o.emissionsTrendUsdPerEpoch))}
                      </td>
                      <td className="px-4 py-2.5">
                        <ConfidenceBar value={o.confidence} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              For LPs staking liquidity — ranked by forecast {DISPLAY_PRESET.tokenSymbol}-emissions APR, not
              trading fees (those accrue to {DISPLAY_PRESET.veTokenSymbol} voters, not stakers).
            </p>
          </section>

          <section className="mb-10 grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <h3 className="mb-4 font-medium text-white">
                Vote swings <span className="text-xs font-normal text-neutral-500">risers</span>
              </h3>
              <div className="space-y-3">
                {voteSwings && voteSwings.risers.length > 0 ? (
                  voteSwings.risers.map((s) => (
                    <div key={s.pool} className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-neutral-100">{s.symbol}</span>
                        <span className="font-mono text-xs text-emerald-400">
                          {s.bribeSpikeRatio !== null ? `${s.bribeSpikeRatio}x pace` : "new bribe"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-neutral-500">{s.rationale}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-neutral-500">No bribe pace anomalies right now.</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <h3 className="mb-4 font-medium text-white">
                Vote swings <span className="text-xs font-normal text-neutral-500">fallers</span>
              </h3>
              <div className="space-y-3">
                {voteSwings && voteSwings.fallers.length > 0 ? (
                  voteSwings.fallers.map((s) => (
                    <div key={s.pool} className="rounded-lg border border-rose-900/60 bg-rose-950/20 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-neutral-100">{s.symbol}</span>
                        <span className="font-mono text-xs text-rose-400">{s.voteSwingPct.toFixed(1)}%</span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-neutral-500">{s.rationale}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-neutral-500">No pools running behind their normal vote pace.</p>
                )}
              </div>
            </div>
          </section>

          <section className="mb-10">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-400">Bribe placement</h2>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs text-neutral-500">target pool</label>
                  <select
                    value={bribePool}
                    onChange={(e) => setBribePool(e.target.value)}
                    className="w-56 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-sm text-neutral-200 focus:border-sky-600 focus:outline-none"
                  >
                    {pools.map((p) => (
                      <option key={p.lp} value={p.lp}>
                        {p.symbol}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-neutral-500">bribe budget (USD)</label>
                  <input
                    type="number"
                    min={1}
                    value={bribeBudget}
                    onChange={(e) => setBribeBudget(Number(e.target.value))}
                    className="w-32 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-right font-mono text-sm text-neutral-200 focus:border-sky-600 focus:outline-none"
                  />
                </div>
                <button
                  onClick={simulateBribe}
                  disabled={bribeLoading || !bribePool}
                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-40"
                >
                  {bribeLoading ? "simulating…" : "simulate"}
                </button>
              </div>

              {bribeError && <p className="mt-3 text-sm text-rose-400">{bribeError}</p>}

              {bribeResult && (
                <div className="mt-4 border-t border-neutral-800 pt-4">
                  <div className="flex flex-wrap gap-6">
                    <div>
                      <div className="font-mono text-xs text-neutral-500">vote share</div>
                      <div className="font-mono text-sm text-neutral-100">
                        {bribeResult.baselineVoteSharePct.toFixed(2)}% → {bribeResult.projectedVoteSharePct.toFixed(2)}%{" "}
                        <span className="text-emerald-400">(+{bribeResult.voteShareGainPct.toFixed(2)}pp)</span>
                      </div>
                    </div>
                    <div>
                      <div className="font-mono text-xs text-neutral-500">$ / 1k incremental votes</div>
                      <div className="font-mono text-sm text-neutral-100">
                        {bribeResult.usdPer1kIncrementalVotes !== null ? `$${bribeResult.usdPer1kIncrementalVotes.toFixed(2)}` : "n/a"}
                      </div>
                    </div>
                  </div>
                  {bribeResult.diluted.length > 0 && (
                    <div className="mt-3">
                      <div className="mb-1 font-mono text-xs text-neutral-500">most diluted</div>
                      <div className="flex flex-wrap gap-2">
                        {bribeResult.diluted.map((d) => (
                          <span key={d.pool} className="rounded bg-neutral-800 px-2 py-1 font-mono text-xs text-neutral-300">
                            {d.symbol} −{Math.round(d.voteLoss).toLocaleString()}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="mt-3 text-xs leading-relaxed text-neutral-500">{bribeResult.assumptions}</p>
                </div>
              )}
            </div>
          </section>

          {trackRecord && (
            <section className="mb-10">
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-400">
                Forecast accuracy <span className="text-neutral-600">(walk-forward backtest)</span>
              </h2>
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
                <div className="flex flex-wrap gap-6">
                  <div>
                    <div className="font-mono text-xs text-neutral-500">error (WAPE)</div>
                    <div className="font-mono text-sm text-neutral-100">{trackRecord.overall.wapePct.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="font-mono text-xs text-neutral-500">directional accuracy</div>
                    <div className="font-mono text-sm text-neutral-100">
                      {trackRecord.overall.directionalAccuracyPct.toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-xs text-neutral-500">skill vs. naive baseline</div>
                    <div
                      className={`font-mono text-sm ${
                        trackRecord.overall.skillVsBaselineWapePct >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {trackRecord.overall.skillVsBaselineWapePct >= 0 ? "+" : ""}
                      {trackRecord.overall.skillVsBaselineWapePct.toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-xs text-neutral-500">sample</div>
                    <div className="font-mono text-sm text-neutral-100">
                      {trackRecord.samplePoints.toLocaleString()} pts · {trackRecord.poolsAnalyzed} pools ·{" "}
                      {trackRecord.epochsWindow} epochs
                    </div>
                  </div>
                </div>

                <div className="mt-4 border-t border-neutral-800 pt-4">
                  <div className="mb-2 font-mono text-xs text-neutral-500">accuracy by confidence bucket</div>
                  <div className="flex flex-wrap gap-3">
                    {trackRecord.byConfidence.map((b) => (
                      <div key={b.range} className="rounded bg-neutral-800/60 px-3 py-1.5">
                        <span className="font-mono text-xs text-neutral-400">conf {b.range}</span>{" "}
                        <span className="font-mono text-sm text-neutral-100">{b.wapePct.toFixed(1)}% WAPE</span>{" "}
                        <span className="font-mono text-xs text-neutral-600">(n={b.n})</span>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="mt-4 text-xs leading-relaxed text-neutral-500">{trackRecord.methodology}</p>
              </div>
            </section>
          )}

          <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-800 pt-4 text-xs text-neutral-500">
            <span>
              Live data: {DISPLAY_PRESET.displayName} Sugar contracts on {DISPLAY_PRESET.networkName} + DefiLlama
              prices · snapshot{" "}
              {new Date(snapshot.generatedAt).toLocaleTimeString()}
            </span>
            <a
              href="https://github.com/Hryhorii77/aero-allocator"
              target="_blank"
              rel="noreferrer"
              className="hover:text-neutral-300"
            >
              github.com/Hryhorii77/aero-allocator
            </a>
          </footer>
        </>
      )}
    </main>
  );
}
