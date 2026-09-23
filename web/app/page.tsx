"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
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
  feeHistory: number[];
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
  /** Posted bribes already committed this epoch, USD — a floor, not a forecast (voter_roi only). */
  bribeFloorUsd?: number;
  /** Confidence-blended predicted-vs-last-epoch fee estimate, USD — the risky half of the payout (voter_roi only). */
  feeForecastUsd?: number;
  confidence: number;
}

interface Allocation {
  objective: string;
  summary: string;
  votingPowerVe?: number;
  gasHurdleDroppedCount?: number;
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
  /** Votes this gauge would normally have by now. Under ~1, the engine's
   * swing percentage divides by a 1-vote floor and explodes, so the number
   * stops meaning anything — see SwingRow. */
  expectedVotesSoFar: number;
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

// The bar itself is only ~32px wide (h-1.5 w-8), so 1 percentage point of
// spread is worth roughly 0.32px on screen — anything under ~8pp doesn't
// clear a couple of real pixels of difference and reads as decoration, not
// signal, even though it's statistically a real spread (external review,
// live: "conf still clusters ~71-79%. Bars look like decoration" — 8pp was
// still rendering as bars at the old, purely-statistical 3pp threshold).
const CONFIDENCE_CLUSTER_THRESHOLD = 0.08;

/** True when every value in the currently-visible set sits close enough
 * together that a column of individual bar widths can't discriminate
 * anything the number itself doesn't already say — see the pixel-width
 * reasoning on CONFIDENCE_CLUSTER_THRESHOLD above. */
export function isConfidenceClustered(values: number[]): boolean {
  if (values.length < 3) return false;
  return Math.max(...values) - Math.min(...values) < CONFIDENCE_CLUSTER_THRESHOLD;
}

const LP_THIN_TVL_USD = 50_000;
const LP_ABSURD_APR_PCT = 1000;

/** An APR computed against a few thousand dollars of staked TVL swings into
 * five- and six-figure percentages that are technically the correct division
 * but read as a broken dashboard, not a real opportunity (external feedback:
 * "81,007% current / 39,326% predicted on $1.9k TVL looks like a bug"). Hide
 * these by default rather than clamp/round the number, which would just
 * relabel the same misleading figure. */
export function isThinLpOpportunity(o: { stakedTvlUsd: number; currentEpochAprPct: number; predictedNextEpochAprPct: number }): boolean {
  return o.stakedTvlUsd < LP_THIN_TVL_USD || o.currentEpochAprPct > LP_ABSURD_APR_PCT || o.predictedNextEpochAprPct > LP_ABSURD_APR_PCT;
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
    date: "2026-09-23",
    title:
      "Rebuilt around the job: Voter ROI leads the page with the expected-$ total as the headline, the other two splits collapse behind \"Other splits\", and phones get vote/LP/swings tabs instead of one 7,000px scroll. Sticky header keeps the flip clock and connect button in reach; vote-swing signals are one scannable line each; an all-thin LP list says so instead of rendering an empty table.",
  },
  {
    date: "2026-09-23",
    title: "Footer now points to the MCP server and the x402 API directly — skip the UI, ask an agent instead.",
  },
  {
    date: "2026-09-22",
    title:
      "The mobile hot-pools cards now expand (▸) to show the fee-history sparkline too — previously desktop-only. Confidence bars mute at an 8pp spread instead of 3pp, since anything tighter doesn't move a ~32px bar by a visible amount. A gas-hurdle-collapsed Voter ROI result gets its own one-line explanation instead of looking like a broken card. Header status chips and action buttons now group separately instead of piling into one row.",
  },
  {
    date: "2026-09-22",
    title:
      "Vote mode (on by default) trims the hot-pools table to pool, predicted fees, trend, edge, $/1k votes, and confidence — last epoch and votes-vs-demand fold into the row expand (▸) instead of disappearing. Toggle it off for the full table.",
  },
  {
    date: "2026-09-22",
    title:
      "Hot-pools table now defaults to sorting by edge instead of raw predicted fees — fee size alone doesn't say where to vote, edge (predicted demand share minus current vote share) does.",
  },
  {
    date: "2026-09-22",
    title:
      "Fixed the LP staking-yield table's \"thin\" badge trailing each row's own symbol text instead of lining up in a column, on both the desktop table and the mobile card layout.",
  },
  {
    date: "2026-09-22",
    title:
      "Multi-veNFT batch voting — every detected veAERO NFT is selected by default and cast as one Multicall3 transaction instead of one wallet signature per lock.",
  },
  {
    date: "2026-09-22",
    title:
      "Voter ROI now splits each pool's payout into a bribe floor (posted, already committed) and a fee forecast (the riskier, confidence-blended half) instead of one blended number, and a gas hurdle collapses a small veAERO amount to 1-3 pools instead of an 8-way split not worth the extra calldata.",
  },
  {
    date: "2026-09-22",
    title:
      "A persistent snapshot-freshness chip (with quiet auto-refresh in the final 6h before a vote flips) and a tighter flip-clock — amber under 12h, red with an explicit \"may be stale, refresh\" warning under 2h.",
  },
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

// Split out from Sparkline so the point-placement math (the part actually
// worth getting wrong) has a direct unit test, independent of SVG rendering.
export function sparklinePoints(values: number[], width: number, height: number): string {
  if (values.length === 0) return "";
  if (values.length === 1) return `0,${height / 2} ${width},${height / 2}`;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

const SPARKLINE_WIDTH = 160;
const SPARKLINE_HEIGHT = 32;

function Sparkline({ values }: { values: number[] }) {
  const rising = values[values.length - 1] >= values[0];
  return (
    <svg
      width={SPARKLINE_WIDTH}
      height={SPARKLINE_HEIGHT}
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      role="img"
      aria-label={`fee history sparkline, ${rising ? "rising" : "falling"} overall`}
    >
      <polyline
        points={sparklinePoints(values, SPARKLINE_WIDTH, SPARKLINE_HEIGHT)}
        fill="none"
        stroke={rising ? "#34d399" : "#fb7185"}
        strokeWidth="1.5"
      />
    </svg>
  );
}

/**
 * The content of a pool row's expand (▸) — fee-history sparkline, plus (in
 * vote mode) the last-epoch $ and votes-vs-demand figures that mode hides
 * from the row itself. Shared by the desktop table row and the mobile card
 * layout so the sparkline isn't desktop-only (spotted live: mobile had no
 * way to see it at all, despite the ▸ affordance existing only on desktop).
 */
function PoolExpandDetail({
  p,
  thin,
  voteMode,
}: {
  p: PoolRow;
  thin: boolean;
  voteMode: boolean;
}) {
  return (
    <>
      {voteMode && (
        <p className="mb-2 font-mono text-xs text-neutral-400">
          last epoch {usd(p.lastEpochFeesUsd)} · votes vs demand{" "}
          {thin ? <span className="text-amber-500">no votes yet</span> : `${p.voteSharePct.toFixed(1)}%`}
          {" "}→ {p.demandSharePct.toFixed(1)}%
        </p>
      )}
      {p.feeHistory.length >= 2 ? (
        <div className="flex flex-wrap items-center gap-4">
          <Sparkline values={p.feeHistory} />
          <span className="font-mono text-xs text-neutral-500">
            fees, last {p.feeHistory.length} completed epochs: {usd(p.feeHistory[0])} →{" "}
            {usd(p.feeHistory[p.feeHistory.length - 1])}
          </span>
        </div>
      ) : (
        <p className="text-xs text-neutral-600">Not enough completed epochs yet for a trend line.</p>
      )}
    </>
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

/**
 * One vote-swing signal as a single scannable line — symbol, bribe pace,
 * vote delta — with the full rationale behind a tap (<details>, same
 * pattern as the changelog panel) rather than three lines of prose per
 * card, ten cards deep.
 */
function SwingRow({ s, tone }: { s: VoteSwingSignal; tone: "riser" | "faller" }) {
  const riser = tone === "riser";
  const accent = riser ? "text-emerald-400" : "text-rose-400";
  // A gauge with no meaningful prior-epoch vote history divides by a 1-vote
  // floor upstream, which renders as e.g. "+3,287,989,742.5%" — the correct
  // division, and useless. Same call the thin-LP filter makes.
  const noBaseline = s.expectedVotesSoFar < 1;
  return (
    <details
      className={`rounded-lg border px-3 py-2 ${
        riser ? "border-emerald-900/60 bg-emerald-950/20" : "border-rose-900/60 bg-rose-950/20"
      }`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-neutral-100">{s.symbol}</span>
        <span className="flex shrink-0 items-center gap-3 font-mono text-xs">
          <span className={accent}>
            {s.bribeSpikeRatio !== null ? `${s.bribeSpikeRatio}x pace` : riser ? "new bribe" : "flat pace"}
          </span>
          {noBaseline ? (
            <span
              className="whitespace-nowrap text-neutral-500"
              title="This gauge had effectively no votes by this point in prior epochs, so there's no baseline to measure a swing against."
            >
              no baseline
            </span>
          ) : (
            <span className={`w-16 whitespace-nowrap text-right ${accent}`}>
              {s.voteSwingPct > 0 ? "+" : ""}
              {s.voteSwingPct.toFixed(1)}%
            </span>
          )}
        </span>
      </summary>
      <p className="mt-2 text-xs leading-relaxed text-neutral-500">{s.rationale}</p>
    </details>
  );
}

function ThinLpToggle({
  count,
  shown,
  onToggle,
  className,
}: {
  count: number;
  shown: boolean;
  onToggle: () => void;
  className: string;
}) {
  return (
    <button type="button" onClick={onToggle} className={className}>
      {shown
        ? `hide ${count} thin pool${count === 1 ? "" : "s"} (staked TVL under $50k or APR over 1,000% — not a real opportunity, just a tiny denominator)`
        : `${count} thin pool${count === 1 ? "" : "s"} hidden (staked TVL under $50k or APR over 1,000%) — show anyway`}
    </button>
  );
}

function ThinLpBadge() {
  return (
    <span
      className="ml-2 inline-block rounded bg-amber-950 px-1.5 py-0.5 font-mono text-[10px] text-amber-500"
      title="Staked TVL under $50k or APR over 1,000% — the APR here is a real division, not a display bug, but too small a denominator to treat as a real opportunity."
    >
      thin
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

// Shared by the freshness chip and the auto-refresh poll below — both need
// a "start being careful about staleness" threshold with enough lead time
// to actually matter, well before the epoch chip's own final-countdown red
// state (EPOCH_RED_HOURS below, much tighter on purpose).
const URGENT_WINDOW_HOURS = 6;

// EpochCountdown's own color thresholds — deliberately less polite than a
// generic "close to flip" window (BNKR/Grok: "your chip is too polite"):
// neutral above 12h, amber inside 12h, red (with an explicit stale-data
// warning, not just a color) inside the final 2h.
const EPOCH_AMBER_HOURS = 12;
const EPOCH_RED_HOURS = 2;

function hoursUntilFlip(epochStart: number): number {
  return ((epochStart + WEEK_SECONDS) * 1000 - Date.now()) / (60 * 60 * 1000);
}

function isUrgentWindow(epochStart: number): boolean {
  const hoursLeft = hoursUntilFlip(epochStart);
  return hoursLeft > 0 && hoursLeft <= URGENT_WINDOW_HOURS;
}

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
  const urgent = hoursLeft <= EPOCH_RED_HOURS;
  const soon = hoursLeft <= EPOCH_AMBER_HOURS;

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
        {urgent && " — allocation may be stale, refresh"}
      </span>
    </div>
  );
}

/**
 * Persistent "how old is what I'm looking at" chip — sits next to the
 * flip-clock so it's visible on every load, not just during the
 * cached-fallback banner (that one only shows while a background refetch is
 * in flight). One onchain snapshot covers fees, votes, and posted bribes
 * together (lib/snapshot.ts) — there's no separate bribe/vote timestamp to
 * show, so this deliberately doesn't invent one.
 *
 * Turns red only once BOTH conditions hold: the snapshot is older than the
 * server's own cache TTL (5min — SETTINGS.cacheTtlMs) AND the vote is close
 * to flipping (urgent, from the same threshold EpochCountdown uses). A
 * 5-minute-old snapshot mid-epoch costs nothing; the same staleness at
 * T-90m is exactly the "voted on a bribe dump that already happened"
 * failure BNKR/Grok flagged.
 */
function SnapshotFreshness({ generatedAt, urgent }: { generatedAt: number; urgent: boolean }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const ageMs = now - generatedAt;
  const stale = ageMs > 5 * 60_000;
  const flagged = urgent && stale;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${
        flagged ? "border-rose-800 bg-rose-950/40" : "border-neutral-800 bg-neutral-900/40"
      }`}
      title="One onchain snapshot covers pool fees, votes, and posted bribes together — no separate bribe/vote timestamp exists to show."
    >
      <span className={`h-1.5 w-1.5 rounded-full ${flagged ? "bg-rose-400" : "bg-neutral-500"}`} />
      <span className={`font-mono text-xs ${flagged ? "text-rose-300" : "text-neutral-400"}`}>
        snapshot {formatAgo(ageMs)}
        {flagged && " — may be stale, refresh"}
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
              {a.bribeFloorUsd !== undefined && a.feeForecastUsd !== undefined && (
                <span
                  title="Bribe floor: posted incentives already committed this epoch — collected regardless of whether the fee forecast is right. Fee forecast: the confidence-blended predicted-vs-last-epoch estimate — the risky half of the payout."
                >
                  {" "}
                  · <span className="text-neutral-500">{usd(a.bribeFloorUsd)} floor</span> +{" "}
                  <span className="text-amber-600">{usd(a.feeForecastUsd)} forecast</span>
                </span>
              )}
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
  // Disconnecting (or the wallet extension's own session lapsing) doesn't
  // unmount anything here, so without this, currentVotes — and the "from
  // wallet" badge / current-vs-recommended panel it drives — would keep
  // showing a previous session's real veNFT data as if it were still live
  // (a real trust bug spotted externally: header said disconnected, ROI
  // card still claimed "92 veAERO ✓ from wallet").
  const { isConnected } = useAccount();
  // React that a real *connected -> disconnected* transition happened, not
  // just "isConnected is currently false" — a ref seeded from the initial
  // value and only ever reacting to it flipping true->false. Reacting to
  // mere presence (e.g. a "have we mounted yet" flag) breaks under
  // StrictMode's dev-only double-invoked effects: the phantom second
  // invocation would consume a mount-only guard and wrongly fire the reset
  // with no wallet ever having connected, stomping a shared link's own
  // ?vp= value.
  const wasConnectedRef = useRef(isConnected);
  useEffect(() => {
    const wasConnected = wasConnectedRef.current;
    wasConnectedRef.current = isConnected;
    if (isConnected || !wasConnected) return;
    setCurrentVotes(null);
    // The veAERO amount itself is also wallet-derived once connected — left
    // at "92" after a real disconnect, it would keep showing a stale
    // balance next to a recommendation split that's no longer anyone's
    // real position (external feedback: "clear the counter... once the
    // wallet disconnected"). Reset to the same default a fresh, never-
    // connected visitor sees, and refetch the recommendation to match.
    setVotingPower(10000);
    recomputeVoterWithPower(10000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

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
  // Defaults to edge, not raw predicted fees — fees alone just ranks pool
  // size, not what's worth voting into. Edge (predicted demand share minus
  // current vote share) is the one column that answers "where should I
  // actually look first" for a visitor here to vote, which raw fee size
  // doesn't (external review: "fees just ranks size").
  const [poolSort, setPoolSort] = useState<{ key: PoolSortKey; dir: "asc" | "desc" }>({
    key: "edgePct",
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
  const [expandedPool, setExpandedPool] = useState<string | null>(null);
  const [showThinLp, setShowThinLp] = useState(false);
  // Phone-only: one 7000px scroll is three jobs stacked (vote / LP / market
  // swings), and only the first is why most people are here. Desktop keeps
  // the single dense page — the tab bar and this state are inert above sm
  // (external review: "do not render all three sections on one scroll on
  // mobile", with "desktop keeps the dense table").
  const [mobileTab, setMobileTab] = useState<"vote" | "lp" | "swings">("vote");
  const onTab = (t: "vote" | "lp" | "swings") => (mobileTab === t ? "" : "hidden");
  // Defaults on: a visitor here to vote needs pool, predicted fees,
  // trend, edge, $/1k votes, and conf — not all 8 columns shouting at
  // once. last epoch and votes-vs-demand move into the row expand
  // instead of disappearing outright (external review: "right now
  // everything shouts"). Off flips back to the full power-user table.
  const [voteMode, setVoteMode] = useState(true);

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

  // `background` skips the full-page spinner and swallows errors instead of
  // surfacing them in the error banner — used by the urgent-window
  // auto-refresh poll below, where a transient failure (or the refresh
  // rate-limit's 429 — see app/api/dashboard/route.ts) should just mean
  // "try again next tick", not interrupt whatever's already on screen.
  const loadAll = useCallback(async (refresh = false, opts: { background?: boolean } = {}) => {
    const { background = false } = opts;
    if (!background) {
      setLoading(true);
      setError(null);
    }
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
      if (!background) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!background) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Freshness fix (BNKR/Grok: "a wrong vote-share at T-2h is worse than a
  // missing feature") — once the vote is within URGENT_WINDOW_HOURS of
  // flipping, stop waiting on the next organic visit to trigger the
  // server's stale-while-revalidate refresh (lib/snapshot.ts) and instead:
  // one forced live rebuild (`refresh=1`) on entering the window, then a
  // quiet poll every 60s for the rest of it. `forcedRef` makes the forced
  // rebuild fire once per entry into the window rather than once per poll —
  // the server already rate-limits refresh=1 to 1/cacheTtlMs/IP regardless,
  // this just avoids spamming it with 429s.
  const forcedUrgentRefreshRef = useRef(false);
  useEffect(() => {
    if (!snapshot) return;
    const epochStart = snapshot.epochStart;
    const tick = () => {
      if (!isUrgentWindow(epochStart)) {
        forcedUrgentRefreshRef.current = false;
        return;
      }
      if (!forcedUrgentRefreshRef.current) {
        forcedUrgentRefreshRef.current = true;
        loadAll(true, { background: true });
      } else {
        loadAll(false, { background: true });
      }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [snapshot?.epochStart, loadAll]);

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

  const lpOpportunitiesSorted = [...(lpDeposits?.opportunities ?? [])].sort((a, b) =>
    lpSort.dir === "desc" ? b[lpSort.key] - a[lpSort.key] : a[lpSort.key] - b[lpSort.key],
  );
  const lpThinCount = lpOpportunitiesSorted.filter(isThinLpOpportunity).length;
  const lpOpportunities = showThinLp ? lpOpportunitiesSorted : lpOpportunitiesSorted.filter((o) => !isThinLpOpportunity(o));

  // Individual bars stop being a signal once every value in view clusters
  // within a few points of each other — 20 near-identical bars is noise,
  // not discrimination (Grok round 7). Suppress the bar (keep the exact
  // number, which still discriminates fine) and say so once instead.
  const poolConfClustered = isConfidenceClustered(pools.map((p) => p.confidence));
  const lpConfClustered = isConfidenceClustered(lpOpportunities.map((o) => o.confidence));

  // Same figure recommendAllocation's own summary quotes — the sum of each
  // row's post-dilution expected reward — recomputed here rather than
  // parsed back out of that sentence.
  const voterTotalExpectedUsd = (voterAlloc?.allocations ?? []).reduce((s, a) => s + (a.expectedRewardUsd ?? 0), 0);

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
      {/* Primary bar: who this is, how long you have, how fresh the data is,
          and the one action that starts the vote. Sticky so the flip clock
          and Connect stay reachable from anywhere in a long page. Everything
          else in the header is secondary and demoted to the row below
          (external review: "everything is a pill... the eye has nowhere to
          land"). */}
      <header className="sticky top-0 z-20 -mx-6 mb-4 border-b border-neutral-800/80 bg-neutral-950/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            {DISPLAY_PRESET.displayName} <span className="text-sky-400">Allocator</span>
          </h1>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {snapshot && <EpochCountdown epochStart={snapshot.epochStart} />}
            {snapshot && (
              <SnapshotFreshness generatedAt={snapshot.generatedAt} urgent={isUrgentWindow(snapshot.epochStart)} />
            )}
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Phone gets the one-liner; desktop gets the fuller sentence below
          instead, so the two don't stack into a redundant pair. */}
      <p className="text-sm text-neutral-300 sm:hidden">
        Where to vote {DISPLAY_PRESET.veTokenSymbol} this epoch.
      </p>
      {/* The explainer and the Predictive Allocation note are context, not
          instructions — worth having on a desktop read, half a viewport of
          manifesto above the fold on a phone. */}
      <p className="mt-1 hidden text-sm text-neutral-400 sm:block">
        Next-epoch fee-demand forecast for {DISPLAY_PRESET.displayName} on {DISPLAY_PRESET.networkName} — reward
        where demand is going, not where it was.
      </p>
      {paStatus?.applicable && (
        <p className="mt-1 hidden text-xs text-neutral-500 sm:block">
          {paStatus.live
            ? "Predictive Allocation is live — the vote panel below now submits directly to it."
            : "Weekly gauge voting today; Dromos Labs' Predictive Allocation is expected to replace it — this forecast and your expected $ apply either way."}
        </p>
      )}

      {/* Secondary chrome: protocol switch, mechanism status, epoch progress,
          refresh. One scrollable line on a phone rather than five stacked
          pills competing with the bar above. */}
      <div className="mb-8 mt-3 flex items-center gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SIBLING_URL && (
          <a
            href={SIBLING_URL}
            className="shrink-0 rounded-lg border border-neutral-800 px-2.5 py-1 font-mono text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
          >
            switch to {SIBLING_PRESET.displayName}
          </a>
        )}
        {paStatus && <PaStatusChip status={paStatus} />}
        {snapshot && (
          <div className="shrink-0">
            <div className="mb-1 font-mono text-[11px] text-neutral-500">
              epoch {snapshot.epochProgressPct.toFixed(1)}% elapsed
            </div>
            <div className="h-1 w-32 rounded bg-neutral-800">
              <div className="h-full rounded bg-sky-600" style={{ width: `${snapshot.epochProgressPct}%` }} />
            </div>
          </div>
        )}
        <button
          onClick={() => loadAll(true)}
          disabled={loading}
          className="shrink-0 rounded-lg border border-neutral-800 px-2.5 py-1 font-mono text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-200 disabled:opacity-40"
        >
          {loading ? "loading…" : "refresh"}
        </button>
      </div>

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
          <div className="mb-5 flex gap-1 sm:hidden" role="tablist" aria-label="dashboard sections">
            {(
              [
                ["vote", "vote"],
                ["lp", "LP yield"],
                ["swings", "swings"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mobileTab === key}
                onClick={() => setMobileTab(key)}
                className={`flex-1 rounded-lg border px-3 py-2 font-mono text-xs ${
                  mobileTab === key
                    ? "border-sky-600 bg-sky-950/40 text-sky-300"
                    : "border-neutral-800 text-neutral-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <section className={`mb-10 sm:block ${onTab("vote")}`}>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-medium text-white">
                  Voter ROI <span className="text-xs font-normal text-neutral-500">dilution-aware split</span>
                </h2>
                <div className="flex flex-wrap items-center gap-2">
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
                  {currentVotes && (
                    <span
                      className="whitespace-nowrap font-mono text-[10px] text-emerald-400"
                      title="This amount was auto-filled from your connected veNFT's real voting balance, not typed in manually."
                    >
                      ✓ from wallet
                    </span>
                  )}
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
                  {/* The whole point of the page, at the size of the whole
                      point of the page — it used to be a footnote under the
                      rows (external review: "the punchline is ~$0.93 next
                      epoch and it's a footnote under a wall of TVL text").
                      Same number the summary quotes: the sum of the rows'
                      own post-dilution expected rewards. */}
                  <div className="mb-4">
                    <div className="font-mono text-3xl tabular-nums text-emerald-400 sm:text-4xl">
                      {usd(voterTotalExpectedUsd)}
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      expected next epoch for {votingPower.toLocaleString()} {DISPLAY_PRESET.veTokenSymbol} — your
                      voter $, not pool fees
                    </div>
                  </div>
                  <AllocationRows
                    allocations={voterAlloc.allocations}
                    color="bg-sky-500"
                    right={(a) => (
                      <span className="w-20 text-right font-mono text-xs text-emerald-400">
                        {a.expectedRewardUsd !== undefined ? `+${usd(a.expectedRewardUsd)}` : ""}
                      </span>
                    )}
                  />
                  {/* A short list here isn't a broken card — it's the gas
                      hurdle doing its job. Called out on its own, right under
                      the row(s), instead of leaving a visitor to read a short
                      list next to two full 8-row panels and assume something
                      failed (external review, live at 92 veAERO: "the card
                      then feels empty... give it a one-line state"). */}
                  {(voterAlloc.gasHurdleDroppedCount ?? 0) > 0 && (
                    <p className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-400">
                      Too small a slice to split further — {voterAlloc.gasHurdleDroppedCount} more pool
                      {voterAlloc.gasHurdleDroppedCount === 1 ? "" : "s"} cleared the reward floor but not the gas
                      hurdle at {votingPower.toLocaleString()} {DISPLAY_PRESET.veTokenSymbol}, so they're collapsed
                      here instead of split into for pennies each.
                    </p>
                  )}
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
          </section>

          <section className={`mb-10 sm:block ${onTab("vote")}`}>
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
            {/* One scrollable line on a phone, wrapping grid on desktop —
                seven chips plus a search box plus the mode toggle wrapped
                into three ragged rows and ate the top of the table
                (external review: "filters wrap into 3 messy rows"). */}
            <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-x-visible sm:pb-0 [&::-webkit-scrollbar]:hidden">
              <input
                type="text"
                value={poolSearch}
                onChange={(e) => setPoolSearch(e.target.value)}
                placeholder="search symbol…"
                className="w-36 shrink-0 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-sky-600 focus:outline-none"
              />
              {POOL_FILTER_CHIPS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPoolFilter(key)}
                  className={`shrink-0 rounded-lg border px-2.5 py-1 font-mono text-xs ${
                    poolFilter === key
                      ? "border-sky-600 bg-sky-950/40 text-sky-300"
                      : "border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
                  }`}
                >
                  {label}
                </button>
              ))}
              {/* A display-density toggle, not a filter — set apart (ml-auto,
                  its own color) from the category chips above so it doesn't
                  read as an eighth filter option. */}
              <button
                type="button"
                onClick={() => setVoteMode((v) => !v)}
                title={
                  voteMode
                    ? "Showing pool, predicted fees, trend, edge, $/1k votes, and confidence — last epoch and votes-vs-demand move into the row expand (▸). Click to show every column."
                    : "Showing every column. Click to collapse to the columns a voter needs, with the rest moved into the row expand (▸)."
                }
                className={`ml-auto shrink-0 rounded-lg border px-2.5 py-1 font-mono text-xs ${
                  voteMode
                    ? "border-emerald-700 bg-emerald-950/40 text-emerald-300"
                    : "border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
                }`}
              >
                vote mode
              </button>
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
                const expanded = expandedPool === p.lp;
                return (
                  <div
                    key={p.lp}
                    className={`rounded-lg border px-3 py-2.5 ${
                      thin ? "border-amber-900/60 bg-amber-950/10" : "border-neutral-800 bg-neutral-900/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate">
                        <button
                          type="button"
                          onClick={() => setExpandedPool(expanded ? null : p.lp)}
                          className="mr-1.5 inline-block w-3 text-center text-neutral-600 hover:text-neutral-300"
                          aria-label={`${expanded ? "collapse" : "expand"} ${p.symbol} fee history`}
                          aria-expanded={expanded}
                        >
                          {expanded ? "▾" : "▸"}
                        </button>
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
                    {expanded && (
                      <div className="mt-2 border-t border-neutral-800 pt-2">
                        <PoolExpandDetail p={p} thin={thin} voteMode={voteMode} />
                      </div>
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
                    {!voteMode && (
                      <SortHeader label="last epoch" sortKey="lastEpochFeesUsd" sort={poolSort} onSort={togglePoolSort} />
                    )}
                    <SortHeader
                      label="trend/epoch"
                      sortKey="feeTrendUsdPerEpoch"
                      sort={poolSort}
                      onSort={togglePoolSort}
                      title="Slope of a linear regression over trailing epochs, USD per epoch — not simply predicted minus last epoch, so it can point a different direction than that single-epoch comparison."
                    />
                    {!voteMode && <th className="px-4 py-2.5 text-right">votes vs demand</th>}
                    <SortHeader label="edge" sortKey="edgePct" sort={poolSort} onSort={togglePoolSort} />
                    <SortHeader label="$/1k votes" sortKey="rewardPer1kVotesUsd" sort={poolSort} onSort={togglePoolSort} />
                    <SortHeader label="conf" sortKey="confidence" sort={poolSort} onSort={togglePoolSort} />
                  </tr>
                </thead>
                <tbody>
                  {pools.map((p) => {
                    const thin = p.voteSharePct < 0.1;
                    const noHistory = p.lastEpochFeesUsd === 0;
                    const expanded = expandedPool === p.lp;
                    return (
                      <Fragment key={p.lp}>
                      <tr
                        className={`border-b border-neutral-800/60 last:border-0 hover:bg-neutral-900/40 ${
                          thin ? "bg-amber-950/10" : ""
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => setExpandedPool(expanded ? null : p.lp)}
                            className="mr-1.5 inline-block w-3 text-center text-neutral-600 hover:text-neutral-300"
                            aria-label={`${expanded ? "collapse" : "expand"} ${p.symbol} fee history`}
                            aria-expanded={expanded}
                          >
                            {expanded ? "▾" : "▸"}
                          </button>
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
                        {!voteMode && (
                          <td className="px-4 py-2.5 text-right font-mono text-neutral-400">{usd(p.lastEpochFeesUsd)}</td>
                        )}
                        <td className="px-4 py-2.5">
                          <TrendCell value={p.feeTrendUsdPerEpoch} />
                        </td>
                        {!voteMode && (
                          <td className="px-4 py-2.5 text-right font-mono text-neutral-300">
                            {thin ? (
                              <span className="text-amber-500">no votes yet</span>
                            ) : (
                              `${p.voteSharePct.toFixed(1)}%`
                            )}{" "}
                            → {p.demandSharePct.toFixed(1)}%
                          </td>
                        )}
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
                      {expanded && (
                        <tr className="border-b border-neutral-800/60 last:border-0 bg-neutral-950/40">
                          <td colSpan={voteMode ? 6 : 8} className="px-4 py-3">
                            <PoolExpandDetail p={p} thin={thin} voteMode={voteMode} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
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

          {/* Protocol efficiency and Edge hunter answer questions a voter
              didn't ask — one is the market-wide ideal, the other a
              mispricing scan for agents and treasuries. Equal billing next
              to Voter ROI read as "pick one of three" (external review:
              "showing all three equal-width tells a voter they failed a
              quiz"), so they collapse behind one line instead. */}
          <details className={`mb-10 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 sm:block sm:p-5 ${onTab("vote")}`}>
            <summary className="cursor-pointer list-none text-sm font-medium text-neutral-300">
              Other splits{" "}
              <span className="text-xs font-normal text-neutral-500">
                protocol efficiency · edge hunter — market-wide benchmarks, not a personal vote
              </span>
            </summary>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
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
            </div>
          </details>

          <section className={`mb-10 sm:block ${onTab("lp")}`}>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-400">
              LP staking yield {lpDeposits && <span className="text-neutral-600">({lpDeposits.rewardTokenSymbol} emissions, not fees)</span>}
            </h2>
            {lpThinCount > 0 && lpOpportunities.length > 0 && (
              <ThinLpToggle
                count={lpThinCount}
                shown={showThinLp}
                onToggle={() => setShowThinLp((s) => !s)}
                className="mb-3 -mt-1 block text-xs text-neutral-500 underline hover:text-neutral-300"
              />
            )}
            {/* Every remaining pool filtered out (routinely: all of them are
                thin) used to render as a heading, a one-line link, and a
                header-only table with nothing under it — indistinguishable
                from a failed fetch (external review: "LP block can look
                broken... looks like a failed fetch"). Say what happened and
                put the unhide control inside the same card. */}
            {lpOpportunities.length === 0 && (
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-6 text-center">
                <p className="text-sm text-neutral-400">
                  {lpThinCount > 0
                    ? `Nothing here worth staking into this epoch — all ${lpThinCount} ${DISPLAY_PRESET.displayName} pool${lpThinCount === 1 ? " is" : "s are"} too thin to mean anything (staked TVL under $50k, or an APR computed off too little TVL to be real).`
                    : "No LP staking opportunities in this snapshot."}
                </p>
                {lpThinCount > 0 && (
                  <ThinLpToggle
                    count={lpThinCount}
                    shown={showThinLp}
                    onToggle={() => setShowThinLp((s) => !s)}
                    className="mt-3 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-white"
                  />
                )}
              </div>
            )}
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
                    {/* Grouped with the trend indicator on the fixed right
                        edge, not trailing the symbol — inside the truncating
                        left div, a long symbol would either push the badge
                        off at a different spot per card or clip it into the
                        ellipsis outright. */}
                    <div className="flex shrink-0 items-center gap-2">
                      {isThinLpOpportunity(o) && <ThinLpBadge />}
                      <TrendCell value={o.emissionsTrendUsdPerEpoch} />
                    </div>
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
            <div
              className={`overflow-x-auto rounded-xl border border-neutral-800 ${
                lpOpportunities.length > 0 ? "hidden sm:block" : "hidden"
              }`}
            >
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
                      <td className="whitespace-nowrap px-4 py-2.5">
                        {/* min-width (not width) on the symbol+type span so the
                            "thin" badge column lines up down the table instead
                            of trailing wherever each row's own symbol happens
                            to end (spotted live: a ragged staircase of badges).
                            288px comfortably clears "CL200-USDC/BLUECHIP
                            concentrated" (the longest real symbol+type combo
                            measured live, ~254px) with room to spare — a
                            longer symbol still just grows past it and pushes
                            its own badge further right, rather than
                            overflowing into it. The first attempt at this
                            (min-w-52, 208px) was already narrower than most
                            rows' actual content, so it never bound anything —
                            confirmed live it left the badge just as ragged as
                            before. */}
                        <span className="inline-block min-w-72">
                          <a
                            href={poolAppLink("liquidity", o.pool)}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-neutral-100 hover:text-sky-400 hover:underline"
                          >
                            {o.symbol}
                          </a>
                          <span className="ml-2 font-mono text-xs text-neutral-500">{o.poolType}</span>
                        </span>
                        {isThinLpOpportunity(o) && <ThinLpBadge />}
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

          <section className={`mb-10 gap-6 sm:grid lg:grid-cols-2 ${mobileTab === "swings" ? "grid" : "hidden"}`}>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <h3 className="font-medium text-white">
                Vote swings <span className="text-xs font-normal text-neutral-500">risers</span>
              </h3>
              {/* Stated once here instead of on every card — the epoch
                  progress is identical across all of them, so repeating it
                  per row was pure scan noise (external review: "vote-swing
                  cards repeat the same sentence 10 times"). */}
              {voteSwings && (
                <p className="mb-3 mt-1 font-mono text-[11px] text-neutral-600">
                  vs each pool&rsquo;s normal trajectory at {voteSwings.epochProgressPct.toFixed(1)}% through the epoch
                </p>
              )}
              <div className="space-y-1.5">
                {voteSwings && voteSwings.risers.length > 0 ? (
                  voteSwings.risers.map((s) => <SwingRow key={s.pool} s={s} tone="riser" />)
                ) : (
                  <p className="text-sm text-neutral-500">No bribe pace anomalies right now.</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <h3 className="font-medium text-white">
                Vote swings <span className="text-xs font-normal text-neutral-500">fallers</span>
              </h3>
              {voteSwings && (
                <p className="mb-3 mt-1 font-mono text-[11px] text-neutral-600">
                  vs each pool&rsquo;s normal trajectory at {voteSwings.epochProgressPct.toFixed(1)}% through the epoch
                </p>
              )}
              <div className="space-y-1.5">
                {voteSwings && voteSwings.fallers.length > 0 ? (
                  voteSwings.fallers.map((s) => <SwingRow key={s.pool} s={s} tone="faller" />)
                ) : (
                  <p className="text-sm text-neutral-500">No pools running behind their normal vote pace.</p>
                )}
              </div>
            </div>
          </section>

          <section className={`mb-10 sm:block ${onTab("swings")}`}>
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

          <footer className="mt-10 border-t border-neutral-800 pt-4 text-xs text-neutral-500">
            <p className="mb-2">
              Or skip the UI — ask an agent:{" "}
              <span className="font-mono text-neutral-400">
                &quot;recommend a voter_roi allocation for my veAERO&quot;
              </span>
              . MCP server (free, self-hosted) or the x402 API (5¢/call, no setup) — same tools, same numbers,
              see{" "}
              <a
                href="https://github.com/Hryhorii77/aero-allocator"
                target="_blank"
                rel="noreferrer"
                className="text-sky-500 hover:text-sky-400"
              >
                the repo
              </a>
              .
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
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
            </div>
          </footer>
        </>
      )}
    </main>
  );
}
