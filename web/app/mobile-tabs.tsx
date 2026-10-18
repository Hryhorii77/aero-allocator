"use client";

export type MobileTab = "vote" | "pools" | "more";

const TABS: ReadonlyArray<{ key: MobileTab; label: string; icon: React.ReactNode }> = [
  {
    key: "vote",
    label: "vote",
    icon: <path d="M4 12.5l5 5L20 6.5" />,
  },
  {
    key: "pools",
    label: "pools",
    icon: <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />,
  },
  {
    key: "more",
    label: "more",
    icon: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />,
  },
];

/** Phone-only bottom navigation (hidden from sm up, where the page is one dense scroll). Fixed to
 * the thumb zone, 56px tall, with the home-indicator inset; the page leaves room for it. */
export function MobileTabBar({ tab, onChange }: { tab: MobileTab; onChange: (t: MobileTab) => void }) {
  return (
    <nav
      aria-label="dashboard sections"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-800 bg-neutral-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      <div role="tablist" className="mx-auto flex max-w-md">
        {TABS.map(({ key, label, icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(key)}
              className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 font-mono text-[11px] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-500 ${
                active ? "text-sky-300" : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {active && <span aria-hidden="true" className="absolute inset-x-6 top-0 h-0.5 rounded-b bg-sky-400" />}
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {icon}
              </svg>
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
