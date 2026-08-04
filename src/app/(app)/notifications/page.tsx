import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { markAllNotificationsRead } from "@/lib/actions/notifications";
import { APP_TIME_ZONE } from "@/lib/timezone";

const stampFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function NotificationsPage() {
  const session = await auth();
  const userId = session!.user.id;

  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {unreadCount > 0
              ? `${unreadCount} unread`
              : "You're all caught up."}
          </p>
        </div>
        {unreadCount > 0 && (
          <form action={markAllNotificationsRead}>
            <button
              type="submit"
              className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-surface-3"
            >
              Mark all read
            </button>
          </form>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="text-sm text-ink-soft">
          Nothing yet. You&rsquo;ll hear from us when a practice you&rsquo;re
          in gets confirmed.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notifications.map((n) => {
            const body = (
              <>
                <span
                  className={
                    n.read
                      ? "text-ink-soft"
                      : "font-medium text-ink"
                  }
                >
                  {!n.read && (
                    <span
                      aria-label="Unread"
                      className="mr-2 inline-block h-2 w-2 rounded-full bg-accent align-middle"
                    />
                  )}
                  {n.message}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-ink-faint">
                  {stampFormatter.format(n.createdAt)}
                  {n.href && (
                    <span className="text-ink-soft">→</span>
                  )}
                </span>
              </>
            );

            const className = `flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
              n.read
                ? "border-line bg-surface  "
                : "border-line-strong bg-surface-2 bg-surface-3"
            }`;

            // "Confirm attendance for Hip Hop Fusion" is useless if it
            // doesn't take you there, so anything carrying a destination is
            // a link.
            return (
              <li key={n.id}>
                {n.href ? (
                  <Link
                    href={n.href}
                    className={`${className} transition-colors hover:bg-surface-3`}
                  >
                    {body}
                  </Link>
                ) : (
                  <div className={className}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
