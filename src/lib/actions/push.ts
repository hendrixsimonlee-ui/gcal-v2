"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";

export async function getPushPublicKey(): Promise<string | null> {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

export async function savePushSubscription(subscription: {
  endpoint: string;
  p256dh: string;
  auth: string;
}) {
  const user = await requireUser();
  await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    update: { userId: user.id, p256dh: subscription.p256dh, auth: subscription.auth },
    create: {
      userId: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  });
}

export async function removePushSubscription(endpoint: string) {
  await requireUser();
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

export async function hasPushSubscription(): Promise<boolean> {
  const user = await requireUser();
  const count = await prisma.pushSubscription.count({
    where: { userId: user.id },
  });
  return count > 0;
}
