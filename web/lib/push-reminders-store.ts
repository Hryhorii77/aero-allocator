import { loadForUpdate, saveIfUnchanged } from "./blob-json";
import {
  emptyBook,
  isReminderBook,
  plan,
  pushOutcome,
  REMINDERS_PATH,
  withAdded,
  withRemoved,
  type AddOutcome,
  type ReminderBook,
  type StoredReminder,
} from "./push-reminders";
import { sendEmptyPush, type VapidKeys } from "./vapid";

const TAG = "push-reminders";

/**
 * Applies `change` to the stored book with the ETag-checked save, re-reading and re-applying on a conflict (two browsers adding at
 * once), up to three times. Never saves after a failed read, so a bad read can't wipe the other reminders.
 */
async function update<R>(change: (b: ReminderBook) => { book: ReminderBook; result: R; changed: boolean }): Promise<{ ok: true; result: R } | { ok: false }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const read = await loadForUpdate(REMINDERS_PATH, isReminderBook, TAG);
    if (read.state === "error") return { ok: false };
    const { book, result, changed } = change(read.state === "ok" ? read.value : emptyBook());
    if (!changed) return { ok: true, result };
    const saved = await saveIfUnchanged(REMINDERS_PATH, book, read, TAG);
    if (saved === "saved") return { ok: true, result };
    if (saved === "failed") return { ok: false };
  }
  return { ok: false };
}

export async function addReminder(r: StoredReminder, nowSec: number): Promise<AddOutcome | "failed"> {
  const res = await update((b) => {
    const { book, outcome } = withAdded(b, r, nowSec);
    return { book, result: outcome, changed: outcome === "added" };
  });
  return res.ok ? res.result : "failed";
}

export async function removeReminder(id: string, endpoint: string): Promise<boolean> {
  const res = await update((b) => {
    const book = withRemoved(b, id, endpoint);
    return { book, result: true, changed: book.reminders.length !== b.reminders.length };
  });
  return res.ok;
}

export interface SendReport {
  pushed: number;
  gone: number;
  retry: number;
  expired: number;
  saved: boolean;
}

/** One cron run: push every browser with something due, then drop what was delivered, gone or too late. */
export async function sendDueReminders(keys: VapidKeys, nowSec: number, fetchFn?: typeof fetch): Promise<SendReport | null> {
  const read = await loadForUpdate(REMINDERS_PATH, isReminderBook, TAG);
  if (read.state === "error") return null;
  if (read.state === "missing") return { pushed: 0, gone: 0, retry: 0, expired: 0, saved: false };
  const { endpoints, dueIds, expiredIds } = plan(read.value, nowSec);
  const done = new Set(expiredIds);
  const report: SendReport = { pushed: 0, gone: 0, retry: 0, expired: expiredIds.length, saved: false };
  const goneEndpoints = new Set<string>();
  // A few at a time: a run has a minute, and each push service answers in well under a second.
  for (let i = 0; i < endpoints.length; i += 20) {
    const batch = endpoints.slice(i, i + 20);
    const statuses = await Promise.all(batch.map((e) => sendEmptyPush(e, keys, nowSec, fetchFn)));
    batch.forEach((e, j) => {
      const outcome = pushOutcome(statuses[j]);
      report[outcome === "sent" ? "pushed" : outcome]++;
      if (outcome === "retry") return;
      for (const id of dueIds.get(e) ?? []) done.add(id);
      if (outcome === "gone") goneEndpoints.add(e);
    });
  }
  if (done.size === 0 && goneEndpoints.size === 0) return report;
  // Remove by id (and every reminder of a browser that unsubscribed), re-reading on a conflict so a reminder added meanwhile survives.
  const res = await update((b) => {
    const book: ReminderBook = { v: 1, reminders: b.reminders.filter((r) => !done.has(r.id) && !goneEndpoints.has(r.endpoint)) };
    return { book, result: true, changed: book.reminders.length !== b.reminders.length };
  });
  report.saved = res.ok;
  return report;
}
