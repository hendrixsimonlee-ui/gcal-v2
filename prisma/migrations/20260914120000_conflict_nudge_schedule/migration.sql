-- Additive only. Four columns with defaults, so existing rows are valid the
-- moment this runs and the nudge stays off until the AD turns it on.
ALTER TABLE "AppSettings" ADD COLUMN "conflictNudgeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AppSettings" ADD COLUMN "conflictNudgeWeekday" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "AppSettings" ADD COLUMN "conflictNudgeHour" INTEGER NOT NULL DEFAULT 18;
ALTER TABLE "AppSettings" ADD COLUMN "conflictNudgeMinute" INTEGER NOT NULL DEFAULT 0;
