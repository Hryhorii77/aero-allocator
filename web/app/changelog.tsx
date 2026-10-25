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
    date: "2026-10-25",
    title:
      "The gauge table now shows where power is moving: a \"power flow\" column and a line above the table naming the gauges gaining and losing the most share of the allocation weight over the last day. It compares shares, so the slow drop from expiring locks doesn't count. The page now takes a snapshot of every gauge's weight every 30 minutes, so the figures appear once there are two hours of history and get better each day. A gauge that is filling up earns less per unit of power; the column shows where power went, not where it will go. Each gauge row now has a \"history\" link that opens a small chart of the fees it released every 6 hours (and its power, as snapshots build up), and a new \"Steady\" column says in how many of the last half-days it paid at least half its average, so you can sort for the steadiest gauges instead of only the top earners.",
  },
  {
    date: "2026-10-24",
    title:
      "The old weekly-vote pages and APIs are gone, and Velodrome with them (it merged into Aero), so the site and its code are only about sAERO. For AI agents there are now two pay-per-call endpoints (USDC on Base, x402): the position check ($0.05: a position's power, lock, cooldown, what it earns now against the best split for its size, and a stay / switch / allocate verdict) and the allocation plan ($0.10: the unsigned allocate transaction for that split, already simulated as the owner; it never signs or sends). Nothing is charged for a bad request, and no switch is advised on under 6 hours of fee history. A plain-text /llms.txt describes the free and paid endpoints for agents. Allocating to another chain now first shows a read-only quote of the ETH it needs (the transaction itself is still Base only). Shared links now carry a version number and a canonical address, so X shows the current sAERO card instead of an old one, and the fee figures say how fresh they are.",
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
