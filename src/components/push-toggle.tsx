"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getPushPublicKey,
  removePushSubscription,
  savePushSubscription,
} from "@/lib/actions/push";

type State = "loading" | "unsupported" | "needs-install" | "off" | "on" | "blocked";

/** Turns on phone notifications for practice start and attendance reminders.
 *
 * On iPhone a web app can only receive push once it's been added to the home
 * screen — Apple's rule, not a setting. So this detects that case and says so
 * plainly rather than offering a button that would silently do nothing. */
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

  function enable() {
    startTransition(async () => {
      const key = await getPushPublicKey();
      if (!key) {
        setState("unsupported");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("blocked");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const json = subscription.toJSON();
      await savePushSubscription({
        endpoint: subscription.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
      });
      setState("on");
    });
  }

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

  if (state === "loading") return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      {state === "on" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-zinc-700 dark:text-zinc-300">
            🔔 Phone notifications are on — you&rsquo;ll get a nudge when
            practice starts.
          </span>
          <button
            onClick={disable}
            disabled={isPending}
            className="ml-auto text-xs font-medium text-zinc-500 hover:underline"
          >
            Turn off
          </button>
        </div>
      )}

      {state === "off" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-zinc-700 dark:text-zinc-300">
            Get a nudge on your phone when practice starts, so you never forget
            to check in.
          </span>
          <button
            onClick={enable}
            disabled={isPending}
            className="ml-auto rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900"
          >
            {isPending ? "…" : "Turn on notifications"}
          </button>
        </div>
      )}

      {state === "needs-install" && (
        <p className="text-zinc-600 dark:text-zinc-400">
          📲 To get notifications on your iPhone, add this to your home screen
          first: tap <strong>Share</strong>, then{" "}
          <strong>Add to Home Screen</strong>. Then open it from there and come
          back here.
        </p>
      )}

      {state === "blocked" && (
        <p className="text-zinc-600 dark:text-zinc-400">
          Notifications are blocked for this site in your browser settings.
          You&rsquo;ll still see everything in the app.
        </p>
      )}

      {state === "unsupported" && (
        <p className="text-zinc-600 dark:text-zinc-400">
          This browser can&rsquo;t do phone notifications. You&rsquo;ll still
          get everything in the app and by email.
        </p>
      )}
    </div>
  );
}

/** The VAPID key arrives base64url-encoded; the Push API wants bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
