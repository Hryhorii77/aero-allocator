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
    date: "2026-10-24",
    title:
      "The old weekly-vote pages and APIs are gone, and Velodrome with them (it merged into Aero), so the site and its code are only about sAERO. For AI agents there are now two pay-per-call endpoints (USDC on Base, x402): the position check ($0.05: a position's power, lock, cooldown, what it earns now against the best split for its size, and a stay / switch / allocate verdict) and the allocation plan ($0.10: the unsigned allocate transaction for that split, already simulated as the owner; it never signs or sends). Nothing is charged for a bad request, and no switch is advised on under 6 hours of fee history. A plain-text /llms.txt describes the free and paid endpoints for agents. Allocating to another chain now first shows a read-only quote of the ETH it needs (the transaction itself is still Base only). Shared links now carry a version number and a canonical address, so X shows the current sAERO card instead of an old one, and the fee figures say how fresh they are.",
  },
  {
    date: "2026-10-23",
    title:
      "The gauge list is now one aligned table (what your amount earns per day, fees, incentives, power in the gauge and how steady the fee pace is; sortable), built phone-first: two columns on a phone, the rest under the pool name. The amount and address boxes now say what is wrong as you type, and text is larger and consistent across the page. Each pool now shows its kind (CL10, CL100, stable, volatile…) and current fee, and its name links to the pool contract, so same-named pools can be told apart. A sticky bar at the top jumps between the gauge table, your positions and the upgrade guide. Each gauge and the best split now also show an estimated APR (what the figure comes to over a year against your amount at AERO's price). Light mode is easier to read: warning, green, blue and red text and the edges of boxes and buttons were too pale and are now darker. Fee estimates, $/day and APR now also cover Arbitrum, Ink and Robinhood Chain (with a day of history from the start); only gauges that released fees more than once are measurable, so many still show a dash. A position with power on Base gauges now has a \"return to idle…\" button that takes it all back to idle in one transaction (needed before withdrawing an expired lock), and a rejected allocation now says why in plain words, for example that the 47-hour wait isn't over. Picking another chain now also shows what Aero charges to send power there, in ETH on Base, read live from Aero's own contract.",
  },
  {
    date: "2026-10-23",
    title:
      "The page is now only about sAERO. The retired weekly-vote sections are gone (the vote split, the pool forecast tables, bribes, the vote clock and the snapshot chip), so there is no $0 forecast to puzzle over. The gauge ranking comes first, then your positions and the allocate button.",
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
