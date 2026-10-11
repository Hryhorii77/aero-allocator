import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "./theme-toggle";
import { THEME_INIT_SCRIPT, THEME_KEY } from "./theme";

function runInitScript() {
  // The script is what layout.tsx inlines in <head>; run it the same way.
  new Function(THEME_INIT_SCRIPT)();
}

function stubOsPrefersLight(light: boolean) {
  window.matchMedia = ((q: string) => ({ matches: light && q.includes("light"), media: q })) as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("theme init script", () => {
  it("uses the saved choice over the OS setting", () => {
    stubOsPrefersLight(true);
    localStorage.setItem(THEME_KEY, "dark");
    runInitScript();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows the OS setting when nothing is saved, and falls back to dark", () => {
    stubOsPrefersLight(true);
    runInitScript();
    expect(document.documentElement.dataset.theme).toBe("light");
    delete document.documentElement.dataset.theme;
    stubOsPrefersLight(false);
    runInitScript();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("ignores a garbage saved value", () => {
    stubOsPrefersLight(false);
    localStorage.setItem(THEME_KEY, "purple");
    runInitScript();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("ThemeToggle", () => {
  it("switches the theme, saves it, and updates its own label", async () => {
    document.documentElement.dataset.theme = "dark";
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(await screen.findByRole("button", { name: /switch to light mode/i }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    expect(await screen.findByRole("button", { name: /switch to dark mode/i })).toBeInTheDocument();
  });
});
