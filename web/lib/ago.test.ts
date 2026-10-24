import { describe, expect, it } from "vitest";
import { ago } from "./ago";

const NOW = 1_800_000_000_000;
describe("ago", () => {
  it("reads minutes, hours and days", () => {
    expect(ago(NOW - 20_000, NOW)).toBe("just now");
    expect(ago(NOW - 12 * 60_000, NOW)).toBe("12 min ago");
    expect(ago(NOW - 3 * 3_600_000 - 5 * 60_000, NOW)).toBe("3 h ago");
    expect(ago(NOW - 49 * 3_600_000, NOW)).toBe("2 d ago");
  });
  it("never goes negative when the clock is slightly behind", () => {
    expect(ago(NOW + 5 * 60_000, NOW)).toBe("just now");
  });
});
