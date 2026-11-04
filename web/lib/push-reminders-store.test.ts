import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReminderBook } from "./push-reminders";

// The blob layer stubbed: one stored book with an ETag, and a save that can be made to conflict once.
const store: { book: ReminderBook | null; etag: number; conflictNext: boolean; failRead: boolean } = { book: null, etag: 0, conflictNext: false, failRead: false };
vi.mock("./blob-json", () => ({
  loadForUpdate: async () => (store.failRead ? { state: "error" } : store.book ? { state: "ok", value: structuredClone(store.book), etag: String(store.etag) } : { state: "missing" }),
  saveIfUnchanged: async (_p: string, value: ReminderBook, read: { state: string; etag?: string }) => {
    if (store.conflictNext) {
      store.conflictNext = false;
      // someone else added a reminder meanwhile
      store.book = { v: 1, reminders: [...(store.book?.reminders ?? []), { id: "00000000-0000-4000-8000-000000000077", endpoint: "https://fcm.googleapis.com/other", fireAt: 9e9 }] };
      store.etag++;
      return "conflict";
    }
    if (read.state === "ok" && read.etag !== String(store.etag)) return "conflict";
    store.book = structuredClone(value);
    store.etag++;
    return "saved";
  },
}));

const { addReminder, sendDueReminders } = await import("./push-reminders-store");
const NOW = 1_793_750_400;
const FCM = "https://fcm.googleapis.com/fcm/send/a";
const MOZ = "https://updates.push.services.mozilla.com/wpush/v2/b";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const keys = { publicKey: "x", privateKey: "y" };
vi.mock("./vapid", () => ({ sendEmptyPush: async (endpoint: string) => (endpoint.includes("mozilla") ? 410 : endpoint.includes("down") ? 503 : 201) }));

beforeEach(() => Object.assign(store, { book: null, etag: 0, conflictNext: false, failRead: false }));

describe("addReminder", () => {
  it("re-reads and re-applies on a conflict, so the other browser's reminder survives", async () => {
    store.book = { v: 1, reminders: [] };
    store.conflictNext = true;
    expect(await addReminder({ id: id(1), endpoint: FCM, fireAt: NOW + 900 }, NOW)).toBe("added");
    expect(store.book?.reminders.map((r) => r.id).sort()).toEqual([id(1), id(77)]);
  });
  it("never saves after a failed read", async () => {
    store.failRead = true;
    expect(await addReminder({ id: id(1), endpoint: FCM, fireAt: NOW + 900 }, NOW)).toBe("failed");
    expect(store.book).toBeNull();
  });
});

describe("sendDueReminders", () => {
  it("drops delivered and unsubscribed reminders, keeps a failed push for the next run and future ones", async () => {
    const down = "https://fcm.googleapis.com/down";
    store.book = {
      v: 1,
      reminders: [
        { id: id(1), endpoint: FCM, fireAt: NOW },
        { id: id(2), endpoint: MOZ, fireAt: NOW },
        { id: id(3), endpoint: MOZ, fireAt: NOW + 3600 },
        { id: id(4), endpoint: down, fireAt: NOW },
        { id: id(5), endpoint: FCM, fireAt: NOW + 900 },
      ],
    };
    const r = await sendDueReminders(keys, NOW);
    expect(r).toEqual({ pushed: 1, gone: 1, retry: 1, expired: 0, saved: true });
    expect(store.book?.reminders.map((x) => x.id)).toEqual([id(4), id(5)]);
  });
  it("does nothing when there is no book yet, and reports a failed read", async () => {
    expect(await sendDueReminders(keys, NOW)).toMatchObject({ pushed: 0, saved: false });
    store.failRead = true;
    expect(await sendDueReminders(keys, NOW)).toBeNull();
  });
});
