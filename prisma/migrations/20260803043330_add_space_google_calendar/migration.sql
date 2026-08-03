-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "googleCalendarId" TEXT,
ADD COLUMN     "googleCalendarName" TEXT;

-- AlterTable
ALTER TABLE "SpaceAvailability" ADD COLUMN     "sourceGoogleEventId" TEXT;

-- CreateIndex
CREATE INDEX "SpaceAvailability_sourceGoogleEventId_idx" ON "SpaceAvailability"("sourceGoogleEventId");
