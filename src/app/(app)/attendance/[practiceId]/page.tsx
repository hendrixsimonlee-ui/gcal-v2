import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPracticeAttendance } from "@/lib/attendance-data";
import { getVisiblePracticeNotes } from "@/lib/actions/practice-notes";
import {
  PracticeAttendancePanel,
  type PanelRow,
} from "@/components/practice-attendance-panel";
import { APP_TIME_ZONE } from "@/lib/timezone";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function PracticePage({
  params,
}: {
  params: Promise<{ practiceId: string }>;
}) {
  const { practiceId } = await params;
  const session = await auth();
  const user = session!.user;

  const attendance = await getPracticeAttendance(practiceId);

  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    include: {
      plannedArrivals: true,
      dance: { include: { memberships: { select: { userId: true } } } },
    },
  });

  const membership = await prisma.danceMembership.findFirst({
    where: { danceId: attendance.danceId, userId: user.id, role: "CHOREOGRAPHER" },
    select: { id: true },
  });
  const inCast = practice.dance.memberships.some((m) => m.userId === user.id);
  if (!membership && !user.isAdmin && !inCast) redirect("/attendance");

  const canManage = Boolean(membership) || user.isAdmin === true;

  // Reviewed conflicts are what put someone in the Excused group, so they
  // have to come along with the attendance rows.
  const castIds = practice.dance.memberships.map((m) => m.userId);
  const conflicts = await prisma.conflict.findMany({
    where: {
      userId: { in: castIds },
      startDateTime: { lt: practice.endDateTime },
      endDateTime: { gt: practice.startDateTime },
    },
  });
  const conflictByUser = new Map(conflicts.map((c) => [c.userId, c]));
  const arrivalByUser = new Map(
    practice.plannedArrivals.map((p) => [p.userId, p.arriveAt]),
  );

  const rows: PanelRow[] = attendance.rows.map((row) => {
    const conflict = conflictByUser.get(row.userId);
    return {
      userId: row.userId,
      name: row.name,
      role: row.role,
      status: row.status,
      minutesLate: row.minutesLate,
      checkedInAt: row.checkedInAt?.toISOString() ?? null,
      isOverride: row.isOverride,
      plannedArriveAt: arrivalByUser.get(row.userId)?.toISOString() ?? null,
      conflictStatus:
        conflict && conflict.status !== "NOT_REVIEWED" ? conflict.status : null,
      conflictTitle: conflict?.title ?? null,
    };
  });

  const notes = await getVisiblePracticeNotes(practiceId);
  // Send people back where they came from: their sign-off queue, the AD's
  // review, or — for a dancer who opened this from their own history — that.
  const backHref = membership
    ? "/attendance"
    : user.isAdmin
      ? "/admin/attendance?view=practices"
      : "/my-attendance";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href={backHref}
          className="text-sm text-ink-soft hover:underline"
        >
          ← Back
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          {attendance.danceName}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {dateFormatter.format(attendance.startDateTime)}
          {attendance.spaceName ? ` · ${attendance.spaceName}` : ""}
        </p>
      </div>

      <PracticeAttendancePanel
        practiceId={practiceId}
        rows={rows}
        notes={notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() }))}
        startDateTime={practice.startDateTime.toISOString()}
        actualStartTime={practice.actualStartTime?.toISOString() ?? null}
        submittedAt={practice.attendanceSubmittedAt?.toISOString() ?? null}
        canManage={canManage}
        viewerId={user.id}
        hasStarted={practice.startDateTime <= new Date()}
      />
    </div>
  );
}
