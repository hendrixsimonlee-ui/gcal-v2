/**
 * Fills an empty database with a believable dance-team season so the app is
 * worth looking at on first run: a roster, three dances with overlapping
 * casts, two spaces, logged conflicts, past practices with attendance, and
 * a draft practice waiting to be confirmed.
 *
 * Run with: npm run seed:demo
 *
 * Destructive — it clears existing rows first, so only point it at a
 * development database.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function at(dayOffset: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** A date-only value the way Prisma stores `@db.Date`: UTC midnight. */
function onDay(dayOffset: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return new Date(
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T00:00:00Z`,
  );
}

function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

async function main() {
  console.log("Clearing existing data…");
  for (const table of [
    "Notification",
    "Attendance",
    "Session",
    "Account",
    "Conflict",
    "Unavailability",
    "ChoreographerWeeklyExcuse",
    "PracticeNote",
    "PlannedArrival",
    "PushSubscription",
    "DanceWeekOff",
    "Practice",
    "DanceMembership",
  ]) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
  }
  await prisma.dance.deleteMany();
  await prisma.spaceAvailability.deleteMany();
  await prisma.space.deleteMany();
  await prisma.user.deleteMany();
  await prisma.appSettings.deleteMany();

  console.log("Creating roster…");
  const roster: [string, string, boolean][] = [
    ["Priya Raman", "priya@example.edu", true],
    ["Marcus Chen", "marcus@example.edu", false],
    ["Aisha Okonkwo", "aisha@example.edu", false],
    ["Diego Alvarez", "diego@example.edu", false],
    ["Hannah Kim", "hannah@example.edu", false],
    ["Tomas Novak", "tomas@example.edu", false],
    ["Leila Haddad", "leila@example.edu", false],
    ["Jordan Blake", "jordan@example.edu", false],
    ["Sofia Rossi", "sofia@example.edu", false],
    ["Kenji Watanabe", "kenji@example.edu", false],
    ["Nia Williams", "nia@example.edu", false],
    ["Owen Fitzgerald", "owen@example.edu", false],
  ];
  const users: Record<string, string> = {};
  for (const [name, email, isAdmin] of roster) {
    const user = await prisma.user.create({ data: { name, email, isAdmin } });
    users[name] = user.id;
  }

  console.log("Creating spaces…");
  const studioA = await prisma.space.create({
    data: { name: "Studio A", location: "Recreation Center, 2nd floor" },
  });
  const blackBox = await prisma.space.create({
    data: { name: "Black Box Theater", location: "Arts Building" },
  });
  for (const dayOfWeek of [1, 2, 3, 4]) {
    await prisma.spaceAvailability.create({
      data: { spaceId: studioA.id, dayOfWeek, startTime: "18:00", endTime: "22:00" },
    });
  }
  for (const dayOfWeek of [0, 6]) {
    await prisma.spaceAvailability.create({
      data: { spaceId: blackBox.id, dayOfWeek, startTime: "12:00", endTime: "18:00" },
    });
  }

  console.log("Creating dances and casts…");
  const bhangra = await prisma.dance.create({
    data: { name: "Bhangra", season: "Fall 2026", defaultDurationMinutes: 120 },
  });
  const hiphop = await prisma.dance.create({
    data: { name: "Hip Hop Fusion", season: "Fall 2026", defaultDurationMinutes: 90 },
  });
  const contemporary = await prisma.dance.create({
    data: { name: "Contemporary", season: "Fall 2026", defaultDurationMinutes: 60 },
  });

  // Overlapping casts on purpose — that's what makes cross-dance clashes
  // and the "any space" search interesting to look at.
  const casts: [string, string[], string[]][] = [
    [
      bhangra.id,
      ["Priya Raman", "Marcus Chen"],
      ["Aisha Okonkwo", "Diego Alvarez", "Hannah Kim", "Tomas Novak", "Leila Haddad", "Jordan Blake"],
    ],
    [
      hiphop.id,
      ["Aisha Okonkwo"],
      ["Marcus Chen", "Sofia Rossi", "Kenji Watanabe", "Nia Williams", "Owen Fitzgerald", "Jordan Blake"],
    ],
    [
      contemporary.id,
      ["Hannah Kim"],
      ["Priya Raman", "Leila Haddad", "Sofia Rossi", "Nia Williams", "Diego Alvarez"],
    ],
  ];
  for (const [danceId, choreographers, dancers] of casts) {
    for (const name of choreographers) {
      await prisma.danceMembership.create({
        data: { danceId, userId: users[name], role: "CHOREOGRAPHER" },
      });
    }
    for (const name of dancers) {
      await prisma.danceMembership.create({
        data: { danceId, userId: users[name], role: "DANCER" },
      });
    }
  }

  // A finished piece, kept for its records but out of everyone's way — this
  // is what the Dances page's "Archived" section is for.
  const springTap = await prisma.dance.create({
    data: {
      name: "Spring Tap Suite",
      season: "Spring 2026",
      defaultDurationMinutes: 75,
      archivedAt: at(-30, 12),
    },
  });
  for (const name of ["Marcus Chen", "Sofia Rossi", "Hannah Kim"]) {
    await prisma.danceMembership.create({
      data: {
        danceId: springTap.id,
        userId: users[name],
        role: name === "Marcus Chen" ? "CHOREOGRAPHER" : "DANCER",
      },
    });
  }
  for (const offset of [-70, -63]) {
    await prisma.practice.create({
      data: {
        danceId: springTap.id,
        spaceId: studioA.id,
        startDateTime: at(offset, 19),
        endDateTime: at(offset, 20),
        status: "CONFIRMED",
      },
    });
  }

  // One-off space changes: the gym closes for an event, and opens late once.
  await prisma.spaceAvailability.create({
    data: { spaceId: studioA.id, date: onDay(9), isAvailable: false },
  });
  await prisma.spaceAvailability.create({
    data: {
      spaceId: blackBox.id,
      date: onDay(6),
      isAvailable: true,
      startTime: "15:00",
      endTime: "20:00",
    },
  });

  console.log("Logging conflicts…");
  // Titles, not categories — that's all a dancer supplies now. Some are
  // left NOT_REVIEWED on purpose so Conflict Review opens with work to do.
  type ConflictStatus = "NOT_REVIEWED" | "EXCUSED" | "UNEXCUSED";
  const conflicts: [string, number, number, number, string, ConflictStatus][] = [
    ["Diego Alvarez", 1, 18, 20, "Organic Chem lab", "EXCUSED"],
    ["Diego Alvarez", 3, 18, 20, "Organic Chem lab", "EXCUSED"],
    ["Tomas Novak", 2, 17, 21, "Closing shift at the cafe", "EXCUSED"],
    // Ends 15 minutes into a 7pm practice — the app should offer to turn
    // this into a planned late arrival rather than an absence.
    ["Leila Haddad", 3, 17, 19, "Evening seminar", "EXCUSED"],
    // Ends part-way into Sunday's Contemporary draft, so the builder can
    // offer to turn it into a late arrival rather than an absence.
    ["Sofia Rossi", 6, 12, 14, "Sister's graduation", "NOT_REVIEWED"],
    ["Owen Fitzgerald", 1, 18, 23, "Prior commitment", "UNEXCUSED"],
    ["Kenji Watanabe", 4, 18, 20, "PT appointment", "NOT_REVIEWED"],
    ["Nia Williams", 2, 19, 21, "Club meeting", "NOT_REVIEWED"],
  ];
  for (const [who, offset, startHour, endHour, title, status] of conflicts) {
    const start = at(offset, startHour);
    await prisma.conflict.create({
      data: {
        userId: users[who],
        weekOf: mondayOf(start),
        startDateTime: start,
        endDateTime: at(offset, endHour),
        title,
        status,
        ...(status === "NOT_REVIEWED"
          ? {}
          : { reviewedById: users["Priya Raman"], reviewedAt: new Date() }),
      },
    });
  }

  await prisma.unavailability.create({
    data: {
      userId: users["Jordan Blake"],
      startDate: at(5, 0),
      endDate: at(12, 0),
      reason: "Studying abroad interview trip",
    },
  });

  console.log("Creating practices and attendance history…");
  // Three months back, so the lateness-by-month view has real months in it
  // and the semester totals mean something.
  const pastSpecs: [string, number][] = [
    [bhangra.id, -84],
    [bhangra.id, -70],
    [bhangra.id, -56],
    [bhangra.id, -42],
    [bhangra.id, -21],
    [bhangra.id, -14],
    [bhangra.id, -7],
    [hiphop.id, -80],
    [hiphop.id, -66],
    [hiphop.id, -52],
    [hiphop.id, -38],
    [hiphop.id, -24],
    [hiphop.id, -17],
    [hiphop.id, -10],
    [contemporary.id, -75],
    [contemporary.id, -47],
    [contemporary.id, -9],
  ];
  const past: { id: string; danceId: string }[] = [];
  for (const [danceId, offset] of pastSpecs) {
    const practice = await prisma.practice.create({
      data: {
        danceId,
        spaceId: studioA.id,
        startDateTime: at(offset, 19),
        endDateTime: at(offset, 21),
        status: "CONFIRMED",
      },
    });
    past.push({ id: practice.id, danceId });
  }

  // Two deliberate patterns so both flag dashboards have something to catch:
  // Owen misses Hip Hop three times running (trips the per-dance flag), while
  // Nia misses one practice of several different pieces — invisible to any
  // single choreographer, but it adds up (trips the overall flag).
  const absentees: string[][] = [
    [], // Bhangra, oldest
    ["Tomas Novak"],
    [],
    ["Diego Alvarez"],
    ["Diego Alvarez"],
    ["Tomas Novak"],
    ["Diego Alvarez"],
    [], // Hip Hop, oldest
    ["Kenji Watanabe"],
    [],
    ["Nia Williams"],
    ["Owen Fitzgerald", "Nia Williams"],
    ["Owen Fitzgerald", "Nia Williams", "Kenji Watanabe"],
    ["Owen Fitzgerald", "Sofia Rossi"],
    [], // Contemporary, oldest
    [],
    ["Nia Williams"],
  ];
  // Owen ends on 3 unexcused in Hip Hop alone -> per-dance flag.
  // Nia ends on 2 in Hip Hop and 1 in Contemporary: under the per-dance
  // threshold everywhere, but 3 overall -> only the overall flag catches her.
  for (const [index, practice] of past.entries()) {
    const members = await prisma.danceMembership.findMany({
      where: { danceId: practice.danceId },
    });
    const away = new Set((absentees[index] ?? []).map((n) => users[n]));
    // Marcus is chronically a few minutes late across both his dances;
    // Leila and Kenji drift occasionally. Enough for the lateness view to
    // show a real pattern rather than a single outlier.
    const habituallyLate: Record<number, string[]> = {
      0: ["Marcus Chen"],
      1: ["Marcus Chen", "Leila Haddad"],
      3: ["Marcus Chen"],
      4: ["Leila Haddad"],
      5: ["Marcus Chen"],
      6: ["Marcus Chen", "Leila Haddad"],
      7: ["Marcus Chen"],
      9: ["Marcus Chen", "Kenji Watanabe"],
      10: ["Marcus Chen"],
      12: ["Kenji Watanabe"],
      13: ["Marcus Chen"],
      14: ["Sofia Rossi"],
      16: ["Leila Haddad", "Sofia Rossi"],
    };
    const stragglers = new Set(
      (habituallyLate[index] ?? []).map((name) => users[name]),
    );
    // Varying minutes so the monthly sums aren't all the same number.
    const minutesFor = (i: number) => 6 + ((i * 7) % 19);
    for (const member of members) {
      const absent = away.has(member.userId);
      const late = !absent && stragglers.has(member.userId);
      const practiceStart = at(pastSpecs[index][1], 19);
      await prisma.attendance.create({
        data: {
          practiceId: practice.id,
          userId: member.userId,
          status: absent ? "UNEXCUSED_ABSENT" : late ? "LATE" : "PRESENT",
          checkedInAt: absent
            ? null
            : new Date(
                practiceStart.getTime() +
                  (late ? minutesFor(index) : 1) * 60000,
              ),
          minutesLate: absent ? null : late ? minutesFor(index) : 0,
          markedById: users["Priya Raman"],
        },
      });
    }
    // Each dance's most recent practice is left unsigned, so every
    // choreographer opens the app with exactly one thing waiting on them.
    const isLatestForDance =
      past.findLastIndex((p) => p.danceId === practice.danceId) === index;
    if (!isLatestForDance) {
      await prisma.practice.update({
        where: { id: practice.id },
        data: {
          attendanceSubmittedAt: new Date(),
          attendanceSubmittedById: users["Priya Raman"],
        },
      });
    }
  }

  // Upcoming: two confirmed, one draft left for you to confirm so you can
  // watch the notification flow fire.
  await prisma.practice.create({
    data: { danceId: bhangra.id, spaceId: studioA.id, startDateTime: at(2, 19), endDateTime: at(2, 21), status: "CONFIRMED" },
  });
  await prisma.practice.create({
    data: { danceId: hiphop.id, spaceId: studioA.id, startDateTime: at(3, 18), endDateTime: at(3, 20), status: "CONFIRMED" },
  });
  await prisma.practice.create({
    data: { danceId: contemporary.id, spaceId: blackBox.id, startDateTime: at(6, 13), endDateTime: at(6, 15), status: "PROPOSED" },
  });

  await prisma.appSettings.create({ data: { id: "singleton" } });

  console.log(`
Done. Start the app with \`npm run dev\` and open http://localhost:3000.

With ALLOW_DEV_LOGIN=true in .env you can sign in as anyone on the roster
straight from the sign-in page. Priya Raman is the AD; Aisha Okonkwo
choreographs Hip Hop Fusion; Diego Alvarez is a dancer with conflicts logged.
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
