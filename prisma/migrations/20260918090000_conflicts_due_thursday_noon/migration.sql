-- Conflicts are due Thursday at noon, and the reminders are switched on.
--
-- The AD asked for two messages: one at 10am saying conflicts are due in two
-- hours, and the urgent one at noon. Both hang off a single setting — when
-- conflicts are due — so the heads-up is always exactly two hours before it
-- and the two can never drift apart when the deadline moves.
--
-- The default in the schema only applies to a fresh install, and this app
-- already has a settings row on it, so the existing one is updated here too.
-- Otherwise the deadline would have stayed at the old Thursday 6pm and the
-- heads-up would have landed at 4pm, which is not what was asked for.
--
-- Weekday 4 is Thursday, counting Sunday as 0, which is what the app's
-- date handling uses.
--
-- This also turns the reminders ON. They were off by default because they are
-- the only messages in the app that go out without the AD pressing anything;
-- switching them on was the request. To stop them, untick the weekly conflicts
-- reminder in Settings.
UPDATE "AppSettings"
SET "conflictNudgeEnabled" = true,
    "conflictNudgeWeekday" = 4,
    "conflictNudgeHour"    = 12,
    "conflictNudgeMinute"  = 0
WHERE "id" = 'singleton';

-- The column defaults themselves, so a fresh install and this one agree.
--
-- The UPDATE above fixes the row that already exists; this fixes what a new
-- row would get. Without both, the schema says one thing and the database
-- says another, and the next migration generated from a diff quietly carries
-- the difference along with whatever it was actually for.
ALTER TABLE "AppSettings"
  ALTER COLUMN "conflictNudgeEnabled" SET DEFAULT true,
  ALTER COLUMN "conflictNudgeHour" SET DEFAULT 12;
