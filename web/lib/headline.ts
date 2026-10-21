// Shared by the dashboard headline and the share-card image, so the two can
// never quote different numbers for the same position.

export const HEADLINE_FORECAST_CAP_MULTIPLE = 3;

/**
 * Headline sanity check. The forecast ($ after dilution) can be wildly
 * optimistic early in the epoch, when few votes are in; the realized-rate
 * estimate (each pool's last-epoch $/1k x the votes allocated there) can't.
 * If the forecast exceeds the realized figure by more than a few times, lead
 * with the realized number and show the forecast only as an upper bound.
 */
export function headlineEstimate(
  rows: Array<{ votesAllocated?: number; rewardPer1kVotesUsd?: number }>,
  forecastUsd: number,
): { headlineUsd: number; realizedUsd: number | null; forecastUsd: number; forecastIsUpperBound: boolean } {
  const priced = rows.filter((r) => r.votesAllocated !== undefined && r.rewardPer1kVotesUsd !== undefined);
  const realizedUsd =
    priced.length === rows.length && rows.length > 0
      ? priced.reduce((s, r) => s + (r.rewardPer1kVotesUsd as number) * ((r.votesAllocated as number) / 1000), 0)
      : null;
  const forecastIsUpperBound =
    realizedUsd !== null && realizedUsd > 0 && forecastUsd > realizedUsd * HEADLINE_FORECAST_CAP_MULTIPLE;
  return {
    headlineUsd: forecastIsUpperBound ? (realizedUsd as number) : forecastUsd,
    realizedUsd,
    forecastUsd,
    forecastIsUpperBound,
  };
}

/**
 * What your own votes cost you: the same split's expected reward if it didn't
 * move the pools it votes into ("$146") against the post-dilution figure
 * ("$123"). Null when rows lack the number or the gap is under 2%, where it
 * would only be noise.
 */
export function dilutionCost(
  rows: Array<{ expectedRewardUsd?: number; undilutedRewardUsd?: number }>,
): { undilutedUsd: number; dilutedUsd: number; lossPct: number } | null {
  if (rows.length === 0 || rows.some((r) => r.expectedRewardUsd === undefined || r.undilutedRewardUsd === undefined)) {
    return null;
  }
  const dilutedUsd = rows.reduce((s, r) => s + (r.expectedRewardUsd as number), 0);
  const undilutedUsd = rows.reduce((s, r) => s + (r.undilutedRewardUsd as number), 0);
  if (undilutedUsd <= 0) return null;
  const lossPct = ((undilutedUsd - dilutedUsd) / undilutedUsd) * 100;
  return lossPct >= 2 ? { undilutedUsd, dilutedUsd, lossPct } : null;
}
