"use client";

import { useState } from "react";
import { AERO_CHAINS } from "@/lib/aero-chains";
import { combinePositions, type EarnedAll, type EarnedWallet } from "@/lib/earned";
import { readEarnedAll } from "@/lib/earned-read";
import { btn, NOTE, NUM } from "./ui";

const usd = (n: number) => (n >= 0.01 || n === 0 ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "<0.01");
/** Positions read at once: each one reads all seven chains, and the public nodes rate-limit bursts. */
export const WALLET_READ_CONCURRENCY = 2;

/**
 * One button for the whole wallet: reads, in this browser, every position's unclaimed fees and incentives on every chain (a couple of
 * positions at a time) and adds them up, so an owner of many positions doesn't press "show earnings so far" on each one and sum by hand.
 */
export function EarnedWalletTotal({ tokenIds }: { tokenIds: bigint[] }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [done, setDone] = useState(0);
  const [got, setGot] = useState<EarnedWallet | null>(null);

  const load = async () => {
    setState("loading");
    setDone(0);
    const results: Array<{ tokenId: bigint; all: EarnedAll | null }> = [];
    let next = 0;
    const worker = async () => {
      while (next < tokenIds.length) {
        const tokenId = tokenIds[next++];
        let all: EarnedAll | null = null;
        try {
          all = await readEarnedAll(tokenId);
          if (all.chains.length === 0 && all.skipped.length === AERO_CHAINS.length) all = null; // nothing could be read
        } catch {
          all = null;
        }
        results.push({ tokenId, all });
        setDone((d) => d + 1);
      }
    };
    await Promise.all(Array.from({ length: Math.min(WALLET_READ_CONCURRENCY, tokenIds.length) }, worker));
    const w = combinePositions(results);
    if (w.positions.length === 0) {
      setState("error");
      return;
    }
    setGot(w);
    setState("done");
  };

  if (state === "idle" || state === "loading") {
    return (
      <button type="button" onClick={load} disabled={state === "loading"} className={`mt-3 ${btn("secondary", "sm")}`}>
        {state === "loading" ? `reading ${Math.min(done + 1, tokenIds.length)} of ${tokenIds.length}…` : `show earnings for all ${tokenIds.length} positions`}
      </button>
    );
  }
  if (state === "error" || !got) return <p className="mt-3 text-sm text-rose-400">Couldn&rsquo;t read the earnings. Try again in a moment.</p>;
  const notRead = [
    got.failed.length ? `positions ${got.failed.map((t) => `#${t}`).join(", ")}` : "",
    got.skipped.length ? `${got.skipped.join(", ")} for some positions` : "",
  ].filter(Boolean);
  return (
    <div className="mt-3 rounded-lg border border-neutral-800 px-3 py-3 text-sm text-neutral-400">
      <p>
        Unclaimed across all {tokenIds.length} positions:{" "}
        <span className={`font-semibold text-emerald-400 ${NUM}`}>
          {got.atLeast ? "at least " : ""}${usd(got.totalUsd)}
        </span>
      </p>
      {got.chains.length > 0 && (
        <p className="mt-1">
          {got.chains.map((c, i) => (
            <span key={c.chainId}>
              {i > 0 ? " · " : ""}
              {c.name}: <span className={`text-neutral-200 ${NUM}`}>${usd(c.totalUsd)}</span>
            </span>
          ))}
        </p>
      )}
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
        {got.positions.map((p) => (
          <li key={p.tokenId.toString()}>
            <span className={`text-neutral-300 ${NUM}`}>#{p.tokenId.toString()}</span>:{" "}
            <span className={`text-neutral-200 ${NUM}`}>
              {p.atLeast ? "≥ " : ""}${usd(p.totalUsd)}
            </span>
          </li>
        ))}
      </ul>
      <p className={`mt-1 ${NOTE}`}>
        Fees and incentives on the gauges each position sits on now, on every chain; anything left unclaimed on gauges they have since left is
        not counted. Claim on Aero.{notRead.length ? ` Not read just now: ${notRead.join("; ")}.` : ""}
      </p>
    </div>
  );
}
