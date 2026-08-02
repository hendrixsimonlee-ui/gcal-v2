"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = {
  href: string;
  label: string;
};

export function SidebarNav({
  items,
  switchLink,
}: {
  items: NavItem[];
  switchLink?: NavItem;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex w-full shrink-0 items-center gap-2 overflow-x-auto border-b border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950 sm:h-full sm:w-56 sm:flex-col sm:items-stretch sm:justify-between sm:overflow-x-visible sm:border-b-0 sm:border-r sm:p-3">
      <ul className="flex shrink-0 gap-1 sm:flex-col">
        {items.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                className={`block whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "text-zinc-700 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>

      {switchLink && (
        <Link
          href={switchLink.href}
          className="block shrink-0 whitespace-nowrap rounded-md border border-zinc-300 px-3 py-2 text-center text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 sm:mt-3"
        >
          {switchLink.label}
        </Link>
      )}
    </nav>
  );
}
