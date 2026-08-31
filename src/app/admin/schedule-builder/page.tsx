import { prisma } from "@/lib/prisma";
import { addDays } from "@/lib/dates";
import { ScheduleBuilder } from "@/components/schedule-builder/schedule-builder";

export default async function ScheduleBuilderPage() {
  const [dances, spaces, practices] = await Promise.all([
    prisma.dance.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      include: { memberships: { select: { userId: true } } },
    }),
    prisma.space.findMany({
      orderBy: { name: "asc" },
      include: {
        bookings: {
          where: { date: { gte: addDays(new Date(), -14) } },
          orderBy: [{ date: "asc" }, { startTime: "asc" }],
        },
      },
    }),
    prisma.practice.findMany({
      where: {
        dance: { archivedAt: null },
        startDateTime: {
          gte: addDays(new Date(), -14),
          lte: addDays(new Date(), 60),
        },
      },
      include: {
        dance: true,
        space: true,
        plannedArrivals: { include: { user: true } },
      },
      orderBy: { startDateTime: "asc" },
    }),
  ]);

  if (dances.length === 0 || spaces.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-ink">
          Schedule Builder
        </h1>
        <p className="text-sm text-ink-soft">
          You need at least one dance and one space set up before you can
          build a schedule. Head to{" "}
          <span className="font-medium">Dances</span> and{" "}
          <span className="font-medium">Spaces</span> first.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">
          Schedule Builder
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-soft">
          Everything here is a draft until you publish. Drafts hold their room
          so nothing double-books, but nobody outside this screen sees them.
        </p>
      </div>
      <ScheduleBuilder
      dances={dances.map((d) => ({
        id: d.id,
        name: d.name,
        castUserIds: d.memberships.map((m) => m.userId),
        defaultDurationMinutes: d.defaultDurationMinutes,
      }))}
      spaces={spaces.map((s) => ({
        id: s.id,
        name: s.name,
        // Every bookable window is now a dated block off the spaces calendar.
        // The date is the bare "YYYY-MM-DD" the column holds, read in UTC to
        // match how @db.Date is anchored.
        bookings: s.bookings.map((b) => ({
          id: b.id,
          dateKey: b.date.toISOString().slice(0, 10),
          startTime: b.startTime,
          endTime: b.endTime,
        })),
      }))}
      initialPractices={practices.map((p) => ({
        id: p.id,
        danceId: p.danceId,
        danceName: p.dance.name,
        spaceId: p.spaceId,
        spaceName: p.space?.name ?? null,
        startDateTime: p.startDateTime.toISOString(),
        endDateTime: p.endDateTime.toISOString(),
        status: p.status,
        plannedArrivals: p.plannedArrivals.map((a) => ({
          userId: a.userId,
          name: a.user.name ?? a.user.email,
          arriveAt: a.arriveAt.toISOString(),
        })),
      }))}
      />
    </div>
  );
}
