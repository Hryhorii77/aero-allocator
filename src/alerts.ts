/**
 * "Your #1 pool just ate 2x the votes" / "its edge flipped" — the two things
 * that should pull a voter back to the page before the epoch locks. Pure
 * comparison of two observations of the same watch list; fetching, state
 * storage and the Discord post live in scripts/vote-alerts.ts.
 *
 * Deliberately conservative: an alert that fires every run trains people to
 * mute the channel. So it only compares within one epoch (the first run of a
 * new epoch has nothing to compare against), ignores pools with no earlier
 * observation, and ignores movement too small to matter.
 */
export interface WatchedPool {
  pool: string;
  symbol: string;
  /** 1 = the biggest slice of the watcher's own split. */
  rank: number;
  /** Votes currently on the pool's gauge (veAERO units). */
  votes: number;
  /** Predicted demand share minus current vote share, in percentage points. */
  edgePct: number;
}

export interface AlertState {
  epochStart: number;
  takenAt: string;
  pools: WatchedPool[];
}

export interface Alert {
  kind: "votes_surge" | "edge_flipped";
  pool: string;
  symbol: string;
  rank: number;
  text: string;
}

export interface AlertOptions {
  /** Votes must reach at least this multiple of the previous reading. */
  surgeRatio?: number;
  /** ...and have grown by at least this many veAERO, so 3 → 7 votes on a dust gauge stays quiet. */
  minVoteIncrease?: number;
  /** Edge must cross zero by more than this (pp) on both sides — same deadband the dashboard's edge badge uses, so +0.02 → −0.02 isn't a "flip". */
  edgeDeadbandPp?: number;
}

const DEFAULTS: Required<AlertOptions> = { surgeRatio: 2, minVoteIncrease: 10_000, edgeDeadbandPp: 0.05 };

const num = (x: number) => Math.round(x).toLocaleString("en-US");
const pp = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(2)}pp`;

export function detectAlerts(prev: AlertState | null, curr: AlertState, opts: AlertOptions = {}): Alert[] {
  if (!prev || prev.epochStart !== curr.epochStart) return [];
  // An option passed as `undefined` (an unset env var upstream) must mean
  // "use the default", not overwrite it — a plain spread lets it do the
  // latter, which turned `votes - was >= undefined` into a silent never-alert.
  const { surgeRatio, minVoteIncrease, edgeDeadbandPp } = {
    ...DEFAULTS,
    ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)),
  } as Required<AlertOptions>;
  const before = new Map(prev.pools.map((p) => [p.pool.toLowerCase(), p]));

  const alerts: Alert[] = [];
  for (const now of curr.pools) {
    const was = before.get(now.pool.toLowerCase());
    if (!was) continue;
    const who = now.rank === 1 ? `${now.symbol} (#1 in your split)` : `${now.symbol} (#${now.rank} in your split)`;

    if (now.votes - was.votes >= minVoteIncrease && now.votes >= was.votes * surgeRatio) {
      const times = was.votes > 0 ? `${(now.votes / was.votes).toFixed(1)}x` : "far more";
      alerts.push({
        kind: "votes_surge",
        pool: now.pool,
        symbol: now.symbol,
        rank: now.rank,
        text: `${who} took ${times} its votes since the last check (${num(was.votes)} → ${num(now.votes)} ve) — each vote there now earns less.`,
      });
    }

    const flippedDown = was.edgePct > edgeDeadbandPp && now.edgePct < -edgeDeadbandPp;
    const flippedUp = was.edgePct < -edgeDeadbandPp && now.edgePct > edgeDeadbandPp;
    if (flippedDown || flippedUp) {
      alerts.push({
        kind: "edge_flipped",
        pool: now.pool,
        symbol: now.symbol,
        rank: now.rank,
        text:
          `${who} edge flipped ${pp(was.edgePct)} → ${pp(now.edgePct)} — ` +
          (flippedDown ? "it's now over-incentivized versus predicted demand." : "it's now under-incentivized versus predicted demand."),
      });
    }
  }
  // #1 first: it's the one that costs the most if you miss it.
  return alerts.sort((a, b) => a.rank - b.rank);
}

/** The slice of /api/dashboard's response the watcher reads — its own voter_roi split is the watch list. */
export interface DashboardPayloadForAlerts {
  epochStart: number;
  generatedAt: number;
  voterAlloc: {
    allocations: Array<{ pool: string; symbol: string; weightPct: number; currentVotes: number; predictiveEdgePct: number }>;
  };
}

export function alertStateFromDashboard(payload: DashboardPayloadForAlerts): AlertState {
  const ranked = [...payload.voterAlloc.allocations].sort((a, b) => b.weightPct - a.weightPct);
  return {
    epochStart: payload.epochStart,
    takenAt: new Date(payload.generatedAt).toISOString(),
    pools: ranked.map((a, i) => ({
      pool: a.pool,
      symbol: a.symbol,
      rank: i + 1,
      votes: a.currentVotes,
      edgePct: a.predictiveEdgePct,
    })),
  };
}
