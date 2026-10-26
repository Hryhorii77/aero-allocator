"use client";

import { useEffect, useState } from "react";
import { DISPLAY_PRESET } from "@/lib/protocol";
import { LINK } from "./ui";

// Steps and dates are Aero's, from its Upgrade Hub (aero.xyz/aero-upgrade, read 2026-10-21):
// claim, reset votes, upgrade; locks in Relays or vaults must come back to the wallet first; a lock with
// active votes cannot upgrade; upgrades are irreversible; the veNFT id is retired and a new sAERO position
// is created with the remaining lock time (rounded up to a full week); permanent locks become sAERO at the
// maximum stake duration. The launch dates (final voting 21 Oct, portal open from 22 Oct) are left out of the text now that both
// have passed; the panel itself hides after UPGRADE_CHECKLIST_UNTIL_MS.
const UPGRADE_URL = "https://aero.xyz/aero-upgrade/";

/** Shown from the final vote week until a week after launch, then gone. */
export const UPGRADE_CHECKLIST_FROM_MS = Date.UTC(2026, 9, 19);
export const UPGRADE_CHECKLIST_UNTIL_MS = Date.UTC(2026, 9, 29);

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: "Take locks out of Relays and vaults",
    body: "A lock held by a Relay or another contract can't upgrade until it is back in your own wallet.",
  },
  {
    title: "Claim rewards and rebases",
    body: "Unclaimed ones can't be recovered after the upgrade.",
  },
  {
    title: "Reset your votes",
    body: "A lock with active votes can't upgrade, so reset any votes still on it.",
  },
  {
    title: "Upgrade on Aero's portal",
    body: "It is irreversible: the lock ID is retired and you get a new sAERO position with your remaining lock time, rounded up to a full week.",
  },
];

export function upgradeChecklistVisible(nowMs: number, protocol: string): boolean {
  return protocol === "aerodrome" && nowMs >= UPGRADE_CHECKLIST_FROM_MS && nowMs < UPGRADE_CHECKLIST_UNTIL_MS;
}

/** Holding veAERO through the cut-over: the four steps in order. Mounted state, not a render-time Date.now(), so server and client HTML agree. */
export function UpgradeChecklist() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(upgradeChecklistVisible(Date.now(), DISPLAY_PRESET.protocol));
  }, []);
  if (!show) return null;
  return (
    <details id="upgrade" open className="mt-4 scroll-mt-36 rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-3 sm:px-5">
      <summary className="cursor-pointer select-none text-sm font-medium text-neutral-200">
        Upgrading {DISPLAY_PRESET.veTokenSymbol} to sAERO: what to do, in order
      </summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-neutral-300">
        {STEPS.map((s) => (
          <li key={s.title}>
            <span className="font-medium text-neutral-100">{s.title}.</span> {s.body}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-neutral-500">
        From{" "}
        <a href={UPGRADE_URL} target="_blank" rel="noreferrer" className={LINK}>
          Aero&rsquo;s Upgrade Hub
        </a>
        ; check it for changes. This app never asks you to sign an upgrade.
      </p>
    </details>
  );
}
