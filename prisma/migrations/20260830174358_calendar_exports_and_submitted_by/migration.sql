-- AlterTable
ALTER TABLE "ConflictSubmission" ADD COLUMN     "submittedByUserId" TEXT;

-- CreateTable
CREATE TABLE "PracticeCalendarExport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "googleCalendarId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeCalendarExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PracticeCalendarExport_practiceId_idx" ON "PracticeCalendarExport"("practiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeCalendarExport_userId_practiceId_key" ON "PracticeCalendarExport"("userId", "practiceId");

-- AddForeignKey
ALTER TABLE "ConflictSubmission" ADD CONSTRAINT "ConflictSubmission_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeCalendarExport" ADD CONSTRAINT "PracticeCalendarExport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeCalendarExport" ADD CONSTRAINT "PracticeCalendarExport_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
