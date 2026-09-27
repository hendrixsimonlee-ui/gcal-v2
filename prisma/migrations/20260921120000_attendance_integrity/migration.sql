-- Attendance integrity: separate what was measured from what was decided.
--
-- The bug this exists to close: a status change wrote `minutesLate = 0`, so
-- marking somebody "here" deleted the fourteen minutes they had actually been
-- late by, and the charge that went with them. The reverse was just as bad —
-- marking somebody "late" left the minutes at zero, so no charge was ever
-- worked out.
--
-- Nothing here deletes or rewrites a record. Two columns are added, one of
-- them backfilled from data that was already on the row, and the disagreements
-- between them are what the AD reviews. What anybody owes is unchanged by this
-- migration.

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "cameDespiteExcusal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lateMinutesSetAt" TIMESTAMP(3),
ADD COLUMN     "lateMinutesSetById" TEXT,
ADD COLUMN     "measuredMinutesLate" INTEGER;

-- CreateTable
CREATE TABLE "AttendanceFlag" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceFlag_practiceId_idx" ON "AttendanceFlag"("practiceId");

-- CreateIndex
CREATE INDEX "AttendanceFlag_resolvedAt_idx" ON "AttendanceFlag"("resolvedAt");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_lateMinutesSetById_fkey" FOREIGN KEY ("lateMinutesSetById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceFlag" ADD CONSTRAINT "AttendanceFlag_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceFlag" ADD CONSTRAINT "AttendanceFlag_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceFlag" ADD CONSTRAINT "AttendanceFlag_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceFlag" ADD CONSTRAINT "AttendanceFlag_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill what the arithmetic says, from what is still on the row.
--
-- `checkedInAt` was never touched by the bug, and neither was the practice's
-- real start time or anybody's agreed arrival. So the minutes that were erased
-- are not gone: they can be worked out again from the three of them, which is
-- exactly what this does.
--
-- It writes only to `measuredMinutesLate`. `minutesLate` — the column the
-- charge ladder reads — is left exactly as it is, so no fee moves because of
-- this migration. Where the two disagree the AD gets a row to review, and the
-- decision stays theirs.
UPDATE "Attendance" a
SET "measuredMinutesLate" = GREATEST(
  0,
  -- ROUND, not CEIL, and the agreed arrival used outright rather than as a
  -- floor: both match `computeMinutesLate` in src/lib/attendance.ts exactly.
  -- A backfill that rounds differently from the live code would manufacture
  -- one-minute disagreements on hundreds of rows and bury the real ones.
  ROUND(EXTRACT(EPOCH FROM (a."checkedInAt" - src."baseline")) / 60.0)::int
)
FROM (
  -- The join lives in here because Postgres will not let an UPDATE ... FROM
  -- reference the row being updated from inside a LEFT JOIN condition.
  SELECT
    att."id" AS "attendanceId",
    COALESCE(pa."arriveAt", p."actualStartTime", p."startDateTime") AS "baseline"
  FROM "Attendance" att
  JOIN "Practice" p ON p."id" = att."practiceId"
  LEFT JOIN "PlannedArrival" pa
    ON pa."practiceId" = att."practiceId" AND pa."userId" = att."userId"
  WHERE att."checkedInAt" IS NOT NULL
) src
WHERE a."id" = src."attendanceId";

-- Nobody who never checked in has a measured lateness. Leaving it NULL rather
-- than 0 keeps "there is no measurement" distinct from "measured, and it was
-- nothing" — the AD reviewing a disagreement needs to tell those apart.
