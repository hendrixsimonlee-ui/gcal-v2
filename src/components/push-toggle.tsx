"use client";

import { useEffect, useState, useTransition } from "react";
import { removePushSubscription } from "@/lib/actions/push";

type State = "loading" | "unsupported" | "needs-install" | "off" | "on" | "blocked";

/** The off switch for phone notifications, and the line that says they are on.
 *
 * Turning them *on* is handled by the app-wide prompt above every screen,
 * which asks on every visit until it gets an answer. This used to do both, and
 * for a while the two sat one above the other on My Schedule asking the same
 * question twice. So this now renders nothing at all unless notifications are
 * already on, which is the only state the prompt has nothing to say about. */
export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    async function check() {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        // Safari on iOS only exposes PushManager to installed web apps.
        const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const installed =
          window.matchMedia("(display-mode: standalone)").matches ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (navigator as any).standalone === true;
        setState(isIos && !installed ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("blocked");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      setState(existing ? "on" : "off");
    }
    check().catch(() => setState("unsupported"));
  }, []);

  function disable() {
    startTransition(async () => {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await removePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("off");
    });
  }

  // The app-wide prompt now owns asking. This is the off switch and the
  // status line, so it stays out of the way until there is something to
  // switch off — two cards on one screen both asking the same question was
  // just noise.
  if (state !== "on") return null;

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-ink-soft">
          Phone notifications are on. You will hear about the schedule, changes
          to it, and each practice 15 minutes before it starts.
        </span>
        <button
          onClick={disable}
          disabled={isPending}
          className="ml-auto text-xs font-medium text-ink-soft hover:underline"
        >
          Turn off
        </button>
      </div>
    </div>
  );
}
