"use client";

import { ThemeToggle } from "./theme-toggle";

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-sm text-neutral-100">{title}</div>
        <p className="text-xs text-neutral-500">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Phone Profile tab: settings as labelled rows (the wallet button stays in the header, the one place it lives). The
 * links, tip jar and fine print follow below it (SiteFooter). */
export function ProfilePanel({ active }: { active: boolean }) {
  return (
    <section aria-label="profile" className={`mb-2 sm:hidden ${active ? "" : "hidden"}`}>
      <h2 className="mb-2 text-xs uppercase tracking-wider text-neutral-500">Settings</h2>
      <div className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900/40 px-4">
        <Row title="Appearance" hint="Dark or light. Saved on this device only.">
          <ThemeToggle />
        </Row>
      </div>
    </section>
  );
}
