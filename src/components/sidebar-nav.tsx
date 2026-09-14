"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = {
  href: string;
  label: string;
  /** What the phone tab bar says, where there is room for one short word.
   *
   * Stripping "My " off the full label used to do this, which gave a
   * choreographer two tabs both reading "Attendance" — their own record and
   * the one they check off for everyone. Each tab names itself instead. */
  shortLabel?: string;
};

/** Navigation that changes shape rather than just shrinking.
 *
 * On a desktop it's a sidebar, which is where an admin console's navigation
 * belongs. On a phone a short list becomes a bottom tab bar — the personal
 * screens are used standing in a studio, one-handed, and the bottom of the
 * screen is the only part a thumb reaches comfortably. The admin console has
 * too many destinations for tabs, so there it stays a scrolling strip.
 *
 * Nothing is hidden behind a menu in either shape: every destination is one
 * tap away, which is the whole point of there being few of them. */
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

  // Five is where thumbs stop being able to hit targets accurately.
  const useTabBar = items.length <= 5;

  return (
    <>
      {/* Phone */}
      {useTabBar ? (
        <nav
          aria-label="Main"
          // Lifted clear of the home indicator, not just inside the safe
          // area. `env(safe-area-inset-bottom)` stops labels being *covered*
          // by the bar, but on a modern iPhone that leaves them sitting right
          // on the island, which reads as cramped and makes the bottom row of
          // pixels hard to hit. The extra 0.625rem is the gap.
          className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[calc(env(safe-area-inset-bottom)+0.625rem)] sm:hidden"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-1 px-1 py-3 text-[11px] font-medium transition-colors ${ isActive(item.href)
                  ? "text-accent-ink"
                  : "text-ink-faint hover:text-ink"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-0.5 w-6 rounded-full transition-colors ${ isActive(item.href) ? "bg-accent" : "bg-transparent"
                }`}
              />
              <span className="truncate text-center leading-tight">
                {item.shortLabel ?? item.label.replace(/^My /, "")}
              </span>
            </Link>
          ))}
          {switchLink && (
            <Link
              href={switchLink.href}
              className="flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-1 px-1 py-3 text-[11px] font-medium text-ink-faint transition-colors hover:text-ink"
            >
              <span aria-hidden="true" className="h-0.5 w-6" />
              <span className="truncate text-center leading-tight">
                {switchLink.shortLabel ??
                  switchLink.label.replace(/^[←→]\s*/, "").replace(/\s*[←→]$/, "")}
              </span>
            </Link>
          )}
        </nav>
      ) : (
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
              {item.label}
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
      )}

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
