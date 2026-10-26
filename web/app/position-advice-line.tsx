"use client";

import { useEffect, useState } from "react";
import { gaugeLabel, type GaugeList } from "@/lib/gauges";
import type { GaugeFees } from "@/lib/gauge-fees-read";
import { opportunityLine } from "@/lib/opportunity";
import { analysePosition } from "@/lib/position-advice";
import { DEFAULT_COOLDOWN_SEC, type SaeroPosition } from "@/lib/saero";
import { readCurrent } from "./saero-allocate";
import { NOTE } from "./ui";

/**
 * One line under a position: what it earns where it sits, what the best split would earn, and so what staying costs per day. The
 * gauge and fee reads carry no address; where the position sits is read from the chain in this browser. Says nothing when any read
 * fails, so the card never shows a made-up number.
 */
export function PositionAdviceLine({ position, onCost }: { position: SaeroPosition; onCost: (tokenId: bigint, usdPerDay: number) => void }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [g, f] = await Promise.all([
        fetch("/api/gauges").then((r) => (r.ok ? (r.json() as Promise<GaugeList>) : Promise.reject(new Error(String(r.status))))),
        fetch("/api/gauge-fees").then((r) => (r.ok ? (r.json() as Promise<GaugeFees>) : Promise.reject(new Error(String(r.status))))),
      ]);
      const symbolOf = (a: string) => {
        const x = g.gauges.find((y) => y.gauge.toLowerCase() === a.toLowerCase());
        return x ? gaugeLabel(x) : `${a.slice(0, 6)}…`;
      };
      const current = await readCurrent(position.tokenId, symbolOf);
      if (cancelled) return;
      const analysis = analysePosition({ position, current, gauges: g, fees: f, cooldownSec: DEFAULT_COOLDOWN_SEC, nowSec: Math.floor(Date.now() / 1000) });
      const line = opportunityLine(analysis);
      setText(line.text);
      onCost(position.tokenId, line.costUsdPerDay);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [position, onCost]);

  return text ? <p className={`mt-2 ${NOTE}`}>{text}</p> : null;
}
