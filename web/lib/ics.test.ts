import { describe, expect, it } from "vitest";
import { reminderIcs } from "./ics";

// 2026-10-25T16:50:51Z
const READY = Date.UTC(2026, 9, 25, 16, 50, 51) / 1000;

describe("reminderIcs", () => {
  const ics = reminderIcs({ tokenId: "15308", readyAtSec: READY, url: "https://aeroallocator.app/#positions", nowSec: READY - 3600 });
  it("is a calendar with one event starting when the wait ends, for 15 minutes, with an alert at the start", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("DTSTART:20261025T165051Z");
    expect(ics).toContain("DTEND:20261025T170551Z");
    expect(ics).toContain("DTSTAMP:20261025T155051Z");
    expect(ics).toContain("TRIGGER:PT0S");
    expect(ics).toContain("SUMMARY:sAERO #15308 can be re-allocated");
  });
  it("has a stable id per position and time, and escapes text and the colon in the link properly", () => {
    expect(ics).toContain(`UID:saero-15308-${READY}@aeroallocator.app`);
    expect(ics).toContain("DESCRIPTION:The 47-hour wait on sAERO position #15308 is over. Check the gauges and re-allocate: https://aeroallocator.app/#positions");
    expect(reminderIcs({ tokenId: "1", readyAtSec: READY, url: "u", nowSec: 0 })).not.toMatch(/[^\r]\n/);
    expect(reminderIcs({ tokenId: "a,b;c", readyAtSec: READY, url: "u", nowSec: 0 })).toContain("SUMMARY:sAERO #a\\,b\;c can be");
  });
});
