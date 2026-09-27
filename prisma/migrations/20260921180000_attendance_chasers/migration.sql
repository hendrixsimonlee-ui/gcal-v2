-- Two new notification kinds: the day-after chase to a choreographer who
-- hasn't submitted, and the AD's Monday prompt to go through last week.
--
-- Separate values rather than reusing ATTENDANCE_DUE because the cron
-- de-duplicates on type and message. Sharing a type would let the nudge sent
-- when a practice ends suppress the chase sent a day later, which is exactly
-- the message that matters.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ATTENDANCE_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ATTENDANCE_REVIEW_DUE';
