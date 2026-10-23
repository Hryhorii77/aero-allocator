"use client";

import { useEffect, useState } from "react";
import { chip } from "./ui";

export interface JumpItem {
  id: string;
  label: string;
}

/** Which section is under the top of the screen, for highlighting its link. Stays on the first one where IntersectionObserver is missing. */
function useActiveSection(ids: string[]): [string, (id: string) => void] {
  const [active, setActive] = useState(ids[0] ?? "");
  const key = ids.join("|");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    if (els.length === 0) return;
    // A band just under the sticky header: the section crossing it is the one being read.
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [active, setActive];
}

/** A row of anchor links to the page's sections, for the sticky header. Plain `#id` links, so it works without scripting too. */
export function JumpBar({ items }: { items: JumpItem[] }) {
  const [active, setActive] = useActiveSection(items.map((i) => i.id));
  const go = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    const calm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
    setActive(id);
  };
  return (
    <nav aria-label="Sections" className="mt-2 flex flex-wrap gap-2">
      {items.map((i) => (
        <a key={i.id} href={`#${i.id}`} onClick={(e) => go(e, i.id)} aria-current={active === i.id ? "true" : undefined} className={chip(active === i.id)}>
          {i.label}
        </a>
      ))}
    </nav>
  );
}
