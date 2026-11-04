"use client";

import { useState } from "react";
import { AERO_CHAINS } from "@/lib/aero-chains";
import type { EarnedAll, EarnedLine, EarnedSummary } from "@/lib/earned";
import { readEarnedAll } from "@/lib/earned-read";
import { LINK, NOTE, NUM } from "./ui";

const usd = (n: number) => (n >= 0.01 || n === 0 ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "<0.01");
const amount = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 2 : 6 });
const tokens = (lines: EarnedLine[]) => lines.map((l) => `${amount(l.amount)} ${l.symbol}`).join(", ");

function Part({ label, s }: { label: string; s: EarnedSummary }) {
  if (s.lines.length === 0) return null;
  return (
    <span>
      {label}{" "}
      <span className={`text-neutral-200 ${NUM}`}>
        {s.unpriced ? "≥ " : ""}${usd(s.totalUsd)}
      </span>{" "}
      <span className="text-neutral-500">({tokens(s.lines)})</span>
    </span>
  );
}

/**
 * A button that, once pressed, reads in this browser what the position has earned and not claimed on every Aero chain: fees and
 * incentives on the gauges it sits on now. Nothing about the position leaves the browser; claiming itself is done on Aero.
 */
export function EarnedFees({ tokenId }: { tokenId: bigint }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [got, setGot] = useState<EarnedAll | null>(null);

  const load = async () => {
    setState("loading");
    try {
      const all = await readEarnedAll(tokenId);
      if (all.chains.length === 0 && all.skipped.length === AERO_CHAINS.length) throw new Error("every chain failed");
      setGot(all);
      setState("done");
    } catch {
      setState("error");
    }
  };

  if (state === "idle" || state === "loading") {
    return (
      <button type="button" onClick={load} disabled={state === "loading"} className={`mt-2 text-sm underline underline-offset-2 disabled:opacity-60 ${LINK}`}>
        {state === "loading" ? "reading earnings on every chain…" : "show earnings so far"}
      </button>
    );
  }
  if (state === "error" || !got) return <p className="mt-2 text-sm text-rose-400">Couldn&rsquo;t read the earnings. Try again in a moment.</p>;
  const skipped = got.skipped.length > 0 ? ` Not read just now: ${got.skipped.join(", ")}.` : "";
  if (got.chains.length === 0) {
    return <p className={`mt-2 ${NOTE}`}>Nothing unclaimed on the gauges this position is on now.{skipped}</p>;
  }
  return (
    <div className="mt-2 text-sm text-neutral-400">
      <p>
        Unclaimed so far:{" "}
        <span className={`text-emerald-400 ${NUM}`}>
          {got.atLeast ? "at least " : ""}${usd(got.totalUsd)}
        </span>
      </p>
      <ul className="mt-1 space-y-0.5">
        {got.chains.map((c) => (
          <li key={c.chainId}>
            <span className="text-neutral-300">{c.name}:</span> <Part label="fees" s={c.fees} />
            {c.fees.lines.length > 0 && c.incentives.lines.length > 0 ? " · " : ""}
            <Part label="incentives" s={c.incentives} />
          </li>
        ))}
      </ul>
      <p className={`mt-1 ${NOTE}`}>
        Fees and incentives on the gauges it sits on now, on every chain; anything left unclaimed on gauges it has since left is not counted. Claim on Aero.
        {skipped}
      </p>
    </div>
  );
}
