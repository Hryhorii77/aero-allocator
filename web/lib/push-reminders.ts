// "Your wait is over" browser notifications, the rules both sides share. The server keeps only what it needs to wake a browser at a
// time: the push address the browser's own push service gave it, a random id, and the time rounded to FIRE_STEP_SEC. It never sees the
// position, the wallet or the address: the push carries no message, and the service worker (public/sw.js) writes the notification from
// what this browser stored itself when the button was pressed.

/** Times are rounded up to this step, so the stored time narrows a position down far less than its exact wait end would. Also the cron's period. */
export const FIRE_STEP_SEC = 15 * 60;
/** The furthest ahead a reminder can be set: the 47 h wait plus room. */
export const MAX_AHEAD_SEC = 4 * 24 * 3600;
/** A push that couldn't be delivered is retried on each run until it is this late, then dropped. */
export const GIVE_UP_AFTER_SEC = 2 * 3600;
export const MAX_REMINDERS = 5000;
export const MAX_PER_ENDPOINT = 20;
export const MAX_ENDPOINT_LENGTH = 1024;
export const REMINDERS_PATH = "push-reminders.json";

export interface StoredReminder {
  id: string;
  endpoint: string;
  /** Unix seconds, a multiple of FIRE_STEP_SEC. */
  fireAt: number;
}
export interface ReminderBook {
  v: 1;
  reminders: StoredReminder[];
}
export const emptyBook = (): ReminderBook => ({ v: 1, reminders: [] });

export const roundUpToStep = (sec: number) => Math.ceil(sec / FIRE_STEP_SEC) * FIRE_STEP_SEC;

// Only the browsers' own push services: the cron POSTs to these addresses, so anything else would let a caller aim it at any URL.
const EXACT_HOSTS = new Set(["fcm.googleapis.com", "web.push.apple.com"]);
const HOST_SUFFIXES = [".googleapis.com", ".google.com", ".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com"];

export function isPushEndpoint(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > MAX_ENDPOINT_LENGTH) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return EXACT_HOSTS.has(host) || HOST_SUFFIXES.some((s) => host.endsWith(s));
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isReminderId = (x: unknown): x is string => typeof x === "string" && ID_RE.test(x);

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** A request to add a reminder: `{ id, endpoint, fireAt }`, the time already rounded and in the window. */
export function parseAdd(body: unknown, nowSec: number): Parsed<StoredReminder> {
  if (!body || typeof body !== "object") return { ok: false, error: "expected a JSON object" };
  const { id, endpoint, fireAt } = body as Record<string, unknown>;
  if (!isReminderId(id)) return { ok: false, error: "id must be a random UUID" };
  if (!isPushEndpoint(endpoint)) return { ok: false, error: "endpoint must be a browser push service address" };
  if (typeof fireAt !== "number" || !Number.isInteger(fireAt) || fireAt % FIRE_STEP_SEC !== 0)
    return { ok: false, error: `fireAt must be unix seconds rounded up to ${FIRE_STEP_SEC / 60} minutes` };
  if (fireAt <= nowSec || fireAt > nowSec + MAX_AHEAD_SEC) return { ok: false, error: "fireAt must be in the next 4 days" };
  return { ok: true, value: { id, endpoint, fireAt } };
}

export function parseRemove(body: unknown): Parsed<{ id: string; endpoint: string }> {
  if (!body || typeof body !== "object") return { ok: false, error: "expected a JSON object" };
  const { id, endpoint } = body as Record<string, unknown>;
  if (!isReminderId(id) || !isPushEndpoint(endpoint)) return { ok: false, error: "id and endpoint are required" };
  return { ok: true, value: { id, endpoint } };
}

export function isReminderBook(x: unknown): x is ReminderBook {
  if (!x || typeof x !== "object") return false;
  const b = x as Partial<ReminderBook>;
  return b.v === 1 && Array.isArray(b.reminders) && b.reminders.every((r) => r && isReminderId(r.id) && typeof r.endpoint === "string" && typeof r.fireAt === "number");
}

export type AddOutcome = "added" | "full";

/** Adds (or replaces, by id) a reminder; refuses past the per-browser and total caps. Drops reminders long past while at it. */
export function withAdded(book: ReminderBook, r: StoredReminder, nowSec: number): { book: ReminderBook; outcome: AddOutcome } {
  const rest = book.reminders.filter((x) => x.id !== r.id && x.fireAt > nowSec - GIVE_UP_AFTER_SEC);
  if (rest.length >= MAX_REMINDERS || rest.filter((x) => x.endpoint === r.endpoint).length >= MAX_PER_ENDPOINT) return { book, outcome: "full" };
  return { book: { v: 1, reminders: [...rest, r] }, outcome: "added" };
}

/** Removes a reminder only when both its id and its push address match, so knowing an id alone can't cancel someone's reminder. */
export const withRemoved = (book: ReminderBook, id: string, endpoint: string): ReminderBook => ({
  v: 1,
  reminders: book.reminders.filter((x) => !(x.id === id && x.endpoint === endpoint)),
});

/**
 * What a send run does: one push per browser with anything due (the service worker shows every due reminder it holds on one push),
 * and which reminders that covers. Ones too late to be useful are dropped without a push.
 */
export function plan(book: ReminderBook, nowSec: number): { endpoints: string[]; dueIds: Map<string, string[]>; expiredIds: string[] } {
  const dueIds = new Map<string, string[]>();
  const expiredIds: string[] = [];
  for (const r of book.reminders) {
    if (r.fireAt > nowSec) continue;
    if (nowSec - r.fireAt > GIVE_UP_AFTER_SEC) {
      expiredIds.push(r.id);
      continue;
    }
    dueIds.set(r.endpoint, [...(dueIds.get(r.endpoint) ?? []), r.id]);
  }
  return { endpoints: [...dueIds.keys()], dueIds, expiredIds };
}

/** What a push service's answer means: delivered, gone for good (the browser unsubscribed), or worth trying again next run. */
export function pushOutcome(status: number): "sent" | "gone" | "retry" {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone";
  // 400/401/403/413 won't get better by retrying the same request.
  if (status >= 400 && status < 500 && status !== 429) return "gone";
  return "retry";
}
