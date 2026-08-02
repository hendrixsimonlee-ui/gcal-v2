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
    "Practice",
    "DanceMembership",
  ]) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
  }
  await prisma.dance.deleteMany();
  await prisma.spaceAvailability.deleteMany();
  await prisma.space.deleteMany();
  await prisma.conflictCategory.deleteMany();
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

  console.log("Creating conflict categories…");
  const categories: Record<string, string> = {};
  const categorySpecs: [string, boolean][] = [
    ["Class", true],
    ["Work Shift", true],
    ["Medical", true],
    ["Family", true],
    ["Other Commitment", false],
    ["Personal", false],
  ];
  for (const [name, isExcused] of categorySpecs) {
    const cat = await prisma.conflictCategory.create({
      data: { name, isExcused },
    });
    categories[name] = cat.id;
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
    data: { name: "Bhangra", season: "Fall 2026" },
  });
  const hiphop = await prisma.dance.create({
    data: { name: "Hip Hop Fusion", season: "Fall 2026" },
  });
  const contemporary = await prisma.dance.create({
    data: { name: "Contemporary", season: "Fall 2026" },
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

  console.log("Logging conflicts…");
  const conflicts: [string, number, number, number, string, string][] = [
    ["Diego Alvarez", 1, 18, 20, "Class", "Organic Chem lab"],
    ["Diego Alvarez", 3, 18, 20, "Class", "Organic Chem lab"],
    ["Tomas Novak", 2, 17, 21, "Work Shift", "Closing shift at the cafe"],
    ["Leila Haddad", 3, 19, 22, "Class", "Evening seminar"],
    ["Sofia Rossi", 6, 12, 15, "Family", "Sister's graduation"],
    ["Owen Fitzgerald", 1, 18, 23, "Personal", "Prior commitment"],
    ["Kenji Watanabe", 4, 18, 20, "Medical", "PT appointment"],
    ["Nia Williams", 2, 19, 21, "Other Commitment", "Club meeting"],
  ];
  for (const [who, offset, startHour, endHour, category, note] of conflicts) {
    const start = at(offset, startHour);
    await prisma.conflict.create({
      data: {
        userId: users[who],
        weekOf: mondayOf(start),
        startDateTime: start,
        endDateTime: at(offset, endHour),
        categoryId: categories[category],
        note,
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
  const pastSpecs: [string, number][] = [
    [bhangra.id, -21],
    [bhangra.id, -14],
    [bhangra.id, -7],
    [hiphop.id, -17],
    [hiphop.id, -10],
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

  // Owen keeps missing Hip Hop with nothing logged, so the chronic-absence
  // flag has something real to catch.
  const absentees: string[][] = [
    ["Diego Alvarez", "Owen Fitzgerald"],
    ["Tomas Novak"],
    ["Diego Alvarez"],
    ["Owen Fitzgerald", "Nia Williams", "Kenji Watanabe"],
    ["Owen Fitzgerald", "Sofia Rossi"],
    ["Nia Williams"],
  ];
  for (const [index, practice] of past.entries()) {
    const members = await prisma.danceMembership.findMany({
      where: { danceId: practice.danceId },
    });
    const away = new Set((absentees[index] ?? []).map((n) => users[n]));
    for (const member of members) {
      await prisma.attendance.create({
        data: {
          practiceId: practice.id,
          userId: member.userId,
          attended: !away.has(member.userId),
          markedById: users["Priya Raman"],
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
