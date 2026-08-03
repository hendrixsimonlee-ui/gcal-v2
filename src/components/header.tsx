import Image from "next/image";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";

export function Header({
  userName,
  userImage,
  unreadCount = 0,
}: {
  userName: string | null | undefined;
  userImage: string | null | undefined;
  unreadCount?: number;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950">
      <span className="font-semibold text-zinc-900 dark:text-zinc-50">
        Dance Scheduler
      </span>
      <div className="flex items-center gap-3">
        <Link
          href="/help"
          aria-label="How this works"
          title="How this works"
          className="rounded-md px-2 py-1 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          Help
        </Link>
        <Link
          href="/notifications"
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : "Notifications"
          }
          className="relative rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Link>
        {userImage ? (
          <Image
            src={userImage}
            alt={userName ?? "User"}
            width={28}
            height={28}
            className="rounded-full"
          />
        ) : (
          <div className="h-7 w-7 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        )}
        <span className="hidden text-sm text-zinc-700 sm:inline dark:text-zinc-300">
          {userName}
        </span>
        <SignOutButton />
      </div>
    </header>
  );
}
