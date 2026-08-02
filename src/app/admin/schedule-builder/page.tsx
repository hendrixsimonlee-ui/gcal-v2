import { prisma } from "@/lib/prisma";
import { addDays } from "@/lib/dates";
import { ScheduleBuilder } from "@/components/schedule-builder/schedule-builder";

export default async function ScheduleBuilderPage() {
  const [dances, spaces, practices] = await Promise.all([
    prisma.dance.findMany({
      orderBy: { name: "asc" },
      include: { memberships: { select: { userId: true } } },
    }),
    prisma.space.findMany({
      orderBy: { name: "asc" },
      include: { availabilities: true },
    }),
    prisma.practice.findMany({
      where: {
        startDateTime: {
          gte: addDays(new Date(), -14),
          lte: addDays(new Date(), 60),
        },
      },
      include: { dance: true, space: true },
      orderBy: { startDateTime: "asc" },
    }),
  ]);

  if (dances.length === 0 || spaces.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Schedule Builder
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          You need at least one dance and one space set up before you can
          build a schedule. Head to{" "}
          <span className="font-medium">Dances</span> and{" "}
          <span className="font-medium">Spaces</span> first.
        </p>
      </div>
    );
  }

  return (
    <ScheduleBuilder
      dances={dances.map((d) => ({
        id: d.id,
        name: d.name,
        castUserIds: d.memberships.map((m) => m.userId),
      }))}
      spaces={spaces.map((s) => ({
        id: s.id,
        name: s.name,
        availabilities: s.availabilities.map((a) => ({
          id: a.id,
          dayOfWeek: a.dayOfWeek,
          startTime: a.startTime,
          endTime: a.endTime,
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
      }))}
    />
  );
}
