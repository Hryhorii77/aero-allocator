"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { ConnectButton, VotePanel, type CurrentVote } from "./wallet";
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

/** Dromos Labs' Predictive Allocation (real-time incentive allocation,
 * dated September 2026) is meant to replace weekly gauge voting for
 * Aerodrome. `live` is computed server-side from the same adapter the MCP
 * server's predictive_allocation_status tool reports — it flips true purely
 * from env vars once contracts are published, no code change here. */
interface PaStatus {
  applicable: boolean;
  live: boolean;
}

// The dashboard's snapshot build is a cold RPC scan (up to ~1min) whenever
// the server-side cache (lib/snapshot.ts) is cold — a new deploy, or just
// the cache TTL lapsing between visits. Persisting the last successful
// payload client-side means a returning visitor sees last epoch's numbers
// immediately (marked stale, with a timestamp) instead of the same blocking
// spinner every time (Grok round 4: "cold start is the first thing I see").
const DASHBOARD_CACHE_KEY = "aero-allocator:dashboard-cache:v1";

interface DashboardCachePayload {
  generatedAt: number;
  epochStart: number;
  epochProgressPct: number;
  pools: PoolRow[];
  voterAlloc: Allocation;
  protoAlloc: Allocation;
  edgeAlloc: Allocation;
  lpDeposits: LpDepositReport;
  voteSwings: VoteSwingReport;
  trackRecord: TrackRecord | null;
  paStatus: PaStatus;
}

function readDashboardCache(): { cachedAt: number; data: DashboardCachePayload } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DASHBOARD_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeDashboardCache(data: DashboardCachePayload) {
  try {
    window.localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), data }));
  } catch {
    // Quota/private-browsing failures are fine to swallow — this cache is a
    // cold-start UX nicety, not required for the page to work correctly.
  }
}

// This page is SSR'd (Next.js still renders "use client" components on the
// server for the initial HTML), so hydrating cached-snapshot state directly
// into useState's initializer would render a populated table on the client
// against server HTML that always rendered the cold-start spinner (window
// is undefined server-side) — a real hydration mismatch, not a cosmetic
// one, that made React discard and re-render the whole tree. Reading the
// cache in a layout effect instead means the first client render still
// matches the server's spinner exactly, and the swap to cached data happens
// synchronously before the browser paints, so there's no visible flash.
// useLayoutEffect logs a (harmless) warning if run on the server itself, so
// fall back to useEffect there — it's a no-op during SSR either way.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function formatAgo(ms: number): string {
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export const usd = (n: number) =>
  n >= 1000 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Deep link to this protocol's own app for a specific pool — confirmed live
 * that both /vote and /liquidity pre-filter to exactly one pool when given
 * `?query=<pool address>`. */
function poolAppLink(page: "vote" | "liquidity", poolAddress: string): string {
  return `${DISPLAY_PRESET.appUrl}/${page}?query=${poolAddress}`;
}

const CONFIDENCE_CLUSTER_THRESHOLD = 0.03;

/** True when every value in the currently-visible set sits within a few
 * points of each other — at that point a column of individual bar widths
 * can't discriminate anything the number itself doesn't already say. */
export function isConfidenceClustered(values: number[]): boolean {
  if (values.length < 3) return false;
  return Math.max(...values) - Math.min(...values) < CONFIDENCE_CLUSTER_THRESHOLD;
}

// Quick category chips over the pools table (Grok's plan: "tokenized
// stocks, stables, AERO pairs, new listings are mixed in one dump").
// Deliberately just symbol substring matches, not a rigorous token
// classification — "tokenized stocks" specifically has no reliable naming
// convention to detect here, so it's left out rather than guessed at.
export type PoolFilterKey = "all" | "stables" | "aero" | "btc" | "new" | "positiveEdge" | "highConf";

const STABLE_TICKERS = ["USDC", "USDT", "DAI", "USDE", "MSUSD", "FRXUSD", "EURC"];

