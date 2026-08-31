"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/** The date bar that sits at the top of every week-based screen.
 *
 * It used to be a pair of arrows halfway down the page, which meant two
 * things: you had to scroll to find out which week you were even looking at,
 * and getting to a week a month out took eight clicks. Both are fixed here
 * rather than per screen, so Conflict Review, Spaces and My Conflicts can't
 * drift apart again.
 *
 * All navigation goes through the `?week=` URL parameter, so a week is
 * linkable and the back button works. The value is any date in the week —
 * the server normalises it to that week's Monday — which is what lets the
 * date picker jump to an arbitrary day without the caller doing any
 * arithmetic.
 */
export function WeekNav({
  basePath,
  onNavigate,
  weekStartKey,
  weekLabel,
  todayKey,
  children,
}: {
  /** Where the week parameter is applied, e.g. "/admin/conflicts". Omit when
   * passing `onNavigate`. */
  basePath?: string;
  /** Used instead of links when the week lives in client state rather than the
   * URL — the Schedule Builder, whose FullCalendar grid owns the visible
   * range. Receives the "YYYY-MM-DD" to move to. */
  onNavigate?: (dateKey: string) => void;
  /** The week being shown, as "YYYY-MM-DD". */
  weekStartKey: string;
  /** "Aug 3 – Aug 9", already formatted in the app's timezone. */
  weekLabel: string;
  /** Today in the app's timezone, computed on the server so the Today button
   * doesn't depend on the viewer's device clock. */
  todayKey: string;
  /** Status for the right-hand side — "63 of 67 still to review" and the
   * like. Optional; the bar is the same shape without it. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const href = (key: string) => `${basePath}?week=${key}`;
  const nav = (key: string) =>
    onNavigate ? { onClick: () => onNavigate(key) } : { href: href(key) };
  const go = (key: string) => {
    if (onNavigate) onNavigate(key);
    else router.push(href(key));
  };
  const isThisWeek = shiftDays(weekStartKey, 0) === weekOf(todayKey);

  return (
    // Sticky, so the week you're looking at stays visible while you scroll a
    // long roster — the question "which week is this?" is the one people were
    // scrolling back up to answer.
    <div className="sticky top-0 z-20 -mx-1 mb-3 rounded-xl border border-line bg-surface/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <Step {...nav(shiftMonths(weekStartKey, -1))} label="Back a month">
          ‹‹
        </Step>
        <Step {...nav(shiftDays(weekStartKey, -7))} label="Back a week">
          ‹
        </Step>

        <span className="min-w-40 text-center text-sm font-medium text-ink">
          {weekLabel}
        </span>

        <Step {...nav(shiftDays(weekStartKey, 7))} label="Forward a week">
          ›
        </Step>
        <Step {...nav(shiftMonths(weekStartKey, 1))} label="Forward a month">
          ››
        </Step>

        {!isThisWeek && (
          <button
            type="button"
            onClick={() => go(todayKey)}
            className="rounded-lg border border-line-strong px-2 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-surface-3"
          >
            This week
          </button>
        )}

        {/* Any date jumps to its week, so "the week of the showcase" is one
            action rather than counting arrow presses. */}
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          <span className="sr-only sm:not-sr-only">Jump to</span>
          <input
            type="date"
            value={weekStartKey}
            onChange={(e) => {
              if (e.target.value) go(e.target.value);
            }}
            className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink"
          />
        </label>

        {children && <div className="ml-auto text-sm">{children}</div>}
      </div>
    </div>
  );
}

const STEP_CLASS =
  "rounded-lg border border-line-strong px-2.5 py-1 text-sm leading-none text-ink-soft transition-colors hover:bg-surface-3";

function Step({
  href,
  onClick,
  label,
  children,
}: {
  href?: string;
  onClick?: () => void;
  label: string;
  children: React.ReactNode;
}) {
  // A real URL stays a link, so middle-click and the back button work. Client
  // state gets a button, because there is no address to point at.
  if (href) {
    return (
      <Link href={href} aria-label={label} title={label} className={STEP_CLASS}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={STEP_CLASS}>
      {children}
    </button>
  );
}

/* Plain calendar arithmetic on the "YYYY-MM-DD" key, anchored at UTC so it
 * can't be dragged across a day boundary by a DST change. These only produce
 * a date to navigate to; the server re-derives the actual week from it in the
 * app's timezone, so nothing here needs to know about Eastern. */

function shiftDays(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function shiftMonths(key: string, months: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  const day = d.getUTCDate();
  // Move on the 1st, then restore the day clamped to the target month's
  // length. Without this, one month on from 31 January lands in March.
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfMonth = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDayOfMonth));
  return d.toISOString().slice(0, 10);
}

/** The Monday on or before a date key, matching how the server derives a
 * week — used only to decide whether to offer the "This week" shortcut. */
function weekOf(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  const weekday = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (weekday === 0 ? -6 : 1 - weekday));
  return d.toISOString().slice(0, 10);
}
