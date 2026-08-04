-- Rooms the spaces sync creates for itself are flagged, so the review list
-- becomes a tidy-up rather than a gate that blocks the first import.
ALTER TABLE "SpaceNameReview" ADD COLUMN "autoCreated" BOOLEAN NOT NULL DEFAULT false;

-- Publishing and announcing are now separate from PROPOSED/CONFIRMED, so
-- editing a published practice stages a change instead of firing at the cast.
ALTER TABLE "Practice" ADD COLUMN "publishedAt" TIMESTAMP(3);
ALTER TABLE "Practice" ADD COLUMN "announcedAt" TIMESTAMP(3);
ALTER TABLE "Practice" ADD COLUMN "pendingAnnouncement" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Practice" ADD COLUMN "pendingChangeNote" TEXT;

-- Anything already confirmed has been announced: backfilling from updatedAt
-- keeps existing practices out of the "changed, not announced" bucket, which
-- would otherwise light up the whole term the moment this ships.
UPDATE "Practice"
SET "publishedAt" = "updatedAt", "announcedAt" = "updatedAt"
WHERE "status" = 'CONFIRMED';

ALTER TYPE "NotificationType" ADD VALUE 'CONFLICTS_DUE';

CREATE TABLE "ConflictSubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekOf" DATE NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "nudgedAt" TIMESTAMP(3),

    CONSTRAINT "ConflictSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConflictSubmission_userId_weekOf_key" ON "ConflictSubmission"("userId", "weekOf");
CREATE INDEX "ConflictSubmission_weekOf_idx" ON "ConflictSubmission"("weekOf");

ALTER TABLE "ConflictSubmission" ADD CONSTRAINT "ConflictSubmission_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AttendanceWeekReview" (
    "id" TEXT NOT NULL,
    "weekOf" DATE NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,

    CONSTRAINT "AttendanceWeekReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttendanceWeekReview_weekOf_key" ON "AttendanceWeekReview"("weekOf");
CREATE INDEX "AttendanceWeekReview_weekOf_idx" ON "AttendanceWeekReview"("weekOf");

ALTER TABLE "AttendanceWeekReview" ADD CONSTRAINT "AttendanceWeekReview_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
