import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  UPGRADE_CHECKLIST_FROM_MS,
  UPGRADE_CHECKLIST_UNTIL_MS,
  UpgradeChecklist,
  upgradeChecklistVisible,
} from "./upgrade-checklist";

const DAY = 24 * 3_600_000;

describe("upgradeChecklistVisible", () => {
  it("shows from the final vote week until a week after launch, Aerodrome only", () => {
    expect(upgradeChecklistVisible(UPGRADE_CHECKLIST_FROM_MS - 1, "aerodrome")).toBe(false);
    expect(upgradeChecklistVisible(UPGRADE_CHECKLIST_FROM_MS, "aerodrome")).toBe(true);
    expect(upgradeChecklistVisible(Date.UTC(2026, 9, 22, 0, 30), "aerodrome")).toBe(true);
    expect(upgradeChecklistVisible(UPGRADE_CHECKLIST_UNTIL_MS, "aerodrome")).toBe(false);
  });
});

describe("UpgradeChecklist", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lists the four steps in Aero's order and links the source", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 21, 12));
    render(<UpgradeChecklist />);
    const items = await screen.findAllByRole("listitem");
    expect(items.map((li) => li.textContent?.split(".")[0])).toEqual([
      "Take locks out of Relays and vaults",
      "Claim rewards and rebases",
      "Reset your votes",
      "Upgrade on Aero's portal",
    ]);
    expect(screen.getByText(/irreversible/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Upgrade Hub/i })).toHaveAttribute("href", "https://aero.xyz/aero-upgrade/");
  });

  it("carries no launch dates, which have passed", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 26, 12));
    const { container } = render(<UpgradeChecklist />);
    await screen.findAllByRole("listitem");
    expect(container.textContent).not.toMatch(/21 Oct|22 Oct|closes|Opens/);
    expect(screen.getByText(/reset any votes still on it/)).toBeInTheDocument();
  });

  it("is still there after the launch instant (when people actually upgrade) and gone a week later", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 22, 0, 5));
    const { container, unmount } = render(<UpgradeChecklist />);
    expect(await screen.findAllByRole("listitem")).toHaveLength(4);
    unmount();

    vi.spyOn(Date, "now").mockReturnValue(UPGRADE_CHECKLIST_UNTIL_MS + DAY);
    const later = render(<UpgradeChecklist />);
    await new Promise((r) => setTimeout(r, 0));
    expect(later.container).toBeEmptyDOMElement();
    expect(container).toBeDefined();
  });
});
