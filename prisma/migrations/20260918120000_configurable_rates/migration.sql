-- Configurable late fees and credit categories.
--
-- Three things happen here, in an order that matters.
--
-- 1. The new tables, including the fee ladder as data instead of constants.
-- 2. The current values are seeded into them, so the app behaves on the first
--    request exactly as it did on the last one. Nothing about what anybody
--    owes changes when this runs.
-- 3. Credits move from an enum column onto the category table, backfilled by
--    name so existing rows keep pointing at the right thing. The column is
--    added nullable, filled, and only then made NOT NULL — adding it NOT NULL
--    outright would fail the moment there is a single credit in the table.

-- CreateTable
CREATE TABLE "FeeSchedule" (
    "id" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

CONSTRAINT "FeeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeTier" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "fromMinutes" INTEGER NOT NULL,
    "cents" INTEGER NOT NULL,

CONSTRAINT "FeeTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),

CONSTRAINT "CreditCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeWaiver" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "waivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "ChargeWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeeSchedule_effectiveFrom_idx" ON "FeeSchedule"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "FeeTier_scheduleId_fromMinutes_key" ON "FeeTier"("scheduleId", "fromMinutes");

-- CreateIndex
CREATE INDEX "CreditCategory_archivedAt_idx" ON "CreditCategory"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeWaiver_attendanceId_key" ON "ChargeWaiver"("attendanceId");

-- AddForeignKey
ALTER TABLE "FeeTier" ADD CONSTRAINT "FeeTier_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "FeeSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeWaiver" ADD CONSTRAINT "ChargeWaiver_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The ladder as it stands today, effective from before any charge exists, so
-- everything already on the board prices exactly as it did before.
INSERT INTO "FeeSchedule" ("id", "effectiveFrom", "note")
VALUES ('feesched_initial', DATE '2026-08-01', 'The original ladder');

INSERT INTO "FeeTier" ("id", "scheduleId", "fromMinutes", "cents") VALUES
  ('feetier_initial_5',  'feesched_initial', 5,  100),
  ('feetier_initial_10', 'feesched_initial', 10, 200),
  ('feetier_initial_15', 'feesched_initial', 15, 500),
  ('feetier_initial_30', 'feesched_initial', 30, 1000);

-- The three categories, with the ids matching the enum values they replace so
-- the backfill below is a straight mapping and stays readable.
INSERT INTO "CreditCategory" ("id", "name", "cents", "sortOrder") VALUES
  ('PAN_ASIAN_TIME',  'Leading Pan-Asian time', 100, 0),
  ('LEAD_WORKSHOP',   'Leading a workshop',     100, 1),
  ('ATTEND_WORKSHOP', 'Attending a workshop',    50, 2);

-- Credits: add, backfill, tighten, then drop the old column.
ALTER TABLE "AttendanceCredit" ADD COLUMN "categoryId" TEXT;
UPDATE "AttendanceCredit" SET "categoryId" = "type"::text;
ALTER TABLE "AttendanceCredit" ALTER COLUMN "categoryId" SET NOT NULL;
ALTER TABLE "AttendanceCredit" DROP COLUMN "type";
DROP TYPE "CreditType";

CREATE INDEX "AttendanceCredit_categoryId_idx" ON "AttendanceCredit"("categoryId");
ALTER TABLE "AttendanceCredit"
  ADD CONSTRAINT "AttendanceCredit_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "CreditCategory"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
