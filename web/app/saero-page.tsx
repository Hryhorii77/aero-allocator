"use client";

import { DISPLAY_PRESET } from "@/lib/protocol";
import { AllocatorMark } from "./allocator-mark";
import { ChangelogPanel } from "./changelog";
import { GaugeTable } from "./gauge-table";
import { SaeroPositions } from "./saero-positions";
import { SiteFooter } from "./site-footer";
import { ThemeToggle } from "./theme-toggle";
import { UpgradeChecklist } from "./upgrade-checklist";
import { ConnectButton } from "./wallet";
import { LEAD } from "./ui";

/**
 * The page after Aero's launch (Aerodrome build): where an amount of sAERO earns the most, your own positions, and the allocate
 * button. The weekly-vote dashboard it replaced lives on for Velodrome and for the days before launch (page.tsx).
 */
export function SaeroPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 overflow-x-clip px-6 py-10 lg:px-8">
      <header className="sm:sticky sm:top-0 z-20 -mx-6 mb-4 border-b border-neutral-800/80 bg-neutral-950/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            <AllocatorMark />
            {DISPLAY_PRESET.appName.replace(/ Allocator$/, "")} <span className="text-sky-400">Allocator</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <ConnectButton />
          </div>
        </div>
      </header>
      <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">Where to allocate your sAERO.</h1>
      <p className={`mt-2 ${LEAD}`}>
        See which gauges pay the most per day for your amount, then allocate from your wallet. Your address never reaches our server.
      </p>
      <GaugeTable />
      <SaeroPositions />
      <UpgradeChecklist />
      <ChangelogPanel />
      <SiteFooter snapshotAt={Date.now()} />
    </main>
  );
}
