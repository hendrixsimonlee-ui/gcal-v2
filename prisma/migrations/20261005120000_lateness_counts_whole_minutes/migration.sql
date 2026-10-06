-- Lateness counts whole elapsed minutes, and the rows that rounded get fixed.
--
-- `computeMinutesLate` rounded to the nearest minute. So somebody walking into
-- a six o'clock rehearsal at 6:04:30 was written down as five minutes late —
-- and five minutes is where the money starts, so the app charged them a dollar
-- for being four and a half minutes late while every clock in the room, and
-- every screen in the app, said 6:04. The code now floors: you are five
-- minutes late at 6:05:00 and not a second before.
--
-- This migration brings the stored rows into line with that. It is arithmetic
-- on `checkedInAt`, which nothing has ever written to but the dancer's own
-- check-in, so there is no guesswork in it.
--
-- Three rules it holds to:
--
--   * **Downward only.** Flooring can only ever make a figure smaller, by at
--     most one minute. Nobody's charge goes up because of this.
--   * **Nothing a person decided is touched.** A figure the AD set by hand,
--     and anyone excused who came anyway and is deliberately not charged, are
--     both left exactly as they are. So is any row whose stored minutes aren't
--     what the old maths would have produced — that is somebody's edit, from
--     before `lateMinutesSetById` existed to record it, and it stands.
--   * **No row is deleted and no column is dropped.** Check-in times, notes,
--     waivers, who marked what and when: all untouched.

