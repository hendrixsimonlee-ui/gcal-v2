-- Spaces now come only from the shared Google Calendar.
--
-- The fuzzy title matching, the review queue, the per-space calendars, the
-- hand-typed weekly hours and the manual closures all go. An event's title is
-- the room, its location is the location, its times are when the room is ours.

DROP TABLE IF EXISTS "SpaceNameReview";

ALTER TABLE "Space" DROP COLUMN IF EXISTS "googleCalendarId";
ALTER TABLE "Space" DROP COLUMN IF EXISTS "googleCalendarName";
ALTER TABLE "Space" DROP COLUMN IF EXISTS "matchKey";

-- Two rooms can no longer share a name, since the name IS the calendar title.
-- Deduplicate before adding the constraint: keep the oldest row of each name
-- and move everything hanging off the others onto it.
UPDATE "SpaceAvailability" a SET "spaceId" = keeper.id
FROM "Space" dup
JOIN LATERAL (
  SELECT s.id FROM "Space" s
  WHERE s.name = dup.name ORDER BY s."createdAt" ASC LIMIT 1
) keeper ON true
WHERE a."spaceId" = dup.id AND keeper.id <> dup.id;

UPDATE "Practice" p SET "spaceId" = keeper.id
FROM "Space" dup
JOIN LATERAL (
  SELECT s.id FROM "Space" s
  WHERE s.name = dup.name ORDER BY s."createdAt" ASC LIMIT 1
) keeper ON true
WHERE p."spaceId" = dup.id AND keeper.id <> dup.id;

DELETE FROM "Space" dup
USING "Space" other
WHERE dup.name = other.name
  AND (other."createdAt" < dup."createdAt"
       OR (other."createdAt" = dup."createdAt" AND other.id < dup.id));

CREATE UNIQUE INDEX "Space_name_key" ON "Space"("name");

-- SpaceAvailability becomes Booking: one row per calendar event, every column
-- required. Rows that weren't from the calendar can't be represented and are
-- dropped — recurring weekly hours and manual closures are exactly what this
-- change removes.
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "sourceGoogleEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Booking" ("id", "spaceId", "date", "startTime", "endTime", "sourceGoogleEventId", "createdAt", "updatedAt")
SELECT DISTINCT ON ("sourceGoogleEventId")
       "id", "spaceId", "date", "startTime", "endTime", "sourceGoogleEventId", "createdAt", CURRENT_TIMESTAMP
FROM "SpaceAvailability"
WHERE "sourceGoogleEventId" IS NOT NULL
  AND "date" IS NOT NULL
  AND "startTime" IS NOT NULL
  AND "endTime" IS NOT NULL
  AND "isAvailable" = true
ORDER BY "sourceGoogleEventId", "createdAt" ASC;

CREATE UNIQUE INDEX "Booking_sourceGoogleEventId_key" ON "Booking"("sourceGoogleEventId");
CREATE INDEX "Booking_spaceId_date_idx" ON "Booking"("spaceId", "date");
CREATE INDEX "Booking_date_idx" ON "Booking"("date");

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE "SpaceAvailability";

-- One weekly exclusion table for both roles. The dancer half used to be
-- client-side state that vanished on refresh; the choreographer half was this
-- table under a narrower name.
CREATE TABLE "WeeklyExclusion" (
    "id" TEXT NOT NULL,
    "danceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekOf" DATE NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyExclusion_pkey" PRIMARY KEY ("id")
);

INSERT INTO "WeeklyExclusion" ("id", "danceId", "userId", "weekOf", "reason", "createdAt")
SELECT "id", "danceId", "userId", "weekOf", 'Excused this week', "createdAt"
FROM "ChoreographerWeeklyExcuse";

CREATE UNIQUE INDEX "WeeklyExclusion_danceId_userId_weekOf_key" ON "WeeklyExclusion"("danceId", "userId", "weekOf");
CREATE INDEX "WeeklyExclusion_userId_weekOf_idx" ON "WeeklyExclusion"("userId", "weekOf");

ALTER TABLE "WeeklyExclusion" ADD CONSTRAINT "WeeklyExclusion_danceId_fkey"
    FOREIGN KEY ("danceId") REFERENCES "Dance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeeklyExclusion" ADD CONSTRAINT "WeeklyExclusion_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeeklyExclusion" ADD CONSTRAINT "WeeklyExclusion_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE "ChoreographerWeeklyExcuse";

-- Cancelling a week stages its notification instead of sending one.
ALTER TABLE "DanceWeekOff" ADD COLUMN "pendingCancellationNotice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DanceWeekOff" ADD COLUMN "cancelledPracticeCount" INTEGER NOT NULL DEFAULT 0;
