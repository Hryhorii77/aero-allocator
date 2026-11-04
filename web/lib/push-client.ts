// The browser side of "your wait is over" notifications (see lib/push-reminders.ts for what the server keeps). The position id and
// the exact time stay in this browser's IndexedDB, shared with public/sw.js; the server gets a random id, the push address and the
// time rounded up to 15 minutes.
import { fetchJsonOrNull } from "./fetch-json";
import { roundUpToStep } from "./push-reminders";

export interface LocalReminder {
  id: string;
  tokenId: string;
  /** Rounded, unix seconds: what the server was given. */
  fireAt: number;
  endpoint: string;
}

const DB_NAME = "aero-reminders";
const STORE = "due";

export type PushSupport = "ok" | "ios-install" | "none";

/** Whether this browser can take a push. iPhone and iPad Safari can only once the site is added to the Home Screen. */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "none";
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "ok";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "ios-install" : "none";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** This browser's reminders still ahead (ones already shown were removed by the service worker). */
export async function localReminders(): Promise<LocalReminder[]> {
  if (pushSupport() !== "ok") return [];
  const all = await withStore<LocalReminder[]>("readonly", (s) => s.getAll()).catch(() => []);
  return all.filter((r) => r.fireAt * 1000 > Date.now() - 2 * 3600_000);
}

let keyRead: Promise<string | null> | null = null;
/** The site's VAPID public key, or null when the deployment has notifications off (the route answers 501). Read once per page. */
export function pushPublicKey(): Promise<string | null> {
  keyRead ??= fetchJsonOrNull<{ publicKey?: string }>("/api/reminders").then((d) => d?.publicKey ?? null);
  return keyRead;
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const send = (method: "POST" | "DELETE", body: object) =>
  fetch("/api/reminders", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export type AddResult = { ok: true; reminder: LocalReminder } | { ok: false; reason: "blocked" | "off" | "failed" };

/** Asks for permission (this must run from a tap), subscribes, stores the reminder here and registers its rounded time with the server. */
export async function addPushReminder(tokenId: string, readyAtSec: number): Promise<AddResult> {
  const publicKey = await pushPublicKey();
  if (!publicKey) return { ok: false, reason: "off" };
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return { ok: false, reason: "blocked" };
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
    // One reminder per position: replace any earlier one.
    for (const old of (await localReminders()).filter((r) => r.tokenId === tokenId)) await cancelPushReminder(old);
    const reminder: LocalReminder = { id: crypto.randomUUID(), tokenId, fireAt: roundUpToStep(readyAtSec), endpoint: sub.endpoint };
    await withStore("readwrite", (s) => s.put(reminder));
    const res = await send("POST", { id: reminder.id, endpoint: reminder.endpoint, fireAt: reminder.fireAt });
    if (!res.ok) {
      await withStore("readwrite", (s) => s.delete(reminder.id)).catch(() => {});
      return { ok: false, reason: res.status === 501 ? "off" : "failed" };
    }
    return { ok: true, reminder };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Removes the reminder here and on the server; the local copy goes even if the server can't be reached (a push would then show the generic notice). */
export async function cancelPushReminder(r: LocalReminder): Promise<void> {
  await withStore("readwrite", (s) => s.delete(r.id)).catch(() => {});
  await send("DELETE", { id: r.id, endpoint: r.endpoint }).catch(() => {});
}