-- 1. What the measurement actually says, re-derived for every check-in.
--
-- `measuredMinutesLate` is the honest reading taken at the door; it feeds the
-- AD's review and never the ledger, so correcting it moves no money by itself.
UPDATE "Attendance" a
SET "measuredMinutesLate" = GREATEST(
  0,
  FLOOR(EXTRACT(EPOCH FROM (a."checkedInAt" - src."baseline")) / 60.0)::int
)
FROM (
  -- Same baseline as the live code: an agreed arrival if there is one, else
  -- the practice's real start, else the time it was meant to start. The join
  -- lives in a subquery because Postgres will not let an UPDATE ... FROM
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

-- 2. The charged figure, where the rounding is the only thing that put it
--    there — and the status with it, in the same statement, so the two can
--    never be seen disagreeing.
--
-- Whether a minute matters depends entirely on where it falls: five down to
-- four is the difference between owing a dollar and owing nothing, fifteen
-- down to fourteen is five dollars down to two, and eight down to seven costs
-- exactly the same either way. So the ladder itself decides what gets
-- reported — every row whose charge actually moves raises a flag with the old
-- and new amount in it, and the rows that merely read one minute lower pass
-- without troubling anybody.
WITH threshold AS (
  SELECT COALESCE(
    (SELECT "lateThresholdMinutes" FROM "AppSettings" WHERE "id" = 'singleton'),
    5
  ) AS "minutes"
),
-- The fee ladders, as the app reads them: whichever schedule was in force on
-- the day, falling back to the oldest one for a practice older than all of
-- them, and to the ladder shipped in the code if none has ever been set up.
-- A missing ladder must never silently price everything at nothing.
ladder AS (
  SELECT t."scheduleId" AS "sid", s."effectiveFrom" AS "eff",
         t."fromMinutes" AS "fm", t."cents" AS "cents"
  FROM "FeeTier" t
  JOIN "FeeSchedule" s ON s."id" = t."scheduleId"
  UNION ALL
  SELECT '__shipped__', DATE '1970-01-01', v."fm", v."cents"
  FROM (VALUES (5, 100), (10, 200), (15, 500), (30, 1000)) AS v("fm", "cents")
  WHERE NOT EXISTS (SELECT 1 FROM "FeeTier")
),
candidate AS (
  SELECT
    att."id" AS "attendanceId",
    att."practiceId",
    att."userId",
    att."status" AS "oldStatus",
    att."minutesLate" AS "oldMinutes",
    p."startDateTime" AS "practiceStart",
    GREATEST(
      0,
      FLOOR(
        EXTRACT(EPOCH FROM (att."checkedInAt" - COALESCE(pa."arriveAt", p."actualStartTime", p."startDateTime"))) / 60.0
      )::int
    ) AS "flooredMinutes",
    GREATEST(
      0,
      ROUND(
        EXTRACT(EPOCH FROM (att."checkedInAt" - COALESCE(pa."arriveAt", p."actualStartTime", p."startDateTime"))) / 60.0
      )::int
    ) AS "roundedMinutes"
  FROM "Attendance" att
  JOIN "Practice" p ON p."id" = att."practiceId"
  LEFT JOIN "PlannedArrival" pa
    ON pa."practiceId" = att."practiceId" AND pa."userId" = att."userId"
  WHERE att."checkedInAt" IS NOT NULL
    AND att."minutesLate" IS NOT NULL
    -- A figure somebody decided on is not a rounding error.
    AND att."lateMinutesSetById" IS NULL
    AND att."cameDespiteExcusal" = false
),
eligible AS (
  SELECT c.*, t."minutes" AS "threshold"
  FROM candidate c
  CROSS JOIN threshold t
  WHERE c."flooredMinutes" < c."oldMinutes"
    -- What is stored is exactly what the old maths produced, so the rounding
    -- is the whole explanation for it. Anything else is an edit, and stands.
    AND c."oldMinutes" = c."roundedMinutes"
),
priced AS (
  SELECT
    e.*,
    COALESCE((
      SELECT l."cents" FROM ladder l
      WHERE l."sid" = sched."sid" AND l."fm" <= e."oldMinutes"
      ORDER BY l."fm" DESC LIMIT 1
    ), 0) AS "oldCents",
    COALESCE((
      SELECT l."cents" FROM ladder l
      WHERE l."sid" = sched."sid" AND l."fm" <= e."flooredMinutes"
      ORDER BY l."fm" DESC LIMIT 1
    ), 0) AS "newCents"
  FROM eligible e
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      (SELECT l."sid" FROM ladder l WHERE l."eff" <= e."practiceStart"
       ORDER BY l."eff" DESC LIMIT 1),
      (SELECT l."sid" FROM ladder l ORDER BY l."eff" ASC LIMIT 1)
    ) AS "sid"
  ) sched
),
corrected AS (
  UPDATE "Attendance" a
  SET
    "minutesLate" = pr."flooredMinutes",
    "status" = CASE
      WHEN a."status" IN ('PRESENT', 'LATE')
        THEN (
          CASE WHEN pr."flooredMinutes" >= pr."threshold" THEN 'LATE' ELSE 'PRESENT' END
        )::"AttendanceStatus"
      -- An absence stays an absence. How late a number says somebody was has
      -- no bearing on a row that says they weren't there.
      ELSE a."status"
    END
  FROM priced pr
  WHERE a."id" = pr."attendanceId"
  RETURNING
    a."id",
    pr."practiceId",
    pr."userId",
    pr."oldMinutes",
    pr."flooredMinutes",
    pr."oldCents",
    pr."newCents"
)
INSERT INTO "AttendanceFlag" (
  "id", "practiceId", "subjectUserId", "raisedById", "body", "isAutomatic", "createdAt"
)
SELECT
  'rnd_' || replace(gen_random_uuid()::text, '-', ''),
  c."practiceId",
  c."userId",
  -- Nobody raised these; it is the app owning up. Filing them against the
  -- dancer matches how the app's other automatic flags are recorded.
  c."userId",
  'Lateness recount: this was stored as ' || c."oldMinutes" ||
    ' minutes late, but the check-in time was under that — the old maths '
    || 'rounded up. It is now ' || c."flooredMinutes" || ' minutes, so the '
    || 'charge goes from $' || to_char(c."oldCents" / 100.0, 'FM999990.00')
    || ' to $' || to_char(c."newCents" / 100.0, 'FM999990.00') || '.',
  true,
  CURRENT_TIMESTAMP
FROM corrected c
WHERE c."newCents" <> c."oldCents";
