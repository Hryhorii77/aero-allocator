"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
export const THEME_KEY = "aero-allocator-theme";

// Runs in <head> before first paint (see layout.tsx) so the page never
// flashes the wrong theme: saved choice first, else the OS setting, else dark.
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}`;

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Current theme, kept in sync with the data-theme attribute on <html>. */
export function useTheme(): Theme {
  // "dark" on the server and first client render, matching the CSS default;
  // the effect then reads what the init script actually set.
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    setTheme(readTheme());
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function setStoredTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Private mode / blocked storage: the switch still works for this page view.
  }
}
