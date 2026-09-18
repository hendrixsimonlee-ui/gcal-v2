-- Weeks the AD has switched the conflict reminders off for.
--
-- Additive only: a new table, nothing altered and nothing dropped. With no
-- rows in it the reminders behave exactly as they did before.
CREATE TABLE "ConflictReminderSkip" (
    "weekOf" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictReminderSkip_pkey" PRIMARY KEY ("weekOf")
);
