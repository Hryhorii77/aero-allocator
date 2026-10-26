/** Escapes text for an iCalendar value (RFC 5545 §3.3.11). */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** 20261025T165051Z */
const stamp = (sec: number) => new Date(sec * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * A one-event calendar file: a short slot starting when a position's wait ends, with an alert at that moment. Made in the browser
 * from numbers already on the page, so nothing about the position or the wallet is sent anywhere.
 */
export function reminderIcs(opts: { tokenId: string; readyAtSec: number; url: string; nowSec: number }): string {
  const { tokenId, readyAtSec, url, nowSec } = opts;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Aero Allocator//sAERO reminder//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:saero-${tokenId}-${readyAtSec}@aeroallocator.app`,
    `DTSTAMP:${stamp(nowSec)}`,
    `DTSTART:${stamp(readyAtSec)}`,
    `DTEND:${stamp(readyAtSec + 15 * 60)}`,
    `SUMMARY:${esc(`sAERO #${tokenId} can be re-allocated`)}`,
    `DESCRIPTION:${esc(`The 47-hour wait on sAERO position #${tokenId} is over. Check the gauges and re-allocate: ${url}`)}`,
    `URL:${url}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(`sAERO #${tokenId} can be re-allocated`)}`,
    "TRIGGER:PT0S",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}
