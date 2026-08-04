-- Terms the AD defines once and every date range defaults to, plus the
-- shared spaces calendar and the review queue for titles on it that don't
-- match a known room.

-- A named stretch of the year.
CREATE TABLE "Term" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate"   DATE NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Term_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Term_name_key" ON "Term"("name");
CREATE INDEX "Term_startDate_idx" ON "Term"("startDate");

-- One calendar carrying every room's bookings.
ALTER TABLE "AppSettings" ADD COLUMN "spacesCalendarId"   TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "spacesCalendarName" TEXT;

-- Normalised room name, so calendar titles can be matched loosely.
--
-- Deliberately left NULL for existing rooms rather than backfilled. The
-- normalisation rule lives in src/lib/space-matching.ts and does more than
-- SQL comfortably can (it drops filler words like "Studio" and "Theater"),
-- so writing a second implementation here would guarantee the two drift
-- apart. The app derives the key from the name whenever it is null, and only
-- stores one when the AD resolves a name explicitly.
--
-- NULLs don't collide in a Postgres unique index, so the constraint still
-- protects the keys that are set.
ALTER TABLE "Space" ADD COLUMN "matchKey" TEXT;
CREATE UNIQUE INDEX "Space_matchKey_key" ON "Space"("matchKey");

-- Titles seen on the shared calendar that didn't match a room.
CREATE TABLE "SpaceNameReview" (
    "id"              TEXT NOT NULL,
    "rawTitle"        TEXT NOT NULL,
    "matchKey"        TEXT NOT NULL,
    "eventCount"      INTEGER NOT NULL DEFAULT 0,
    "resolvedSpaceId" TEXT,
    "ignored"         BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceNameReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SpaceNameReview_matchKey_key" ON "SpaceNameReview"("matchKey");
CREATE INDEX "SpaceNameReview_ignored_resolvedSpaceId_idx"
    ON "SpaceNameReview"("ignored", "resolvedSpaceId");

ALTER TABLE "SpaceNameReview"
  ADD CONSTRAINT "SpaceNameReview_resolvedSpaceId_fkey"
  FOREIGN KEY ("resolvedSpaceId") REFERENCES "Space"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
