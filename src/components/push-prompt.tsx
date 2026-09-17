"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getPushPublicKey,
  savePushSubscription,
} from "@/lib/actions/push";

type State =
  | "checking"
  /** Nothing to ask: already on, blocked in browser settings, or unsupported. */
  | "quiet"
  /** Push is possible and they haven't turned it on. */
  | "ask"
  /** iPhone, not installed to the home screen, so push can't work yet. */
  | "needs-install"
  | "done";

/** The one thing that decides whether the app can reach anybody.
 *
 * Adding the app to a home screen does *not* turn notifications on. It only
 * makes them possible, because Apple won't deliver push to a browser tab. The
 * second step, tapping a button, was on one screen and easy to never find, so
 * people installed the app, assumed they were finished, and heard nothing all
 * term.
 *
 * So this asks on every visit until it gets an answer, from wherever they
 * happen to be in the app.
 *
 * It asks *itself* rather than firing the browser's permission dialog on
 * load. That is not politeness. A permission request with no gesture behind it
 * is refused outright by Safari, and a refusal is close to permanent: the
 * browser remembers "denied" and the real dialog can never be shown again.
 * Spending someone's one chance at page load would quietly lock them out of
 * notifications forever. The native dialog only opens when a finger lands on
 * the button.
 *
 * "Not now" hides it for the rest of this visit and it returns next time they
 * open the app, which is what was asked for: once per opening, not once per
 * page. */
export function PushPrompt() {
  const [state, setState] = useState<State>("checking");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    async function check() {
      if (typeof window === "undefined") return setState("quiet");

      // sessionStorage can throw in a private window, and a notification
      // prompt is not worth a crashed page.
      let dismissed = false;
      try {
        dismissed = sessionStorage.getItem("padt-push-asked") === "1";
      } catch {
        dismissed = false;
      }
      if (dismissed) return setState("quiet");

      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        // Safari only exposes PushManager to installed web apps, so on an
        // iPhone this means "not on the home screen yet" rather than "this
        // browser can't".
        const isIphone = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const installed =
          window.matchMedia("(display-mode: standalone)").matches ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (navigator as any).standalone === true;
        return setState(isIphone && !installed ? "needs-install" : "quiet");
      }

      if (Notification.permission === "denied") return setState("quiet");

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      setState(existing ? "quiet" : "ask");
    }

    check().catch(() => setState("quiet"));
  }, []);

  function remember() {
    try {
      sessionStorage.setItem("padt-push-asked", "1");
    } catch {
      // Private window. It will ask again on the next page, which is a
      // smaller problem than not asking at all.
    }
  }

  function dismiss() {
    remember();
    setState("quiet");
  }

  function turnOn() {
    startTransition(async () => {
      try {
        const key = await getPushPublicKey();
        if (!key) {
          // No VAPID keys configured on the server. Nothing the person can do
          // about it, so stop asking rather than showing a button that fails.
          dismiss();
          return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          dismiss();
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

        remember();
        setState("done");
      } catch {
        dismiss();
      }
    });
  }

  if (state === "checking" || state === "quiet") return null;

  if (state === "done") {
    return (
      <div className="mb-4 rounded-xl border border-good/30 bg-good-soft px-4 py-3 text-sm text-good">
        <span className="font-semibold">Notifications are on.</span>{" "}
        You will get a message when the schedule is posted, when something of
        yours changes, and 15 minutes before each practice.
      </div>
    );
  }

  if (state === "needs-install") {
    return (
      <div className="mb-4 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent-ink">
        <p className="font-semibold">Add PADT to your home screen</p>
        <p className="mt-1 leading-relaxed">
          Your iPhone only sends notifications from apps on the home screen.
          Tap <B>Share</B>, then <B>Add to Home Screen</B>, then open PADT from
          there. We will ask about notifications once you do.
        </p>
        <button
          onClick={dismiss}
          className="mt-2 text-xs font-medium underline"
        >
          Not now
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent-ink">
      <p className="font-semibold">Turn on notifications?</p>
      <p className="mt-1 leading-relaxed">
        It is the only way the app can reach you. You will get a message when
        the schedule is posted, when a practice of yours moves or is cancelled,
        and 15 minutes before each practice. Nothing else.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          onClick={turnOn}
          disabled={isPending}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-45"
        >
          {isPending ? "Turning on…" : "Yes, turn them on"}
        </button>
        <button
          onClick={dismiss}
          disabled={isPending}
          className="px-1 text-xs font-medium underline disabled:opacity-45"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold">{children}</strong>;
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
