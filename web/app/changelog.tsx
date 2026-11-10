import { LINK } from "./ui";

// Plain-language shipped-feature log, newest first — hand-curated from real
// commits (not every commit; internal refactors/test-only changes are left
// out) so users can see the dashboard is actively maintained without digging
// through GitHub history themselves.
//
// Kept to roughly the last two weeks, one entry per ship day. The point of this panel is "this thing is alive", and a week of new features
// that isn't listed reads as abandoned (it stopped at Oct 28 for ten days once). Keep each entry short; drop entries older than about two
// weeks when adding one. Anything older is a commit away via the link at the foot of the panel.
const CHANGELOG: Array<{ date: string; title: string }> = [
  {
    date: "2026-11-10",
    title: "Uses Aero\u2019s word Allocation Power, and every mention of the wait between allocations now shows the value read from the chain (Aero says it may get shorter). On a phone, the best split and its \u201callocate from my wallet\u201d button now fill the first screen, and a split that puts everything in one pool says so. The track record starts checking Aero\u2019s Autopilot the same way: from tomorrow each day also shows what the same amount in Autopilot really paid.",
  },
  {
    date: "2026-11-07",
    title: "Own several positions? \u201cShow earnings for all N positions\u201d adds up what every one of them has unclaimed, on every chain, with each chain\u2019s and each position\u2019s share.",
  },
  {
    date: "2026-11-05",
    title: "Base moved to 0.2-second blocks (the Denim upgrade); fee pace and history now count time correctly on both sides of the switch.",
  },
  {
    date: "2026-11-04",
    title:
      "Each position can now show what it has earned and not claimed yet, fees and incentives on every chain, read in your browser. \u201cNotify me\u201d sends a browser notification when a position\u2019s wait is over, even with the tab closed. Pools that charge Aero\u2019s MEV tax are tagged.",
  },
  {
    date: "2026-11-03",
    title:
      "Compare with Autopilot: what Aero\u2019s Autopilot would pay your amount, next to the best split. Biggest allocators: the 10 largest positions\u2019 splits priced for your amount, with \u201cuse this split\u201d. Splits no longer chase a pool\u2019s one-off fee burst.",
  },
  {
    date: "2026-10-31",
    title:
      "An \u201cAll networks\u201d view of every chain\u2019s gauges in one list. A public track record that checks each day\u2019s advice against what the gauges really paid. A free MCP server for agents.",
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
