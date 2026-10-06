-- A name against "Did it start late?".
--
-- Pushing a practice's start to 6:10 re-prices everybody who checked in, so
-- it is the one control on the attendance sheet that moves money. It stays
-- where it is and keeps working the way it does — a rehearsal that began late
-- is the case it exists for, and making somebody ask permission to write
-- down when their own rehearsal started is the paperwork that just came back
-- out of this app. What was missing is any trace of it: the practice stored
-- the new time and nothing about who put it there, and it showed on no
-- screen but that one practice's sheet.
--
-- Two nullable columns, nothing backfilled. An existing late start simply has
-- no name against it, which is honest — nobody recorded one at the time.

ALTER TABLE "Practice" ADD COLUMN     "actualStartSetAt" TIMESTAMP(3),
ADD COLUMN     "actualStartSetById" TEXT;

ALTER TABLE "Practice" ADD CONSTRAINT "Practice_actualStartSetById_fkey" FOREIGN KEY ("actualStartSetById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
