import { prisma } from "@/lib/prisma";
import { SpacesCalendarPanel } from "@/components/spaces-calendar-panel";
import { listTerms } from "@/lib/terms";
import { addDays, formatWeekLabel, parseWeekParam, toDateParam } from "@/lib/dates";

/** Spaces is now a view of one Google calendar, not a place to manage rooms.
 *
 * Everything the AD used to type in here — rooms, weekly hours, one-off
 * openings and closures — is gone. A room exists because somebody booked it
 * on the shared calendar, which is the only record that can be checked
 * against reality. */
export default async function SpacesPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const weekStart = parseWeekParam(week);

  const [terms, settings] = await Promise.all([
    listTerms(),
    prisma.appSettings.findUnique({
      where: { id: "singleton" },
      select: { spacesCalendarName: true },
    }),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Spaces</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          Book rooms on the spaces calendar in Google, then sync. Editing a
          block here writes back to that calendar, so the two can never
          disagree about what the team actually has.
        </p>
      </div>

      <SpacesCalendarPanel
        calendarName={settings?.spacesCalendarName ?? null}
        terms={terms}
        weekStartIso={weekStart.toISOString()}
        weekLabel={formatWeekLabel(weekStart)}
        prevWeek={toDateParam(addDays(weekStart, -7))}
        nextWeek={toDateParam(addDays(weekStart, 7))}
      />
    </div>
  );
}