export function matchesPoolFilter(pool: { symbol: string; lastEpochFeesUsd: number; edgePct: number; confidence: number }, filter: PoolFilterKey, aeroTicker: string): boolean {
  const upperSymbol = pool.symbol.toUpperCase();
  switch (filter) {
    case "all":
      return true;
    case "stables":
      return STABLE_TICKERS.some((t) => upperSymbol.includes(t));
    case "aero":
      return upperSymbol.includes(aeroTicker.toUpperCase());
    case "btc":
      return upperSymbol.includes("BTC");
    case "new":
      return pool.lastEpochFeesUsd === 0;
    case "positiveEdge":
      return pool.edgePct > 0;
    case "highConf":
      return pool.confidence >= 0.6;
  }
}

const POOL_FILTER_CHIPS: Array<{ key: PoolFilterKey; label: string }> = [
  { key: "all", label: "all" },
  { key: "stables", label: "stables" },
  { key: "aero", label: `${DISPLAY_PRESET.tokenSymbol} pairs` },
  { key: "btc", label: "BTC" },
  { key: "new", label: "new this epoch" },
  { key: "positiveEdge", label: "positive edge" },
  { key: "highConf", label: "high conf" },
];

// Plain-language shipped-feature log, newest first — hand-curated from real
// commits (not every commit; internal refactors/test-only changes are left
// out) so users can see the dashboard is actively maintained without digging
// through GitHub history themselves.
const CHANGELOG: Array<{ date: string; title: string }> = [
  {
    date: "2026-09-13",
    title: "Search box + filter chips (stables, AERO pairs, BTC, new pools, positive edge, high confidence) to narrow the hot-pools table.",
  },
  { date: "2026-09-13", title: "Mobile card layout for the LP staking-yield table." },
  {
    date: "2026-09-13",
    title: "Personal vote desk — see your current on-chain vote split next to the recommended one, with the $ difference.",
  },
  { date: "2026-09-12", title: "Predictive Allocation status indicator on the dashboard." },
  {
    date: "2026-09-12",
    title:
      "Trust fixes: no more misleading 10,000-veAERO default, new-pool flagging, one-click deep links to vote/add liquidity, and a warning when confidence scores are too clustered to rank by.",
  },
  {
    date: "2026-09-06",
    title:
      "Sortable-column indicators, fixed misaligned trend arrows and $/1k-votes amounts, fixed both numeric inputs getting stuck on a leading zero, a real cold-start loading state, and a durable cross-instance cache so the first visitor after a quiet gap isn't stuck waiting on a rebuild.",
  },
  { date: "2026-09-05", title: "Base Builder Code attribution on vote transactions." },
  {
    date: "2026-09-03",
    title: "Forecast-accuracy track record panel — how the model's predictions have actually performed, epoch over epoch.",
  },
];

