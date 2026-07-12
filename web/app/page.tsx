"use client";

import { useCallback, useEffect, useState } from "react";
import { ConnectButton, VotePanel } from "./wallet";

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

interface Snapshot {
  generatedAt: number;
  epochStart: number;
  epochProgressPct: number;
  pools: PoolRow[];
}

interface Allocation {
  objective: string;
  summary: string;
  votingPowerVe?: number;
  allocations: Array<{
    pool: string;
    symbol: string;
    weightPct: number;
    currentVoteSharePct: number;
    predictedDemandSharePct: number;
    expectedRewardUsd?: number;
    confidence: number;
  }>;
}

const usd = (n: number) =>
  n >= 1000 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

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
  return (
    <div className="h-1.5 w-14 rounded bg-neutral-800" title={`confidence ${value}`}>
      <div
        className={`h-full rounded ${value >= 0.6 ? "bg-sky-500" : value >= 0.4 ? "bg-sky-700" : "bg-neutral-600"}`}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
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

export default function Dashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [voterAlloc, setVoterAlloc] = useState<Allocation | null>(null);
  const [protoAlloc, setProtoAlloc] = useState<Allocation | null>(null);
  const [votingPower, setVotingPower] = useState(10000);
  const [loading, setLoading] = useState(true);
  const [allocLoading, setAllocLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      // Snapshot first so the engine cache is warm, then both allocations reuse it.
      const snapRes = await fetch(`/api/snapshot${refresh ? "?refresh=1" : ""}`);
      if (!snapRes.ok) throw new Error(`snapshot: HTTP ${snapRes.status}`);
      setSnapshot(await snapRes.json());
      const [v, p] = await Promise.all([
        fetch(`/api/allocation?objective=voter_roi&votingPower=${votingPower}`).then((r) => r.json()),
        fetch(`/api/allocation?objective=protocol_efficiency`).then((r) => r.json()),
      ]);
      setVoterAlloc(v);
      setProtoAlloc(p);
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

  const recomputeVoter = async () => {
    setAllocLoading(true);
    try {
      const res = await fetch(`/api/allocation?objective=voter_roi&votingPower=${votingPower}`);
      setVoterAlloc(await res.json());
    } finally {
      setAllocLoading(false);
    }
  };

  const pools = snapshot?.pools.filter((p) => p.predictedFeesUsd > 0).slice(0, 20) ?? [];

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Aero <span className="text-sky-400">Allocator</span>
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            Next-epoch fee-demand forecast for Aerodrome on Base — reward where demand is going, not where it was.
          </p>
        </div>
        <div className="flex items-center gap-4">
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
            Building live snapshot from Base — scanning ~34k pools and 8 epochs of history.
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
                    <th className="px-4 py-2.5 text-right">predicted fees</th>
                    <th className="px-4 py-2.5 text-right">last epoch</th>
                    <th className="px-4 py-2.5 text-right">trend/epoch</th>
                    <th className="px-4 py-2.5 text-right">votes vs demand</th>
                    <th className="px-4 py-2.5 text-right">edge</th>
                    <th className="px-4 py-2.5 text-right">$/1k votes</th>
                    <th className="px-4 py-2.5">conf</th>
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
                        ${p.rewardPer1kVotesUsd.toFixed(2)}
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
              under-incentivized relative to where trading demand is heading.
            </p>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-medium text-white">
                  Voter ROI <span className="text-xs font-normal text-neutral-500">dilution-aware optimal split</span>
                </h3>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={votingPower}
                    onChange={(e) => setVotingPower(Number(e.target.value))}
                    className="w-28 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-right font-mono text-sm text-neutral-200 focus:border-sky-600 focus:outline-none"
                  />
                  <span className="text-xs text-neutral-500">veAERO</span>
                  <button
                    onClick={recomputeVoter}
                    disabled={allocLoading}
                    className="rounded-lg bg-sky-600 px-3 py-1 text-sm text-white hover:bg-sky-500 disabled:opacity-40"
                  >
                    {allocLoading ? "…" : "recompute"}
                  </button>
                </div>
              </div>
              {voterAlloc && (
                <>
                  <div className="space-y-2.5">
                    {voterAlloc.allocations.map((a) => (
                      <div key={a.pool} className="flex items-center gap-3">
                        <span className="w-44 truncate text-sm text-neutral-200" title={a.symbol}>
                          {a.symbol}
                        </span>
                        <WeightBar pct={a.weightPct} color="bg-sky-500" />
                        <span className="w-14 text-right font-mono text-sm text-neutral-100">
                          {a.weightPct.toFixed(1)}%
                        </span>
                        <span className="w-20 text-right font-mono text-xs text-emerald-400">
                          {a.expectedRewardUsd !== undefined ? `+${usd(a.expectedRewardUsd)}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 border-t border-neutral-800 pt-3 text-xs leading-relaxed text-neutral-400">
                    {voterAlloc.summary}
                  </p>
                  <VotePanel allocations={voterAlloc.allocations} />
                </>
              )}
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
              <h3 className="mb-4 font-medium text-white">
                Protocol efficiency{" "}
                <span className="text-xs font-normal text-neutral-500">allocate ∝ predicted demand</span>
              </h3>
              {protoAlloc && (
                <>
                  <div className="space-y-2.5">
                    {protoAlloc.allocations.map((a) => (
                      <div key={a.pool} className="flex items-center gap-3">
                        <span className="w-44 truncate text-sm text-neutral-200" title={a.symbol}>
                          {a.symbol}
                        </span>
                        <WeightBar pct={a.weightPct} color="bg-violet-500" />
                        <span className="w-14 text-right font-mono text-sm text-neutral-100">
                          {a.weightPct.toFixed(1)}%
                        </span>
                        <span className="w-20 text-right font-mono text-xs text-neutral-500">
                          now {a.currentVoteSharePct.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 border-t border-neutral-800 pt-3 text-xs leading-relaxed text-neutral-400">
                    {protoAlloc.summary}
                  </p>
                </>
              )}
            </div>
          </section>

          <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-800 pt-4 text-xs text-neutral-500">
            <span>
              Live data: Aerodrome Sugar contracts on Base + DefiLlama prices · snapshot{" "}
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
