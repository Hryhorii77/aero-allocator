"use client";

import { useEffect, useState } from "react";
import { DISPLAY_PRESET } from "@/lib/protocol";
import { AllocatorMark } from "./allocator-mark";
import { ChangelogPanel } from "./changelog";
import { GaugeTable } from "./gauge-table";
import { JumpBar } from "./jump-bar";
import { SaeroPositions } from "./saero-positions";
import { SiteFooter } from "./site-footer";
import { ThemeToggle } from "./theme-toggle";
import { TrackRecordPanel } from "./track-record";
import { UpgradeChecklist, upgradeChecklistVisible } from "./upgrade-checklist";
import { ConnectButton } from "./wallet";
import { LEAD } from "./ui";

/**
 * The page after Aero's launch (Aerodrome build): where an amount of sAERO earns the most, your own positions, and the allocate
 * button. The weekly-vote dashboard it replaced has been removed.
 */
export function SaeroPage() {
  // Same mounted-state rule as the checklist itself, so the link only exists while the section does.
  const [upgrade, setUpgrade] = useState(false);
  useEffect(() => setUpgrade(upgradeChecklistVisible(Date.now(), DISPLAY_PRESET.protocol)), []);
  const sections = [{ id: "gauges", label: "Gauges" }, { id: "positions", label: "Positions" }, ...(upgrade ? [{ id: "upgrade", label: "Upgrade guide" }] : [])];
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 overflow-x-clip px-6 py-10 lg:px-8">
      <header className="sticky top-0 z-20 -mx-6 mb-4 border-b border-neutral-800/80 bg-neutral-950/95 px-6 py-2 backdrop-blur sm:py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
          <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-white sm:text-3xl">
            <AllocatorMark />
            {DISPLAY_PRESET.appName.replace(/ Allocator$/, "")} <span className="text-sky-400">Allocator</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <ConnectButton />
          </div>
        </div>
        <JumpBar items={sections} />
      </header>
      <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">Where to allocate your sAERO.</h1>
      <p className={`mt-2 ${LEAD}`}>
        sAERO is staked AERO on Aero: you point its voting power at gauges and earn the trading fees and incentives those gauges pay. See which
        gauges pay the most per day for your amount, then allocate from your wallet. Your address never reaches our server.
      </p>
      <GaugeTable />
      <SaeroPositions />
      <TrackRecordPanel />
      <UpgradeChecklist />
      <ChangelogPanel />
      <SiteFooter />
    </main>
  );
}
