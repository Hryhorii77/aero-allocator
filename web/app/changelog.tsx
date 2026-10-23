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
    date: "2026-10-23",
    title:
      "The page is now only about sAERO. The retired weekly-vote sections are gone (the vote split, the pool forecast tables, bribes, the vote clock and the snapshot chip), so there is no $0 forecast to puzzle over. The gauge ranking comes first, then your positions and the allocate button.",
  },
  {
    date: "2026-10-22",
    title:
      "Aero is live. Weekly voting has ended, so the page now says so, and a new panel reads your sAERO positions straight from Aero's Base contracts in your browser: size, lock end, how much is allocated and when each position can next be allocated (47 hours after its last allocation). Below it, all 270 Base gauges of the new system with the share of allocation weight each holds, its emission cap per week and the incentives streaming to it. It also ranks gauges by what an amount of sAERO would earn per day (fees at the last ~5 hours' pace plus incentives, after your own dilution), dropping gauges whose fee pace can't be measured safely. Connected to the wallet that owns a position, an allocate button lets you pick up to 20 gauges from the top estimates, shows the shares, simulates the transaction on Base and then asks your wallet to sign; Aero's allocate replaces the whole Base distribution and locks the position for 47 hours. Positions now show how much is placed on a chain versus idle, and the cooldown comes from the gauge contract. The gauge list now has chain buttons for Ethereum, OP, Arbitrum, Ink and Robinhood Chain (weights, caps and incentives, read straight from each chain; Arc is not read yet). Fee estimates and the $/day ranking now also cover Ethereum (about a day and a quarter of history) and OP; Arbitrum, Ink and Robinhood Chain stay without fees because public nodes keep too little log history for their block times. Allocating stays Base only. The allocate panel now also shows which gauges the position is on right now and keeps them selectable, since the new allocation replaces them. After launch the page headline and footer now talk about allocating sAERO, and the weekly vote clock and snapshot chips in the header are gone.",
  },
  {
    date: "2026-10-21",
    title:
      "Forecast vs paid, in public: under the title, the last settled epoch's forecast next to what it paid for your amount, how many of the pools it ranked top were still top at close, and each recent week in the accuracy panel. The split now sizes on last epoch's fees: replayed over past epochs it paid about 62% of what it promised at 10k veAERO (was 51%) and earned 7-9% more at 10k-100k. Large holders also see what their own votes cost: the figure if they didn't move the pools, beside the after-dilution one. And a four-step upgrade checklist (veAERO to sAERO) with Aero's own dates, shown until a week after launch.",
  },
];

export function ChangelogPanel() {
  return (
    <details className="mt-6 rounded-lg border border-neutral-800 px-3 py-2">
      <summary className="cursor-pointer select-none font-mono text-xs uppercase tracking-wider text-neutral-400">
        what&apos;s new
      </summary>
      <ul className="mt-3 space-y-2">
        {CHANGELOG.map((entry) => (
          <li key={entry.date + entry.title} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
            <span className="shrink-0 font-mono text-xs text-neutral-600 sm:w-24">{entry.date}</span>
            <span className="text-xs leading-relaxed text-neutral-400">{entry.title}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-neutral-600">
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
