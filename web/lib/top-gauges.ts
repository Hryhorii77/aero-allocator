import type { GaugeFees } from "./gauge-fees-read";
import { aprPct, incentiveEndText, isSteadiest, paceLabel, rankByUsdPerDay, steadyLabel, type PaceLabel } from "./gauge-yield";
import { gaugeLabel, type GaugeRow } from "./gauges";
import { lowUsdPerDayOf } from "./projection";
import { DEFAULT_COOLDOWN_SEC, waitHours } from "./saero";

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 25;

export interface TopGauge {
  gauge: string;
  label: string;
  /** What `amount` would earn per day in this gauge alone, after it joins the power already there. */
  usdPerDay: number;
  /** The same with fees at the low case (the gauge's usual level, or cut by its paying share) and incentives only until their program ends. */
  lowUsdPerDay: number;
  aprPct: number | null;
  feesUsdPerDay: number;
  incentivesUsdPerDay: number;
  /** Power already in the gauge, whole tokens. */
  weight: number;
  pace: PaceLabel;
  /** Hours of fee history the pace rests on. */
  historyHours: number;
  /** Paying half-days out of complete half-days, or "incentives" when incentives are at least half of the gauge's income; null when unknown. */
  steady: string | null;
  steadiest: boolean;
  /** For example "incentives end in 10 h", when some incentives stop inside the wait. */
  incentivesNote: string | null;
}

export interface TopGauges {
  chainId: number;
  amount: number;
  /** Hours of the wait between allocations the low case looks across. */
  waitHours: number;
  /** AERO's USD price when known (APR needs it). */
  aeroUsd: number | null;
  generatedAt: number;
  gauges: TopGauge[];
}

/** The ranked table the page shows, for one chain and amount: the top gauges by what the amount earns per day. Read-only; same rules as the page. */
export function topGauges(
  chainId: number,
  gauges: GaugeRow[],
  fees: GaugeFees,
  amount: number,
  limit: number,
  cooldownSec: number | undefined,
  nowSec: number,
): TopGauges {
  const waitSec = cooldownSec ?? DEFAULT_COOLDOWN_SEC;
  const aeroUsd = fees.aeroUsd ?? null;
  const rows = rankByUsdPerDay(gauges, fees.fees, amount, undefined, { nowSec, waitSec }).slice(0, Math.max(1, Math.min(limit, MAX_LIMIT)));
  const byGauge = new Map(gauges.map((g) => [g.gauge.toLowerCase(), g]));
  return {
    chainId,
    amount,
    waitHours: waitHours(waitSec),
    aeroUsd,
    generatedAt: fees.generatedAt,
    gauges: rows.map((y) => {
      const s = steadyLabel(y);
      const g = byGauge.get(y.gauge.toLowerCase());
      return {
        gauge: y.gauge,
        label: g ? gaugeLabel(g) : y.symbol,
        usdPerDay: Number(y.usdPerDay.toFixed(4)),
        lowUsdPerDay: Number(lowUsdPerDayOf(y).toFixed(4)),
        aprPct: aprPct(y.usdPerDay, amount, aeroUsd) === null ? null : Number(aprPct(y.usdPerDay, amount, aeroUsd)!.toFixed(2)),
        feesUsdPerDay: Number(y.feesUsdPerDay.toFixed(2)),
        incentivesUsdPerDay: Number(y.incentivesUsdPerDay.toFixed(2)),
        weight: Math.round(y.weight),
        pace: paceLabel(y),
        historyHours: Number(y.windowHours.toFixed(1)),
        steady: !s ? null : s.kind === "incentives" ? (s.endsSoon ? "incentives (ending)" : "incentives") : `${s.paying}/${s.buckets}`,
        steadiest: isSteadiest(y),
        incentivesNote: incentiveEndText(y, nowSec, waitSec),
      };
    }),
  };
}
