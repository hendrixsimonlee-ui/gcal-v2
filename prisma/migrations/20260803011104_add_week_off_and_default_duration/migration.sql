-- AlterTable
ALTER TABLE "Dance" ADD COLUMN     "defaultDurationMinutes" INTEGER NOT NULL DEFAULT 90;

-- CreateTable
CREATE TABLE "DanceWeekOff" (
    "id" TEXT NOT NULL,
    "danceId" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DanceWeekOff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DanceWeekOff_weekOf_idx" ON "DanceWeekOff"("weekOf");

-- CreateIndex
CREATE UNIQUE INDEX "DanceWeekOff_danceId_weekOf_key" ON "DanceWeekOff"("danceId", "weekOf");

-- AddForeignKey
ALTER TABLE "DanceWeekOff" ADD CONSTRAINT "DanceWeekOff_danceId_fkey" FOREIGN KEY ("danceId") REFERENCES "Dance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
