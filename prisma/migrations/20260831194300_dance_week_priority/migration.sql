-- CreateTable
CREATE TABLE "DanceWeekPriority" (
    "id" TEXT NOT NULL,
    "danceId" TEXT NOT NULL,
    "weekOf" DATE NOT NULL,
    "setById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DanceWeekPriority_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DanceWeekPriority_weekOf_idx" ON "DanceWeekPriority"("weekOf");

-- CreateIndex
CREATE UNIQUE INDEX "DanceWeekPriority_danceId_weekOf_key" ON "DanceWeekPriority"("danceId", "weekOf");

-- AddForeignKey
ALTER TABLE "DanceWeekPriority" ADD CONSTRAINT "DanceWeekPriority_danceId_fkey" FOREIGN KEY ("danceId") REFERENCES "Dance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DanceWeekPriority" ADD CONSTRAINT "DanceWeekPriority_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
