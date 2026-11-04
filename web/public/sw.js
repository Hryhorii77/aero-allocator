// Aero Allocator's service worker: only "your wait is over" notifications (lib/push-reminders.ts). No caching, no fetch handler.
// The push carries no message. What to show comes from this browser's own store, written by the page when "notify me" was pressed;
// the server only knew a push address and a time.
const DB_NAME = "aero-reminders";
const STORE = "due";
// The server rounds times up to 15 minutes and sends on the quarter-hour; a little slack for clocks.
const SLACK_MS = 20 * 60 * 1000;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function takeDue() {
  const db = await openDb();
  const all = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  const now = Date.now();
  const due = all.filter((r) => r.fireAt * 1000 <= now + SLACK_MS);
  if (due.length > 0) {
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      for (const r of due) tx.objectStore(STORE).delete(r.id);
      tx.oncomplete = tx.onerror = () => resolve();
    });
  }
  db.close();
  return due;
}

async function onPush() {
  let due = [];
  try {
    due = await takeDue();
  } catch {
    // fall through to the generic notice: browsers require every push to show something
  }
  const open = { data: { url: "/#positions" } };
  if (due.length === 0) {
    await self.registration.showNotification("An sAERO wait is over", { ...open, body: "A position you asked about can be re-allocated. Open Aero Allocator to check the gauges.", tag: "saero-wait" });
    return;
  }
  for (const r of due) {
    await self.registration.showNotification(`sAERO #${r.tokenId} can be re-allocated`, {
      ...open,
      body: "Its wait is over. Open Aero Allocator to check the gauges and re-allocate.",
      tag: `saero-${r.tokenId}`,
    });
  }
}

self.addEventListener("push", (event) => event.waitUntil(onPush()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) return c.focus().then((w) => (w && "navigate" in w ? w.navigate(url) : w));
      }
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
