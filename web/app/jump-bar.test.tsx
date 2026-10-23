import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { JumpBar } from "./jump-bar";

const items = [
  { id: "gauges", label: "Gauges" },
  { id: "positions", label: "Positions" },
];

function sections() {
  for (const id of ["gauges", "positions"]) {
    const el = document.createElement("section");
    el.id = id;
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
  }
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("JumpBar", () => {
  it("is a labelled nav of plain #links, the first one current to start", () => {
    render(<JumpBar items={items} />);
    expect(screen.getByRole("navigation", { name: "Sections" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gauges" })).toHaveAttribute("href", "#gauges");
    expect(screen.getByRole("link", { name: "Positions" })).toHaveAttribute("href", "#positions");
    expect(screen.getByRole("link", { name: "Gauges" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "Positions" })).not.toHaveAttribute("aria-current");
  });

  it("scrolls to the section, updates the address bar and marks the link current", () => {
    sections();
    render(<JumpBar items={items} />);
    fireEvent.click(screen.getByRole("link", { name: "Positions" }));
    expect(document.getElementById("positions")!.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(window.location.hash).toBe("#positions");
    expect(screen.getByRole("link", { name: "Positions" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "Gauges" })).not.toHaveAttribute("aria-current");
  });

  it("jumps without animation for people who asked for reduced motion", () => {
    sections();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    render(<JumpBar items={items} />);
    fireEvent.click(screen.getByRole("link", { name: "Gauges" }));
    expect(document.getElementById("gauges")!.scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("follows the section being read", () => {
    sections();
    let cb: IntersectionObserverCallback = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(c: IntersectionObserverCallback) {
          cb = c;
        }
        observe() {}
        disconnect() {}
      },
    );
    render(<JumpBar items={items} />);
    act(() => cb([{ isIntersecting: true, target: document.getElementById("positions")!, boundingClientRect: { top: 10 } } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.getByRole("link", { name: "Positions" })).toHaveAttribute("aria-current", "true");
  });

  it("leaves an unknown id alone instead of swallowing the click", () => {
    render(<JumpBar items={[{ id: "nowhere", label: "Nowhere" }]} />);
    const notPrevented = fireEvent.click(screen.getByRole("link", { name: "Nowhere" }));
    expect(notPrevented).toBe(true);
  });
});
