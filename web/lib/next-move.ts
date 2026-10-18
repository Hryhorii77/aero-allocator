// The single recommendation on the phone Overview. Pure so it can be tested against fixed clocks.

/** Aero's Upgrade Hub: final classic voting closes Oct 21 2026, 22:59 UTC. */
export const AERO_FINAL_VOTE_CLOSE_MS = Date.UTC(2026, 9, 21, 22, 59, 0);

export interface NextMove {
  title: string;
  body: string;
  /** Which tab the button opens; null when there is nothing to open. */
  go: "vote" | "more" | null;
  cta: string | null;
  /** warn = a deadline is close (amber); info = the normal case. */
  tone: "info" | "warn";
}

export function nextBestMove(input: {
  nowMs: number;
  /** Aerodrome only; Velodrome has no launch cut-over. */
  launchAtMs: number | null;
  /** null while no wallet or address lookup has been loaded. */
  hasVotedThisEpoch: boolean | null;
}): NextMove {
  const { nowMs, launchAtMs, hasVotedThisEpoch } = input;
  if (launchAtMs !== null && nowMs >= launchAtMs) {
    return {
      title: "Weekly voting has ended",
      body: "Aero replaced the weekly vote with continuous allocation. The numbers here describe the old gauge vote.",
      go: null,
      cta: null,
      tone: "info",
    };
  }
  const hoursLeft = launchAtMs !== null ? (AERO_FINAL_VOTE_CLOSE_MS - nowMs) / 3_600_000 : Infinity;
  if (hoursLeft <= 48) {
    return {
      title: hoursLeft > 0 ? "Final vote closes soon" : "Final vote has closed",
      body:
        hoursLeft > 0
          ? "Cast or copy your weights, then claim rewards and rebases and reset your votes before upgrading to sAERO. Unclaimed ones can't be recovered."
          : "Claim rewards and rebases and reset your votes before upgrading to sAERO. Unclaimed ones can't be recovered.",
      go: hoursLeft > 0 ? "vote" : null,
      cta: hoursLeft > 0 ? "see the split" : null,
      tone: "warn",
    };
  }
  if (hasVotedThisEpoch === false) {
    return {
      title: "You haven't voted this epoch",
      body: "Copy the recommended split and vote before the epoch closes.",
      go: "vote",
      cta: "see the split",
      tone: "info",
    };
  }
  return {
    title: "Check the split before the epoch closes",
    body: "Forecasts move as votes come in. Review the recommended split, then vote on Aerodrome.",
    go: "vote",
    cta: "see the split",
    tone: "info",
  };
}
