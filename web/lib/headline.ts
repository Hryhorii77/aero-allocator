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
