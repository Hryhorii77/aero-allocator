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
    date: "2026-10-27",
    title:
      "For agents: /openapi.json now describes the free and paid APIs, and two agent skills are in the repo (re-allocate only when the gain is real and steady; check and prepare a veAERO to sAERO upgrade). Neither signs anything. Each position has a share card button: the link holds only its power rounded to two figures. The allocate panel now uses the wait read from the chain, the Upgrade guide no longer shows past dates, and small text is easier to read.",
  },
  {
    date: "2026-10-26",
    title:
      "Each position now says what staying costs per day, as a range from fees running light to today's pace, with a total. Gauges whose fee pace is a one-off burst are marked spiky and show their APR as a range, and the history chart gains a 90-day daily view. Positions can show their unclaimed fees, and explain how to move more often than every 47 hours.",
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
