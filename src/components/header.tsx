import Image from "next/image";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";

/** The one bar that's on every screen. Identity on the left, the things you
 * reach for from anywhere on the right — help, what's happened, and who
 * you're signed in as. Deliberately thin: it's a frame, not a screen. */
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
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface/85 px-4 backdrop-blur">
      <Link
        href="/schedule"
        className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ink"
      >
        {/* The real logo, not a letter in a box. Same file the home-screen
            icon uses, so there is one image to change and never two that
            drift apart. */}
        <Image
          src="/icon.png"
          alt=""
          aria-hidden="true"
          width={26}
          height={26}
          className="rounded-lg"
          priority
        />
        PADT
      </Link>

      <div className="flex items-center gap-1 sm:gap-2">
        <Link
          href="/help"
          className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-3 hover:text-ink"
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
          className="relative rounded-lg p-2 text-ink-soft transition-colors hover:bg-surface-3 hover:text-ink"
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
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold tabular-nums text-on-accent">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Link>

        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />

        {userImage ? (
          <Image
            src={userImage}
            alt=""
            width={28}
            height={28}
            className="rounded-full ring-1 ring-line"
          />
        ) : (
          <div
            aria-hidden="true"
            className="grid h-7 w-7 place-content-center rounded-full bg-surface-3 text-xs font-semibold text-ink-soft"
          >
            {(userName ?? "?").trim().charAt(0).toUpperCase()}
          </div>
        )}
        <span className="hidden max-w-32 truncate text-sm text-ink-soft sm:inline">
          {userName}
        </span>
        <SignOutButton />
      </div>
    </header>
  );
}
