import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { markAllNotificationsRead } from "@/lib/actions/notifications";

const stampFormatter = new Intl.DateTimeFormat("en-US", {
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
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {unreadCount > 0
              ? `${unreadCount} unread`
              : "You're all caught up."}
          </p>
        </div>
        {unreadCount > 0 && (
          <form action={markAllNotificationsRead}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Mark all read
            </button>
          </form>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
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
                      ? "text-zinc-600 dark:text-zinc-400"
                      : "font-medium text-zinc-900 dark:text-zinc-50"
                  }
                >
                  {!n.read && (
                    <span
                      aria-label="Unread"
                      className="mr-2 inline-block h-2 w-2 rounded-full bg-sky-500 align-middle"
                    />
                  )}
                  {n.message}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-zinc-400">
                  {stampFormatter.format(n.createdAt)}
                  {n.href && (
                    <span className="text-zinc-300 dark:text-zinc-600">→</span>
                  )}
                </span>
              </>
            );

            const className = `flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
              n.read
                ? "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                : "border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800"
            }`;

            // "Confirm attendance for Hip Hop Fusion" is useless if it
            // doesn't take you there, so anything carrying a destination is
            // a link.
            return (
              <li key={n.id}>
                {n.href ? (
                  <Link
                    href={n.href}
                    className={`${className} transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800`}
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
