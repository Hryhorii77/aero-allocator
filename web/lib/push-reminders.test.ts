import { describe, expect, it } from "vitest";
import { emptyBook, FIRE_STEP_SEC, GIVE_UP_AFTER_SEC, isPushEndpoint, MAX_PER_ENDPOINT, parseAdd, parseRemove, plan, pushOutcome, roundUpToStep, withAdded, withRemoved } from "./push-reminders";

const NOW = 1_793_750_400; // a multiple of 900
const FCM = "https://fcm.googleapis.com/fcm/send/abc:def";
const MOZ = "https://updates.push.services.mozilla.com/wpush/v2/xyz";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("isPushEndpoint", () => {
  it("accepts the browsers' push services", () => {
    for (const e of [FCM, MOZ, "https://web.push.apple.com/QH4r", "https://wns2-db5p.notify.windows.com/w/?token=x"]) expect(isPushEndpoint(e)).toBe(true);
  });
  it("refuses anything the cron shouldn't be aimed at", () => {
    for (const e of ["http://fcm.googleapis.com/x", "https://evil.example/x", "https://fcm.googleapis.com.evil.example/x", "https://u:p@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://169.254.169.254/", 42, `https://fcm.googleapis.com/${"a".repeat(1100)}`])
      expect(isPushEndpoint(e)).toBe(false);
  });
});

describe("parseAdd", () => {
  it("takes a rounded time in the next 4 days", () => {
    expect(parseAdd({ id: id(1), endpoint: FCM, fireAt: NOW + 2 * FIRE_STEP_SEC }, NOW)).toEqual({ ok: true, value: { id: id(1), endpoint: FCM, fireAt: NOW + 2 * FIRE_STEP_SEC } });
  });
  it("refuses an exact (unrounded) time, so the server never holds one", () => {
    expect(parseAdd({ id: id(1), endpoint: FCM, fireAt: NOW + 1234 }, NOW).ok).toBe(false);
  });
  it("refuses past, far-future, bad ids and extra junk types", () => {
    expect(parseAdd({ id: id(1), endpoint: FCM, fireAt: NOW }, NOW).ok).toBe(false);
    expect(parseAdd({ id: id(1), endpoint: FCM, fireAt: NOW + 5 * 24 * 3600 }, NOW).ok).toBe(false);
    expect(parseAdd({ id: "1", endpoint: FCM, fireAt: NOW + FIRE_STEP_SEC }, NOW).ok).toBe(false);
    expect(parseAdd(null, NOW).ok).toBe(false);
    expect(parseRemove({ id: id(1) }).ok).toBe(false);
  });
  it("rounds up to the step", () => {
    expect(roundUpToStep(NOW + 1)).toBe(NOW + FIRE_STEP_SEC);
    expect(roundUpToStep(NOW)).toBe(NOW);
  });
});

describe("book changes", () => {
  it("adds, replaces by id, caps per browser, and drops long-past entries", () => {
    let b = emptyBook();
    b = { v: 1, reminders: [{ id: id(99), endpoint: MOZ, fireAt: NOW - GIVE_UP_AFTER_SEC - 1 }] };
    b = withAdded(b, { id: id(1), endpoint: FCM, fireAt: NOW + 900 }, NOW).book;
    expect(b.reminders.map((r) => r.id)).toEqual([id(1)]);
    b = withAdded(b, { id: id(1), endpoint: FCM, fireAt: NOW + 1800 }, NOW).book;
    expect(b.reminders).toEqual([{ id: id(1), endpoint: FCM, fireAt: NOW + 1800 }]);
    for (let i = 2; i <= MAX_PER_ENDPOINT; i++) b = withAdded(b, { id: id(i), endpoint: FCM, fireAt: NOW + 900 }, NOW).book;
    expect(withAdded(b, { id: id(500), endpoint: FCM, fireAt: NOW + 900 }, NOW).outcome).toBe("full");
    expect(withAdded(b, { id: id(500), endpoint: MOZ, fireAt: NOW + 900 }, NOW).outcome).toBe("added");
  });
  it("cancels only with the matching push address", () => {
    const b = { v: 1 as const, reminders: [{ id: id(1), endpoint: FCM, fireAt: NOW + 900 }] };
    expect(withRemoved(b, id(1), MOZ).reminders).toHaveLength(1);
    expect(withRemoved(b, id(1), FCM).reminders).toHaveLength(0);
  });
});

describe("plan", () => {
  it("sends one push per browser with anything due and drops what is too late", () => {
    const b = {
      v: 1 as const,
      reminders: [
        { id: id(1), endpoint: FCM, fireAt: NOW },
        { id: id(2), endpoint: FCM, fireAt: NOW - 900 },
        { id: id(3), endpoint: MOZ, fireAt: NOW + 900 },
        { id: id(4), endpoint: MOZ, fireAt: NOW - GIVE_UP_AFTER_SEC - 900 },
      ],
    };
    const p = plan(b, NOW);
    expect(p.endpoints).toEqual([FCM]);
    expect(p.dueIds.get(FCM)).toEqual([id(1), id(2)]);
    expect(p.expiredIds).toEqual([id(4)]);
  });
  it("reads push service answers", () => {
    expect(pushOutcome(201)).toBe("sent");
    expect(pushOutcome(410)).toBe("gone");
    expect(pushOutcome(403)).toBe("gone");
    expect(pushOutcome(429)).toBe("retry");
    expect(pushOutcome(503)).toBe("retry");
    expect(pushOutcome(0)).toBe("retry");
  });
});
