-- v2: conflicts lose their categories, attendance becomes self check-in,
-- practices gain notes, planned late arrivals and a team calendar event.
--
-- Hand-written rather than generated so existing data carries over: every
-- conflict keeps the excused/unexcused answer its old category implied, and
-- past absences are re-derived as excused where the person actually had an
-- excused conflict at the time.

-- === Enums ===
CREATE TYPE "ConflictStatus" AS ENUM ('NOT_REVIEWED', 'EXCUSED', 'UNEXCUSED');
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'EXCUSED_ABSENT', 'UNEXCUSED_ABSENT');

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CHECK_IN_OPEN';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ATTENDANCE_DUE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PRACTICE_CHANGED';

-- === Conflict: title instead of note, status instead of category ===
ALTER TABLE "Conflict" RENAME COLUMN "note" TO "title";
ALTER TABLE "Conflict" ADD COLUMN "status" "ConflictStatus" NOT NULL DEFAULT 'NOT_REVIEWED';
ALTER TABLE "Conflict" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "Conflict" ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- Carry over what the category already said, so no past decision is lost.
UPDATE "Conflict" c
SET "status" = CASE WHEN cc."isExcused" THEN 'EXCUSED'::"ConflictStatus"
                    ELSE 'UNEXCUSED'::"ConflictStatus" END
FROM "ConflictCategory" cc
WHERE c."categoryId" = cc."id";

ALTER TABLE "Conflict" DROP CONSTRAINT IF EXISTS "Conflict_categoryId_fkey";
ALTER TABLE "Conflict" DROP COLUMN "categoryId";
DROP TABLE "ConflictCategory";

CREATE INDEX "Conflict_status_idx" ON "Conflict"("status");
ALTER TABLE "Conflict" ADD CONSTRAINT "Conflict_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- === Practice ===
ALTER TABLE "Practice" ADD COLUMN "actualStartTime" TIMESTAMP(3);
ALTER TABLE "Practice" ADD COLUMN "attendanceSubmittedAt" TIMESTAMP(3);
ALTER TABLE "Practice" ADD COLUMN "attendanceSubmittedById" TEXT;
ALTER TABLE "Practice" ADD COLUMN "googleEventId" TEXT;
ALTER TABLE "Practice" ADD CONSTRAINT "Practice_attendanceSubmittedById_fkey"
  FOREIGN KEY ("attendanceSubmittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- === Attendance: a status, a check-in time, and minutes late ===
ALTER TABLE "Attendance" ADD COLUMN "status" "AttendanceStatus";
UPDATE "Attendance"
SET "status" = CASE WHEN "attended" THEN 'PRESENT'::"AttendanceStatus"
                    ELSE 'UNEXCUSED_ABSENT'::"AttendanceStatus" END;

-- The old model worked out excused-ness when reading rather than storing it.
-- Re-derive it once here so history doesn't suddenly read as unexcused.
UPDATE "Attendance" a
SET "status" = 'EXCUSED_ABSENT'::"AttendanceStatus"
FROM "Practice" p
WHERE a."practiceId" = p."id"
  AND a."status" = 'UNEXCUSED_ABSENT'::"AttendanceStatus"
  AND (
    EXISTS (
      SELECT 1 FROM "Conflict" c
      WHERE c."userId" = a."userId"
        AND c."status" = 'EXCUSED'::"ConflictStatus"
        AND c."startDateTime" < p."endDateTime"
        AND c."endDateTime" > p."startDateTime"
    )
    OR EXISTS (
      SELECT 1 FROM "Unavailability" u
      WHERE u."userId" = a."userId"
        AND u."startDate" <= p."startDateTime"
        AND u."endDate" >= p."startDateTime"
    )
  );

ALTER TABLE "Attendance" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "Attendance" DROP COLUMN "attended";
ALTER TABLE "Attendance" ADD COLUMN "checkedInAt" TIMESTAMP(3);
ALTER TABLE "Attendance" ADD COLUMN "minutesLate" INTEGER;
ALTER TABLE "Attendance" ADD COLUMN "isOverride" BOOLEAN NOT NULL DEFAULT false;

-- === Planned late arrivals ===
CREATE TABLE "PlannedArrival" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "arriveAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlannedArrival_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlannedArrival_practiceId_userId_key" ON "PlannedArrival"("practiceId", "userId");
CREATE INDEX "PlannedArrival_userId_idx" ON "PlannedArrival"("userId");
ALTER TABLE "PlannedArrival" ADD CONSTRAINT "PlannedArrival_practiceId_fkey"
  FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlannedArrival" ADD CONSTRAINT "PlannedArrival_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- === Notes ===
CREATE TABLE "PracticeNote" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "subjectUserId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PracticeNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PracticeNote_practiceId_idx" ON "PracticeNote"("practiceId");
CREATE INDEX "PracticeNote_subjectUserId_idx" ON "PracticeNote"("subjectUserId");
ALTER TABLE "PracticeNote" ADD CONSTRAINT "PracticeNote_practiceId_fkey"
  FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeNote" ADD CONSTRAINT "PracticeNote_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeNote" ADD CONSTRAINT "PracticeNote_subjectUserId_fkey"
  FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- === Push subscriptions ===
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- === Settings and notifications ===
ALTER TABLE "AppSettings" ADD COLUMN "teamCalendarId" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "teamCalendarName" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "lateThresholdMinutes" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Notification" ADD COLUMN "href" TEXT;
