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
      "For agents: /openapi.json now describes the free reads and the two paid calls (position check and allocate plan, both listed in Coinbase's x402 Bazaar), and two agent skills are in the repo: one re-allocates a sAERO position only when the gain is real and steady (never for a one-off fee burst), the other checks old veAERO locks against Aero's migration contract and prepares the upgrade only after the owner confirms (an expired lock becomes liquid AERO, not a sAERO position). Neither signs or sends anything. The allocate panel, the staying-cost lines and the paid API now use the wait read from the chain instead of a fixed 47 hours, and the Upgrade guide no longer shows launch dates that have passed.",
  },
  {
    date: "2026-10-26",
    title:
      "The positions panel now explains how to move more often than every 47 hours, from a check on Base: the wait belongs to each position, not to your wallet, and a position that has never been allocated has none, so holding AERO as several separate positions lets you move one while the others wait. An existing position can't be split (Aero's escrow has no split function), and every allocation is its own transaction with its own gas. A position with no AERO staked (for example the key left behind after depositing into an Aero Autopilot) now says there is nothing to allocate instead of offering the allocate button, and the gauge table repeats Aero's advice to judge allocation over a long horizon, since 47-hour results are noisy. Each position now has a \"show fees earned so far\" button that reads, in your browser, the trading fees it has earned on its current gauges and not yet claimed (claiming is still done on Aero; incentives are not counted), and a position that has an operator set on it, such as an Aero Autopilot, now says so. Each position now also says in dollars a day what it earns where it sits, what the best split would earn, and so what staying costs, with a total across your positions (only moves the advice calls worth the 47-hour wait are counted; the figures use today's fee pace and are estimates). The page now also keeps a daily record of each gauge (fees released, power and incentives for every finished UTC day, up to 90 days), and the history chart shows it as a second chart from the second day on, so you can see weeks, not just the last four days. Share cards name the pool kind (CL100, stable), and the footer points agents to the free and paid APIs. The positions panel now reads your connected wallet as soon as it connects (the button reads it again), and the best split for an amount now shows a range: today's fee pace on top, and a low end that counts fees at the share of half-days that paid (never under half), with incentives unchanged. What staying costs on each position, and the total, is now a range too: from fees running light to today's pace, so the figure no longer reads as a promise. A gauge whose recent fee pace is a burst far above its usual level (three times its usual half-day or more) is now marked \"spiky\" instead of \"solid\", and its APR is shown as a range from the usual level up to the burst, since a one-off release can make an APR look ten times higher than Aero's own.",
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
