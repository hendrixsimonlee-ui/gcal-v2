import webpush from "web-push";
import { prisma } from "@/lib/prisma";

/** Web Push needs a VAPID key pair. Without one configured, every send is a
 * no-op and the app falls back to in-app notifications and email — which is
 * also what happens for anyone who hasn't installed the app to their home
 * screen, since iOS won't deliver push to a plain browser tab. */
function configured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

let initialised = false;
function ensureConfigured(): boolean {
  if (!configured()) return false;
  if (!initialised) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    initialised = true;
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  href?: string;
}

/** Best-effort, like email: a push that fails must never stop the thing that
 * triggered it. Subscriptions the browser has revoked are cleaned up as we
 * find them, so dead endpoints don't accumulate. */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<{ sent: number; skipped: boolean }> {
  if (userIds.length === 0) return { sent: 0, skipped: true };
  if (!ensureConfigured()) return { sent: 0, skipped: true };

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
  });
  if (subscriptions.length === 0) return { sent: 0, skipped: false };

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
        sent++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404/410 mean the browser threw the subscription away.
        if (status === 404 || status === 410) dead.push(sub.id);
        else console.error("Push send failed", status, error);
      }
    }),
  );

  if (dead.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } });
  }
  return { sent, skipped: false };
}
