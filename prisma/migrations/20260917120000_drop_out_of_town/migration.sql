-- Out-of-town windows are gone; a whole day away is now an all-day conflict.
--
-- Nothing is thrown away. Every existing away window is first rewritten as a
-- conflict covering the same days, so somebody who told the app they were
-- home for fall break stays unavailable for exactly those days and the
-- scheduler keeps working around them.
--
-- Eastern, not UTC. A window is stored as bare calendar days at UTC midnight,
-- and the app reads conflicts as real instants — so the start is 00:00
-- Eastern on the first day and the end is 00:00 Eastern on the day *after*
-- the last, which is the close of the final day. AT TIME ZONE does the
-- conversion, and handles the March and November transitions on its own.
--
-- Marked EXCUSED because that is what an away window meant: the AD had been
-- told, and the person wasn't counted absent for it.
INSERT INTO "Conflict" (
  "id", "userId", "weekOf", "startDateTime", "endDateTime",
  "title", "status", "createdAt", "updatedAt"
)
SELECT
  -- Deterministic id from the source row, so re-running can't duplicate.
  'oot_' || u."id",
  u."userId",
  -- weekOf is the Monday of the week the window starts in, as @db.Date.
  (date_trunc('week', (u."startDate"::date)::timestamp))::date,
  -- Eastern midnight, expressed back as the UTC wall clock the column holds.
  -- The trailing AT TIME ZONE 'UTC' is not redundant: without it the cast
  -- from timestamptz to timestamp uses the *session* timezone, which is UTC
  -- on Neon today and is not something worth depending on.
  (((u."startDate"::date)::timestamp AT TIME ZONE 'America/New_York') AT TIME ZONE 'UTC'),
  ((((u."endDate"::date + 1)::timestamp) AT TIME ZONE 'America/New_York') AT TIME ZONE 'UTC'),
  COALESCE(NULLIF(TRIM(u."reason"), ''), 'Away'),
  'EXCUSED',
  NOW(),
  NOW()
FROM "Unavailability" u
WHERE NOT EXISTS (
  SELECT 1 FROM "Conflict" c WHERE c."id" = 'oot_' || u."id"
);

DROP TABLE "Unavailability";
