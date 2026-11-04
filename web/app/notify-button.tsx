"use client";

import { useEffect, useState } from "react";
import { addPushReminder, cancelPushReminder, localReminders, pushPublicKey, pushSupport, type LocalReminder } from "@/lib/push-client";

const hhmm = (sec: number) => new Date(sec * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const CTRL = "text-amber-500 underline underline-offset-2 hover:text-amber-400";

/**
 * "notify me": a browser notification when this position's wait is over, even with the tab closed. Only shown when the browser can
 * take a push and the deployment has notifications on. The server is told a push address and the time rounded up to 15 minutes,
 * never the position or the wallet (lib/push-reminders.ts).
 */
export function NotifyButton(props: { tokenId: bigint; readyAtSec: number }) {
  const body = useNotify(props);
  // It sits after "remind me" on the waiting line, so it brings its own separator, and nothing at all when it has nothing to show.
  return body ? (
    <>
      {" · "}
      {body}
    </>
  ) : null;
}

function useNotify({ tokenId, readyAtSec }: { tokenId: bigint; readyAtSec: number }) {
  const id = tokenId.toString();
  // Positions only render after a lookup in the browser, so this never runs on the server.
  const [support] = useState(pushSupport);
  const [enabled, setEnabled] = useState(false);
  const [set, setSet] = useState<LocalReminder | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "blocked" | "failed">("idle");

  useEffect(() => {
    if (support !== "ok") return;
    let live = true;
    pushPublicKey().then((k) => live && setEnabled(!!k));
    localReminders().then((all) => live && setSet(all.find((r) => r.tokenId === id) ?? null));
    return () => {
      live = false;
    };
  }, [support, id]);

  if (support === "ios-install")
    return <span title="On iPhone and iPad, Safari can notify only from the Home Screen: Share, then Add to Home Screen, and open it from there.">notify: add to Home Screen first</span>;
  if (support !== "ok" || !enabled) return null;

  if (set && set.fireAt >= readyAtSec - 15 * 60) {
    return (
      <>
        notify at {hhmm(set.fireAt)} ·{" "}
        <button
          type="button"
          className={CTRL}
          onClick={async () => {
            await cancelPushReminder(set);
            setSet(null);
          }}
        >
          cancel
        </button>
      </>
    );
  }
  if (state === "blocked") return <span title="Notifications for this site are blocked in the browser's settings">notifications blocked</span>;
  return (
    <button
      type="button"
      className={CTRL}
      disabled={state === "busy"}
      title="A browser notification when this wait is over, even with the tab closed. The server gets only a push address and the time rounded to 15 minutes."
      onClick={async () => {
        setState("busy");
        const res = await addPushReminder(id, readyAtSec);
        if (res.ok) {
          setSet(res.reminder);
          setState("idle");
        } else if (res.reason === "off") setEnabled(false);
        else setState(res.reason);
      }}
    >
      {state === "busy" ? "asking…" : state === "failed" ? "notify me (failed, try again)" : "notify me"}
    </button>
  );
}