export function ChangelogPanel() {
  return (
    <details className="mt-6 rounded-lg border border-neutral-800 px-3 py-2">
      <summary className="cursor-pointer select-none font-mono text-xs uppercase tracking-wider text-neutral-400">
        what&apos;s new
      </summary>
      <ul className="mt-3 space-y-2">
        {CHANGELOG.map((entry) => (
          <li key={entry.date + entry.title} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
            <span className="shrink-0 font-mono text-xs text-neutral-600 sm:w-24">{entry.date}</span>
            <span className="text-xs leading-relaxed text-neutral-400">{entry.title}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

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

function TrendCell({ value }: { value: number }) {
  const positive = value > 0;
  const negative = value < 0;
  // A plain "{arrow} {amount}" inline flow lets the arrow drift left/right
  // row to row, since ▲/▼ aren't the same glyph width and the amount's
  // length varies — right-aligning the whole string only pins the amount's
  // right edge, not the arrow's position (spotted live: arrows visibly out
  // of line down the column). A fixed-width first grid column for the
  // arrow, sized the same on every row, keeps it in a straight line.
  return (
    <div
      className={`grid grid-cols-[14px_1fr] items-center gap-1 font-mono ${
        positive ? "text-emerald-400" : negative ? "text-rose-400" : "text-neutral-500"
      }`}
    >
      <span className="text-center">{positive ? "▲" : negative ? "▼" : "–"}</span>
      <span className="text-right">{usd(Math.abs(value))}</span>
    </div>
  );
}

/** A pool with zero last-epoch fees has no completed-epoch history to
 * forecast from — predicted fees, edge, and confidence are all effectively
 * noise there, but rendered with the same precision as a real pool that
 * makes the model look broken (a Grok example: $0 last epoch alongside a
 * -26.35pp edge). Flag it plainly instead. */
function NewPoolBadge() {
  return (
    <span
      className="ml-2 inline-block rounded bg-sky-950 px-1.5 py-0.5 font-mono text-[10px] text-sky-400"
      title="No completed-epoch fee history yet — predicted fees and edge aren't meaningful until this pool has run at least one full epoch."
    >
      new
    </span>
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

function ConfidenceBar({
  value,
  muted,
  title,
  showBar = true,
}: {
  value: number;
  muted?: boolean;
  title?: string;
  /** False when confidence clusters too tightly across the whole visible
   * set for bar width to mean anything (e.g. everything at ~77%) — 20
   * near-identical bars are noise at that point, not a signal (Grok round
   * 7: "almost every conf bar is 77%. stops being a signal"). The number
   * alone still discriminates fine down to the percentage point. */
  showBar?: boolean;
}) {
  // The bar alone doesn't discriminate well even when showBar is true: live
  // confidence tends to cluster tightly (e.g. most pools sit around
  // 0.75-0.80), so a handful of percentage points of bar-width difference is
  // sub-pixel at this size — the number is what actually communicates the
  // difference.
  //
  // `muted` forces the neutral styling regardless of value — this number is
  // fee-prediction confidence, unrelated to vote-share stability, so a thin
  // (near-zero-vote) row showing a bright "high confidence" bar reads as a
  // false all-clear right next to "no votes yet" (Grok round 4).
  return (
    <div className="flex items-center gap-1.5" title={title ?? `confidence ${value}`}>
      {showBar && (
        <div className="h-1.5 w-8 shrink-0 rounded bg-neutral-800">
          <div
            className={`h-full rounded ${muted ? "bg-neutral-600" : value >= 0.6 ? "bg-sky-500" : value >= 0.4 ? "bg-sky-700" : "bg-neutral-600"}`}
            style={{ width: `${Math.round(value * 100)}%` }}
          />
        </div>
      )}
      <span className={`font-mono text-xs ${muted ? "text-neutral-600" : "text-neutral-400"}`}>
        {Math.round(value * 100)}%
      </span>
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

/** Not live yet as of this writing — Dromos Labs hasn't published Predictive
 * Allocation's contracts/ABI. `status.live` flips purely from env vars once
 * they are (src/adapters/predictive-allocation.ts), with no code change
 * needed here: this chip and its copy update automatically. */
function PaStatusChip({ status }: { status: PaStatus }) {
  if (!status.applicable) return null;
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${
        status.live ? "border-emerald-800 bg-emerald-950/30" : "border-neutral-800 bg-neutral-900/40"
      }`}
      title={
        status.live
          ? "Predictive Allocation is live — the vote panel below now submits directly to it instead of the classic weekly gauge vote."
          : "Dromos Labs' Predictive Allocation (real-time incentive allocation, dated September 2026) is expected to replace weekly gauge voting. Not live yet — this app still casts the classic weekly vote."
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${status.live ? "bg-emerald-400" : "bg-neutral-500"}`} />
      <span className={`font-mono text-xs ${status.live ? "text-emerald-300" : "text-neutral-400"}`}>
        {status.live ? "Predictive Allocation live" : "weekly gauge voting"}
      </span>
    </div>
  );
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
        {/* A faint static "sortable" affordance on every header, replaced by
            the bold directional arrow once it's the active sort — without
            this, an inactive sortable column looked identical to the
            non-sortable "pool" header, so there was no way to tell which
            columns were clickable without trying (works on touch too,
            unlike a hover-only reveal). Stacks the same ▲▼ glyphs used for
            the active state — a dedicated bidirectional-arrow character
            (⇅) isn't in this font's loaded subset and rendered as tofu. */}
        {active ? (
          <span className="w-2.5 text-[10px]">{sort.dir === "desc" ? "▼" : "▲"}</span>
        ) : (
          <span className="flex w-2.5 flex-col text-[7px] leading-[7px] text-neutral-600">
            <span>▲</span>
            <span>▼</span>
          </span>
        )}
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

/**
 * The wallet's actual current on-chain vote split next to the recommended
 * one, so a voter sees a delta instead of a blank recommendation list they
 * have to mentally diff against memory — Grok's "personal vote desk":
 * "I'm 40% in USDC/AERO, model wants 12%, expected +$Y if I rotate."
 *
 * The two $ estimates are deliberately NOT apples-to-apples and say so:
 * "if you switch" reuses the recommendation's own next-epoch predictive
 * model (expectedRewardUsd, already shown above as "expected ~$X next
 * epoch"). "if you stay" has no such model to reuse — it approximates
 * from each pool's last-epoch $/1k rate (the same figure already shown in
 * the pools table) times the voter's own vote count there. Pretending
 * these share a basis would be a new, invisible way to mislead; being
 * explicit about the difference isn't.
 */
export function CurrentVsRecommended({
  currentVotes,
  votingPower,
  recommended,
  poolMeta,
}: {
  currentVotes: CurrentVote[];
  votingPower: number;
  recommended: AllocationRow[];
  poolMeta: Map<string, { symbol: string; rewardPer1kVotesUsd: number }>;
}) {
  if (currentVotes.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3 text-xs text-neutral-500">
        This veNFT hasn&rsquo;t voted yet this epoch — nothing to compare your current split against.
      </p>
    );
  }

  const recommendedByPool = new Map(recommended.map((a) => [a.pool.toLowerCase(), a]));
  const allPools = new Set([
    ...currentVotes.map((v) => v.pool.toLowerCase()),
    ...recommended.map((a) => a.pool.toLowerCase()),
  ]);

  const rows = Array.from(allPools)
    .map((pool) => {
      const current = currentVotes.find((v) => v.pool.toLowerCase() === pool);
      const rec = recommendedByPool.get(pool);
      const meta = poolMeta.get(pool);
      return {
        pool,
        symbol: meta?.symbol ?? rec?.symbol ?? `${pool.slice(0, 8)}…`,
        currentPct: current?.weightPct ?? 0,
        recommendedPct: rec?.weightPct ?? 0,
        rewardPer1kVotesUsd: meta?.rewardPer1kVotesUsd,
      };
    })
    .sort((a, b) => b.recommendedPct - a.recommendedPct || b.currentPct - a.currentPct);

  let estimateIfStay = 0;
  let estimateMissingRate = false;
  for (const r of rows) {
    if (r.currentPct <= 0) continue;
    if (r.rewardPer1kVotesUsd === undefined) {
      estimateMissingRate = true;
      continue;
    }
    const yourVotes = votingPower * (r.currentPct / 100);
    estimateIfStay += r.rewardPer1kVotesUsd * (yourVotes / 1000);
  }
  const estimateIfSwitch = recommended.reduce((s, a) => s + (a.expectedRewardUsd ?? 0), 0);

  return (
    <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
      <div className="mb-2 text-xs text-neutral-500">your current split vs recommended</div>
      <div className="space-y-1">
        {rows.map((r) => {
          const delta = r.recommendedPct - r.currentPct;
          return (
            <div key={r.pool} className="flex items-center gap-2 font-mono text-xs">
              <span className="w-32 truncate text-neutral-300" title={r.symbol}>
                {r.symbol}
              </span>
              <span className="w-14 text-right text-neutral-400">{r.currentPct.toFixed(1)}%</span>
              <span className="text-neutral-600">→</span>
              <span className="w-14 text-neutral-100">{r.recommendedPct.toFixed(1)}%</span>
              <span
                className={`w-16 text-right ${
                  delta > 0.05 ? "text-emerald-400" : delta < -0.05 ? "text-rose-400" : "text-neutral-600"
                }`}
              >
                {delta > 0 ? "+" : ""}
                {delta.toFixed(1)}pp
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 border-t border-neutral-800 pt-2 text-xs leading-relaxed text-neutral-400">
        Estimated next epoch: <span className="text-neutral-200">{usd(estimateIfStay)}</span> if you keep this
        split (last epoch&rsquo;s $/1k rate{estimateMissingRate ? "; some pools lack a rate and are excluded" : ""}
        ), vs <span className="text-emerald-400">{usd(estimateIfSwitch)}</span> if you switch to the
        recommendation above (this forecast&rsquo;s next-epoch model) — not apples-to-apples, since the two use
        different bases.
      </p>
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
  const [paStatus, setPaStatus] = useState<PaStatus | null>(null);
  // Non-null while the visible data is last epoch's cache rather than a
  // fresh fetch — cleared the moment loadAll's own request lands.
  const [staleSince, setStaleSince] = useState<number | null>(null);
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
  // The selected veNFT's actual on-chain vote split (null until a real
  // veNFT is selected) — read once via wallet.tsx's onNftSelected, not
  // re-fetched here.
  const [currentVotes, setCurrentVotes] = useState<CurrentVote[] | null>(null);

  // Hydrate from the last cached snapshot before the browser paints — see
  // useIsomorphicLayoutEffect's comment above for why this can't just be
  // each state's own initializer. A cache hit still kicks off loadAll's own
  // background refetch below unchanged.
  useIsomorphicLayoutEffect(() => {
    const cached = readDashboardCache();
    if (!cached) return;
    setSnapshot({
      generatedAt: cached.data.generatedAt,
      epochStart: cached.data.epochStart,
      epochProgressPct: cached.data.epochProgressPct,
      pools: cached.data.pools,
    });
    setVoterAlloc(cached.data.voterAlloc);
    setProtoAlloc(cached.data.protoAlloc);
    setEdgeAlloc(cached.data.edgeAlloc);
    setLpDeposits(cached.data.lpDeposits);
    setVoteSwings(cached.data.voteSwings);
    setTrackRecord(cached.data.trackRecord);
    setPaStatus(cached.data.paStatus);
    setStaleSince(cached.cachedAt);
    setLoading(false);
  }, []);

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
  const [poolSearch, setPoolSearch] = useState("");
  const [poolFilter, setPoolFilter] = useState<PoolFilterKey>("all");

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

  // Keep the URL in sync so the current view is always shareable — except
  // $/1k votes, which is a volatility *warning* view (thin, near-zero-vote
  // gauges), not a view worth handing out as "the" link for this app (Grok
  // round 4: "don't tweet the warning mode as the homepage"). Exploring it
  // stays purely client-side; the address bar keeps whatever safe sort it
  // last held, so a copy-pasted link always lands on predicted fees/edge.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (poolSort.key === "rewardPer1kVotesUsd") {
      params.delete("sort");
      params.delete("dir");
    } else {
      params.set("sort", poolSort.key);
      params.set("dir", poolSort.dir);
    }
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
      setPaStatus(data.paStatus);
      setStaleSince(null);
      writeDashboardCache({
        generatedAt: data.generatedAt,
        epochStart: data.epochStart,
        epochProgressPct: data.epochProgressPct,
        pools: data.pools,
        voterAlloc: data.voterAlloc,
        protoAlloc: data.protoAlloc,
        edgeAlloc: data.edgeAlloc,
        lpDeposits: data.lpDeposits,
        voteSwings: data.voteSwings,
        trackRecord: data.trackRecord,
        paStatus: data.paStatus,
      });
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

  // Search/filter run over the *full* snapshot before the top-20 slice —
  // stables, AERO pairs, BTC, tokenized stocks, and new listings were all
  // mixed in one dump with no way to narrow it down (Grok round 8).
  const trimmedSearch = poolSearch.trim().toLowerCase();
  const matchingPools = (snapshot?.pools ?? [])
    .filter((p) => p.predictedFeesUsd > 0)
    .filter((p) => matchesPoolFilter(p, poolFilter, DISPLAY_PRESET.tokenSymbol))
    .filter((p) => !trimmedSearch || p.symbol.toLowerCase().includes(trimmedSearch));
  const pools = [...matchingPools]
    .sort((a, b) => (poolSort.dir === "desc" ? b[poolSort.key] - a[poolSort.key] : a[poolSort.key] - b[poolSort.key]))
    .slice(0, 20);
  // Retitle/relabel the section when sorted this way — "predicted hot pools"
  // sorted by $/1k votes surfaces empty-denominator gauges (tiny fees, ~0
  // votes) at the top, which reads as an opportunity ranking instead of the
  // volatility warning it actually is (Grok round 3).
  const sortedByRewardPer1k = poolSort.key === "rewardPer1kVotesUsd";

  const lpOpportunities = [...(lpDeposits?.opportunities ?? [])].sort((a, b) =>
    lpSort.dir === "desc" ? b[lpSort.key] - a[lpSort.key] : a[lpSort.key] - b[lpSort.key],
  );

  // Individual bars stop being a signal once every value in view clusters
  // within a few points of each other — 20 near-identical bars is noise,
  // not discrimination (Grok round 7). Suppress the bar (keep the exact
  // number, which still discriminates fine) and say so once instead.
  const poolConfClustered = isConfidenceClustered(pools.map((p) => p.confidence));
  const lpConfClustered = isConfidenceClustered(lpOpportunities.map((o) => o.confidence));

  // Keyed by lowercased address so on-chain reads (wagmi/viem checksummed)
  // and the server's pool list match regardless of casing. Built from the
  // *full* snapshot, not the visible top-20 slice — a pool the wallet is
  // currently voted in may not be a top predicted-fee pool at all.
  const poolMetaByAddress = useMemo(() => {
    const map = new Map<string, { symbol: string; rewardPer1kVotesUsd: number }>();
    for (const p of snapshot?.pools ?? []) {
      map.set(p.lp.toLowerCase(), { symbol: p.symbol, rewardPer1kVotesUsd: p.rewardPer1kVotesUsd });
    }
    return map;
  }, [snapshot]);

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
          {paStatus?.applicable && (
            <p className="mt-1 text-xs text-neutral-500">
              {paStatus.live
                ? "Predictive Allocation is live — the vote panel below now submits directly to it."
                : "Weekly gauge voting today; Dromos Labs' Predictive Allocation is expected to replace it — this forecast and your expected $ apply either way."}
            </p>
          )}
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
          {paStatus && <PaStatusChip status={paStatus} />}
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

      {staleSince !== null && (
        <div className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-2 text-xs text-neutral-400">
          showing cached data from {formatAgo(Date.now() - staleSince)} — refreshing…
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
              {sortedByRewardPer1k ? "Highest $/1k votes — thin gauges" : "Predicted hot pools"}
            </h2>
            {sortedByRewardPer1k && (
              <p className="mb-3 -mt-1 text-xs text-amber-500">
                This sort surfaces pools with the least existing vote weight, so $/1k is the most unstable number
                on the page — it can collapse the moment anyone else votes here. Not a ranking of the biggest
                opportunities; sort by predicted fees or edge for that.
              </p>
            )}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={poolSearch}
                onChange={(e) => setPoolSearch(e.target.value)}
                placeholder="search symbol…"
                className="w-36 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-sky-600 focus:outline-none"
              />
              {POOL_FILTER_CHIPS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPoolFilter(key)}
                  className={`rounded-lg border px-2.5 py-1 font-mono text-xs ${
                    poolFilter === key
                      ? "border-sky-600 bg-sky-950/40 text-sky-300"
                      : "border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {(poolSearch.trim() !== "" || poolFilter !== "all") && (
              <p className="mb-3 text-xs text-neutral-500">
                {matchingPools.length === 0
                  ? "No pools match this search/filter."
                  : `Showing top ${Math.min(20, matchingPools.length)} of ${matchingPools.length} matching pools.`}
              </p>
            )}
            {/* Card layout below sm: an 8-column table clipped to ~2 visible columns on a
                phone hides exactly the column the user just sorted by (Grok round 3). */}
            <div className="grid gap-2 sm:hidden">
              {pools.map((p) => {
                const thin = p.voteSharePct < 0.1;
                const noHistory = p.lastEpochFeesUsd === 0;
                return (
                  <div
                    key={p.lp}
                    className={`rounded-lg border px-3 py-2.5 ${
                      thin ? "border-amber-900/60 bg-amber-950/10" : "border-neutral-800 bg-neutral-900/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate">
                        <a
                          href={poolAppLink("vote", p.lp)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-neutral-100 hover:text-sky-400 hover:underline"
                        >
                          {p.symbol}
                        </a>
                        <span className="ml-2 font-mono text-xs text-neutral-500">{p.poolType}</span>
                        {noHistory && <NewPoolBadge />}
                      </div>
                      {noHistory ? (
                        <span
                          className="text-xs text-neutral-600"
                          title="No fee history yet — edge isn't meaningful until this pool has a completed epoch."
                        >
                          n/a
                        </span>
                      ) : (
                        <EdgeBadge edge={p.edgePct} />
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs">
                      <span className="text-neutral-400">
                        predicted <span className="text-neutral-100">{usd(p.predictedFeesUsd)}</span>
                      </span>
                      <span className={thin ? "text-amber-400" : "text-neutral-300"}>
                        $/1k ${p.rewardPer1kVotesUsd.toFixed(2)}
                        {thin && " ⚠"}
                      </span>
                      <ConfidenceBar
                        value={p.confidence}
                        muted={thin}
                        showBar={!poolConfClustered}
                        title={
                          thin
                            ? "Fee-prediction confidence only — not a signal that voting here is safe, since current votes are near zero."
                            : undefined
                        }
                      />
                    </div>
                    {thin && (
                      <p className="mt-1 text-[11px] text-amber-500">
                        no votes yet — $/1k is unstable until someone votes here
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto rounded-xl border border-neutral-800 sm:block">
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
                  {pools.map((p) => {
                    const thin = p.voteSharePct < 0.1;
                    const noHistory = p.lastEpochFeesUsd === 0;
                    return (
                      <tr
                        key={p.lp}
                        className={`border-b border-neutral-800/60 last:border-0 hover:bg-neutral-900/40 ${
                          thin ? "bg-amber-950/10" : ""
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <a
                            href={poolAppLink("vote", p.lp)}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-neutral-100 hover:text-sky-400 hover:underline"
                          >
                            {p.symbol}
                          </a>
                          <span className="ml-2 font-mono text-xs text-neutral-500">{p.poolType}</span>
                          {noHistory && <NewPoolBadge />}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-neutral-100">{usd(p.predictedFeesUsd)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-neutral-400">{usd(p.lastEpochFeesUsd)}</td>
                        <td className="px-4 py-2.5">
                          <TrendCell value={p.feeTrendUsdPerEpoch} />
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-neutral-300">
                          {thin ? (
                            <span className="text-amber-500">no votes yet</span>
                          ) : (
                            `${p.voteSharePct.toFixed(1)}%`
                          )}{" "}
                          → {p.demandSharePct.toFixed(1)}%
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {noHistory ? (
                            <span
                              className="text-xs text-neutral-600"
                              title="No fee history yet — edge isn't meaningful until this pool has a completed epoch."
                            >
                              n/a
                            </span>
                          ) : (
                            <EdgeBadge edge={p.edgePct} />
                          )}
                        </td>
                        <td
                          className="px-4 py-2.5 font-mono text-neutral-300"
                          title={
                            thin
                              ? "Current vote share is near zero — this $/1k figure is based on very few votes and can swing wildly the moment anyone votes here. Not a reliable signal on its own."
                              : undefined
                          }
                        >
                          {/* Reserve a fixed-width slot for the optional
                              warning icon so its presence doesn't shift the
                              amount left compared to rows without it — same
                              fix as the trend/epoch arrows drifting
                              (spotted live, same underlying cause). */}
                          <div className="grid grid-cols-[1fr_14px] items-center gap-1">
                            <span className="text-right">${p.rewardPer1kVotesUsd.toFixed(2)}</span>
                            <span className="text-center text-amber-500">{thin ? "⚠" : ""}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <ConfidenceBar
                            value={p.confidence}
                            muted={thin}
                            showBar={!poolConfClustered}
                            title={
                              thin
                                ? "Fee-prediction confidence only — not a signal that voting here is safe, since current votes are near zero."
                                : undefined
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              Edge = predicted fee-demand share − current vote share. Positive edge means the pool is
              under-incentivized relative to where trading demand is heading. Click a column header to sort —
              top 20 pools by that column, not just a reorder of the top 20 by fees.
              {poolConfClustered &&
                " Confidence is calibrated and clusters tightly across these pools this epoch — the number is the signal, not bar length."}
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
                    // Rendering "" (not "0") while cleared stops a stuck
                    // leading zero: Number("") is 0, so clearing the field
                    // down to empty and re-rendering value={0} would put a
                    // literal "0" back in the DOM — then the next digit
                    // typed appends onto it ("0" + "2" = "02") instead of
                    // replacing it, so 10,000 could never become 200.
                    value={votingPower === 0 ? "" : votingPower}
                    onChange={(e) => setVotingPower(e.target.value === "" ? 0 : Number(e.target.value))}
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
                  {currentVotes && (
                    <CurrentVsRecommended
                      currentVotes={currentVotes}
                      votingPower={votingPower}
                      recommended={voterAlloc.allocations}
                      poolMeta={poolMetaByAddress}
                    />
                  )}
                  <VotePanel
                    allocations={voterAlloc.allocations}
                    onNftSelected={(vp, votes) => {
                      setVotingPower(vp);
                      setCurrentVotes(votes);
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
            {/* Card layout below sm: same reasoning as the predicted-hot-pools
                table above — a 6-column table clipped to ~2 visible columns
                on a phone hides most of what the user sorted by (Grok round
                8: "mobile is a wide table"). */}
            <div className="grid gap-2 sm:hidden">
              {lpOpportunities.map((o) => (
                <div key={o.pool} className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate">
                      <a
                        href={poolAppLink("liquidity", o.pool)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-neutral-100 hover:text-sky-400 hover:underline"
                      >
                        {o.symbol}
                      </a>
                      <span className="ml-2 font-mono text-xs text-neutral-500">{o.poolType}</span>
                    </div>
                    <TrendCell value={o.emissionsTrendUsdPerEpoch} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs">
                    <span className="text-neutral-400">
                      staked <span className="text-neutral-100">{usd(o.stakedTvlUsd)}</span>
                    </span>
                    <span className="text-neutral-400">
                      APR <span className="text-neutral-300">{o.currentEpochAprPct.toFixed(1)}%</span> →{" "}
                      <span className="text-emerald-400">{o.predictedNextEpochAprPct.toFixed(1)}%</span>
                    </span>
                    <ConfidenceBar value={o.confidence} showBar={!lpConfClustered} />
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto rounded-xl border border-neutral-800 sm:block">
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
                        <a
                          href={poolAppLink("liquidity", o.pool)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-neutral-100 hover:text-sky-400 hover:underline"
                        >
                          {o.symbol}
                        </a>
                        <span className="ml-2 font-mono text-xs text-neutral-500">{o.poolType}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-neutral-400">{usd(o.stakedTvlUsd)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-neutral-300">
                        {o.currentEpochAprPct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-emerald-400">
                        {o.predictedNextEpochAprPct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5">
                        <TrendCell value={o.emissionsTrendUsdPerEpoch} />
                      </td>
                      <td className="px-4 py-2.5">
                        <ConfidenceBar value={o.confidence} showBar={!lpConfClustered} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              For LPs staking liquidity — ranked by forecast {DISPLAY_PRESET.tokenSymbol}-emissions APR, not
              trading fees (those accrue to {DISPLAY_PRESET.veTokenSymbol} voters, not stakers).
              {lpConfClustered &&
                " Confidence is calibrated and clusters tightly across these pools this epoch — the number is the signal, not bar length."}
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
                    // "" (not "0") while cleared — same fix as the veAERO
                    // voting-power input: Number("") is 0, and re-rendering
                    // value={0} puts a literal "0" back in the DOM, so the
                    // next digit typed appends onto it instead of replacing.
                    value={bribeBudget === 0 ? "" : bribeBudget}
                    onChange={(e) => setBribeBudget(e.target.value === "" ? 0 : Number(e.target.value))}
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
                {/* Plain-language headline before the metric grid — "skill vs.
                    naive baseline: +5.6%" doesn't read as an answer to "does
                    this forecast actually beat just guessing last epoch's
                    number?" without already knowing the baseline is exactly
                    that guess (Grok round 5). Handles the honest case too:
                    this can (and sometimes does) go negative. */}
                <p className="mb-4 text-sm text-neutral-300">
                  Across {trackRecord.samplePoints.toLocaleString()} historical epochs, this forecast has been{" "}
                  <span
                    className={
                      trackRecord.overall.skillVsBaselineWapePct >= 0
                        ? "font-medium text-emerald-400"
                        : "font-medium text-rose-400"
                    }
                  >
                    {trackRecord.overall.skillVsBaselineWapePct >= 0 ? "more accurate" : "less accurate"}
                  </span>{" "}
                  than simply assuming each epoch repeats the last one — by{" "}
                  {Math.abs(trackRecord.overall.skillVsBaselineWapePct).toFixed(1)}%.
                </p>
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
                    <div className="font-mono text-xs text-neutral-500">vs. last-epoch guess</div>
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

          <ChangelogPanel />

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
