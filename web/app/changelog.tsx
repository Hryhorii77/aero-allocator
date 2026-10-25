import { LINK } from "./ui";

// Plain-language shipped-feature log, newest first — hand-curated from real
// commits (not every commit; internal refactors/test-only changes are left
// out) so users can see the dashboard is actively maintained without digging
// through GitHub history themselves.
//
// Kept to the last two ship days only. The point of this panel is "this
// thing is alive", which the newest entries make just as well as eighteen of
// them — and eighteen made it a wall of text nobody finishes. Anything older
// is a commit away via the link at the foot of the panel; trimmed entries stay
// in git history, so nothing is actually lost by pruning here. When a third
// ship day lands, drop the oldest day's entries.
const CHANGELOG: Array<{ date: string; title: string }> = [
  {
    date: "2026-10-26",
    title:
      "The positions panel now explains how to move more often than every 47 hours, from a check on Base: the wait belongs to each position, not to your wallet, and a position that has never been allocated has none, so holding AERO as several separate positions lets you move one while the others wait. An existing position can't be split (Aero's escrow has no split function), and every allocation is its own transaction with its own gas. A position with no AERO staked (for example the key left behind after depositing into an Aero Autopilot) now says there is nothing to allocate instead of offering the allocate button, and the gauge table repeats Aero's advice to judge allocation over a long horizon, since 47-hour results are noisy.",
  },
  {
    date: "2026-10-25",
    title:
      "The gauge table now shows where power is moving: a \"power flow\" column and a line above the table naming the gauges gaining and losing the most share of the allocation weight over the last day. It compares shares, so the slow drop from expiring locks doesn't count. The page now takes a snapshot of every gauge's weight every 30 minutes, so the figures appear once there are two hours of history and get better each day. A gauge that is filling up earns less per unit of power; the column shows where power went, not where it will go. Each gauge row now has a \"history\" link that opens a small chart of the fees it released every 6 hours (and its power, as snapshots build up), and a new \"Steady\" column says in how many of the last half-days it paid at least half its average, so you can sort for the steadiest gauges instead of only the top earners (a gauge paid mostly by incentives, which stream at a fixed rate, says \"incentives\" instead). Gauges whose incentives have just appeared are now flagged with the amount per week and how recently, since the first to allocate get the best rate before power joins. A position that is still waiting out its 47 hours now has a \"remind me\" link that saves a calendar event for the moment it can be re-allocated (made in your browser, nothing is sent anywhere), and the history chart shows its tallest bar and a clearer start time.",
  },
];

export function ChangelogPanel() {
  return (
    <details className="mt-4 rounded-xl border border-neutral-800 px-3 py-3 sm:px-5">
      <summary className="cursor-pointer select-none text-sm font-medium text-neutral-300">
        what&apos;s new
      </summary>
      <ul className="mt-3 space-y-2">
        {CHANGELOG.map((entry) => (
          <li key={entry.date + entry.title} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
            <span className="shrink-0 text-xs text-neutral-500 sm:w-24">{entry.date}</span>
            <span className="text-sm leading-relaxed text-neutral-400">{entry.title}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-neutral-500">
        Older changes live in the{" "}
        <a
          href="https://github.com/Hryhorii77/aero-allocator/commits/main"
          target="_blank"
          rel="noreferrer"
          className={LINK}
        >
          commit history
        </a>
        .
      </p>
    </details>
  );
}
