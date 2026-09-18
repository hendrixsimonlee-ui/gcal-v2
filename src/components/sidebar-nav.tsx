"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = {
  href: string;
  label: string;
  /** A shorter name for the phone strip, where four pills have to share 390
   * points of screen. The sidebar and the desktop nav always show the full
   * label; only the phone strip falls back to this. */
  shortLabel?: string;
};

/** Navigation that changes shape rather than just shrinking.
 *
 * On a desktop it's a sidebar. On a phone it's a strip across the top, the
 * same one on both sides of the app.
 *
 * The personal screens used to get a fixed bottom tab bar instead, on the
 * reasoning that a thumb reaches the bottom of a phone most easily. That was
 * true and still wrong: it made the dancer side and the admin side look like
 * two different apps, and on an installed web app the bar sat on the home
 * indicator, competing with the iPhone's own gesture area. One shape for
 * everybody is easier to explain and easier to hand over.
 *
 * Nothing is hidden behind a menu in either shape: every destination is one
 * tap away. */
export function SidebarNav({
  items,
  switchLink,
}: {
  items: NavItem[];
  switchLink?: NavItem;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Phone */}
      <nav
        aria-label="Main"
        className="flex w-full shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-2 sm:hidden"
      >
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${ isActive(item.href)
                ? "bg-accent text-on-accent"
                : "text-ink-soft hover:bg-surface-3 hover:text-ink"
            }`}
          >
            {item.shortLabel ?? item.label}
          </Link>
        ))}
        {switchLink && (
          <Link
            href={switchLink.href}
            className="shrink-0 whitespace-nowrap rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {switchLink.shortLabel ?? switchLink.label}
          </Link>
        )}
      </nav>

      {/* Desktop */}
      <nav
        aria-label="Main"
        className="hidden shrink-0 flex-col justify-between self-stretch border-r border-line bg-surface p-3 sm:flex sm:w-56"
      >
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${ isActive(item.href)
                    ? "bg-accent-soft text-accent-ink"
                    : "text-ink-soft hover:bg-surface-3 hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        {switchLink && (
          <Link
            href={switchLink.href}
            className="mt-3 block rounded-lg border border-line-strong px-3 py-2 text-center text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {switchLink.label}
          </Link>
        )}
      </nav>
    </>
  );
}
