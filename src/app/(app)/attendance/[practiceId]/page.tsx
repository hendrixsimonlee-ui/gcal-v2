import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPracticeAttendance } from "@/lib/attendance-data";
import { AttendanceCheckOffForm } from "@/components/attendance-check-off-form";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function PracticeCheckOffPage({
  params,
}: {
  params: Promise<{ practiceId: string }>;
}) {
  const { practiceId } = await params;
  const session = await auth();
  const user = session!.user;

  const practice = await getPracticeAttendance(practiceId);

  // Only this dance's choreographers (or the AD) may mark attendance.
  if (!user.isAdmin) {
    const membership = await prisma.danceMembership.findFirst({
      where: {
        danceId: practice.danceId,
        userId: user.id,
        role: "CHOREOGRAPHER",
      },
      select: { id: true },
    });
    if (!membership) redirect("/attendance");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/attendance"
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← All practices
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {practice.danceName}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {dateFormatter.format(practice.startDateTime)}
          {practice.spaceName ? ` · ${practice.spaceName}` : ""}
        </p>
      </div>

      <AttendanceCheckOffForm practiceId={practiceId} rows={practice.rows} />
    </div>
  );
}
