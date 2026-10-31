import type { GaugeRow } from "./gauges";
import { MIN_RANK_WEIGHT } from "./gauge-yield";

/** Per chain, how many gauges the page can rank: activated and holding at least MIN_RANK_WEIGHT power (thinner ones show a dash). */
export interface ChainCount {
  chainId: number;
  ranked: number;
}

export const rankableCount = (gauges: Pick<GaugeRow, "activated" | "weight">[]): number => gauges.filter((g) => g.activated && g.weight >= MIN_RANK_WEIGHT).length;
