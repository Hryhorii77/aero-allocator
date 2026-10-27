"use client";

import { useState } from "react";
import { positionCardPath } from "@/lib/share-amount";
import { SITE_URL } from "@/lib/site";
import { btn, LINK, NOTE, NUM } from "./ui";

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * "share card" on a position: nothing is built or sent until it is pressed, and the panel says what the link holds. The link has the
 * position's power rounded to two figures and the theme; no token id, no address, no current gauges and no staying cost.
 */
export function PositionShare({ power }: { power: number }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const theme = typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const path = positionCardPath(power, theme);
  if (!path) return null;
  const rounded = Number(new URL(path, SITE_URL).searchParams.get("vp"));
  const url = `${SITE_URL}${path}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the link is shown below, so it can be copied by hand */
    }
  };
  return (
    <div className="mt-2">
      <button type="button" className={btn("secondary", "sm")} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        share card
      </button>
      {open && (
        <div className={`mt-2 ${NOTE}`}>
          <p>
            The card shows what about <span className={`text-neutral-200 ${NUM}`}>{fmt(rounded)}</span> power earns a day in the best split of gauges. The link
            holds only that rounded number: not your address, not the position&rsquo;s number, not where it sits now.
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={url} target="_blank" rel="noreferrer" className={LINK}>
              open card
            </a>
            <button type="button" onClick={copy} className={LINK}>
              {copied ? "copied" : "copy link"}
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
