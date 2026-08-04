import { prisma } from "@/lib/prisma";
import { addDays, formatWeekLabel, parseWeekParam, toDateParam } from "@/lib/dates";
import { ConflictReview } from "@/components/conflict-review";

/** The AD's weekly triage. Grouped by person, title first, one decision per
 * conflict: excused or not. Dancers don't categorise anything any more, so
 * this screen is where excused-ness comes from. */
export default async function AdminConflictsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const weekStart = parseWeekParam(week);

  const weekEnd = addDays(weekStart, 7);

  const [conflicts, awayThisWeek] = await Promise.all([
    prisma.conflict.findMany({
      where: { weekOf: weekStart },
      orderBy: [{ startDateTime: "asc" }],
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    // Out-of-town windows aren't conflicts and can't be excused — but they
    // take someone out of scheduling entirely, so the AD has to be able to
    // see who's gone rather than wondering why the suggestions changed.
    prisma.unavailability.findMany({
      where: { startDate: { lt: weekEnd }, endDate: { gte: weekStart } },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { startDate: "asc" },
    }),
  ]);

  const byPerson = new Map<
    string,
    {
      userId: string;
      name: string;
      conflicts: {
        id: string;
        title: string | null;
        startDateTime: string;
        endDateTime: string;
        status: "NOT_REVIEWED" | "EXCUSED" | "UNEXCUSED";
        fromGoogle: boolean;
      }[];
    }
  >();

  for (const conflict of conflicts) {
    const key = conflict.userId;
    if (!byPerson.has(key)) {
      byPerson.set(key, {
        userId: key,
        name: conflict.user.name ?? conflict.user.email,
        conflicts: [],
      });
    }
    byPerson.get(key)!.conflicts.push({
      id: conflict.id,
      title: conflict.title,
      startDateTime: conflict.startDateTime.toISOString(),
      endDateTime: conflict.endDateTime.toISOString(),
      status: conflict.status,
      fromGoogle: Boolean(conflict.sourceGoogleEventId),
    });
  }

  // Anyone with unreviewed conflicts floats to the top — that's the work.
  const people = Array.from(byPerson.values()).sort((a, b) => {
    const aTodo = a.conflicts.filter((c) => c.status === "NOT_REVIEWED").length;
    const bTodo = b.conflicts.filter((c) => c.status === "NOT_REVIEWED").length;
    return bTodo - aTodo || a.name.localeCompare(b.name);
  });

  return (
    <ConflictReview
      people={people}
      weekLabel={formatWeekLabel(weekStart)}
      weekOfIso={weekStart.toISOString()}
      prevWeek={toDateParam(addDays(weekStart, -7))}
      nextWeek={toDateParam(addDays(weekStart, 7))}
      awayThisWeek={awayThisWeek.map((u) => ({
        id: u.id,
        name: u.user.name ?? u.user.email,
        startDate: u.startDate.toISOString(),
        endDate: u.endDate.toISOString(),
        reason: u.reason,
      }))}
    />
  );
}
