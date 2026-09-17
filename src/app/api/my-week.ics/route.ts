import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buildIcs } from "@/lib/calendar-links";
import { buildDescription } from "@/lib/team-calendar";
import { addDays, parseWeekParam } from "@/lib/dates";

/** Every practice the signed-in person has in one week, as a single calendar
 * file. One tap instead of a Google pop-up per dance, and it imports into
 * Apple Calendar and Outlook as well. */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Sign-in required", { status: 401 });
  }

  const weekStart = parseWeekParam(
    request.nextUrl.searchParams.get("week") ?? undefined,
  );
  const weekEnd = addDays(weekStart, 7);

  const practices = await prisma.practice.findMany({
    where: {
      status: "CONFIRMED",
      startDateTime: { gte: weekStart, lt: weekEnd },
      dance: {
        archivedAt: null,
        memberships: { some: { userId: session.user.id } },
      },
    },
    include: { dance: true, space: true },
    orderBy: { startDateTime: "asc" },
  });

  // The same roster the app and the shared calendar carry — who's excused,
  // who isn't, who's coming late. Downloading the week and then having to
  // open the app to see who'll be there defeats the point of downloading it.
  const rows = await Promise.all(
    practices.map(async (p) => ({
      uid: `${p.id}@dance-scheduler`,
      title: `${p.dance.name} practice`,
      start: p.startDateTime,
      end: p.endDateTime,
      location: p.space?.location ?? p.space?.name ?? undefined,
      description: await buildDescription(p.id),
    })),
  );

  const ics = buildIcs(rows, "PADT practices");

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="padt-week.ics"`,
    },
  });
}
