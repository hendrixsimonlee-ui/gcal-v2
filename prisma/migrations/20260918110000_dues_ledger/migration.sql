-- The late charges ledger: earned credits, and whether a month is settled.
--
-- Additive only. Two new tables, one new enum, and one new boolean on User.
-- Nothing existing is altered or dropped, and with no rows in either table
-- every screen behaves exactly as it does today.
--
-- Note what is NOT here: no columns for what anybody owes. Those are worked
-- out from the attendance records and credits whenever they are asked for.
-- Totals stored beside the things they total are totals that drift, which is
-- how the spreadsheet this replaces ended up full of #REF!.


-- CreateEnum
CREATE TYPE "CreditType" AS ENUM ('PAN_ASIAN_TIME', 'LEAD_WORKSHOP', 'ATTEND_WORKSHOP');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isFinanceAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AttendanceCredit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CreditType" NOT NULL,
    "cents" INTEGER NOT NULL,
    "term" TEXT NOT NULL,
    "occurredOn" DATE NOT NULL,
    "note" TEXT,
    "loggedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyDuesSettlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "term" TEXT NOT NULL,
    "venmoRequested" BOOLEAN NOT NULL DEFAULT false,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "settledCents" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "MonthlyDuesSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceCredit_userId_term_idx" ON "AttendanceCredit"("userId", "term");

-- CreateIndex
CREATE INDEX "AttendanceCredit_term_idx" ON "AttendanceCredit"("term");

-- CreateIndex
CREATE INDEX "MonthlyDuesSettlement_term_idx" ON "MonthlyDuesSettlement"("term");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyDuesSettlement_userId_month_year_key" ON "MonthlyDuesSettlement"("userId", "month", "year");

-- AddForeignKey
ALTER TABLE "AttendanceCredit" ADD CONSTRAINT "AttendanceCredit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCredit" ADD CONSTRAINT "AttendanceCredit_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyDuesSettlement" ADD CONSTRAINT "MonthlyDuesSettlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

