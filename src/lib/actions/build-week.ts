"use server";

/** "Build the week" — solve every unscheduled dance at once.
 *
 * Wraps the pure solver in src/lib/optimizer.ts with the database work:
 * gather each dance's candidate slots, gather how often each person has
 * missed each dance, solve, and write the answer out as drafts the AD can
 * then move or delete.
 *
 * Nothing is confirmed. The result is a proposal — the AD still publishes. */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { ANY_SPACE } from "@/lib/constants";
import { addDays, startOfWeek } from "@/lib/dates";
import {
  buildHistory,
  solveWeek,
  type DanceToPlace,
  type Placement,
  type Unplaced,
} from "@/lib/optimizer";
import { getCandidateSlots } from "@/lib/actions/schedule";
import { getAttendanceSettings } from "@/lib/actions/attendance";

export type BuildWeekProposal = {
  placements: {
    danceId: string;
    danceName: string;
    spaceId: string;
    spaceName: string;
    startIso: string;
    endIso: string;
    expectedCount: number;
    castSize: number;
    missingNames: string[];
  }[];
  unplaced: Unplaced[];
  totalExpectedAttendance: number;
};

/** How often each person has missed each dance, over the practices that have
 * actually been recorded. This is what stops the same person being the one
 * left out week after week. */
async function missRates(danceIds: string[]) {
  const rows = await prisma.attendance.findMany({
    where: {
      practice: { danceId: { in: danceIds }, status: "CONFIRMED" },
    },
    select: {
      userId: true,
      status: true,
      practice: { select: { danceId: true } },
    },
  });

  const tally = new Map<string, { missed: number; total: number }>();
  for (const row of rows) {
    const key = `${row.userId}:${row.practice.danceId}`;
    const entry = tally.get(key) ?? { missed: 0, total: 0 };
    entry.total++;
    // Only a genuine absence counts. Being excused is not a deficit to make
    // up — the point is who keeps ending up unable to come.
    if (row.status === "UNEXCUSED_ABSENT" || row.status === "EXCUSED_ABSENT") {
      entry.missed++;
    }
    tally.set(key, entry);
  }

  return Array.from(tally.entries()).map(([key, v]) => {
    const [userId, danceId] = key.split(":");
    return { userId, danceId, missed: v.missed, total: v.total };
  });
}

/** Proposes a slot for every dance that isn't already scheduled in the given
 * week. Read-only — call `applyWeekProposal` to write the drafts. */
export async function proposeWeek(
  weekOfIso: string,
  danceIds?: string[],
): Promise<BuildWeekProposal> {
  await requireAdmin();

  const weekStart = startOfWeek(new Date(weekOfIso));
  const weekEnd = addDays(weekStart, 7);

  const dances = await prisma.dance.findMany({
    where: {
      archivedAt: null,
      ...(danceIds ? { id: { in: danceIds } } : {}),
      // A dance already placed this week is left alone.
      practices: {
        none: { startDateTime: { gte: weekStart, lt: weekEnd } },
      },
      // Nor is one the AD has marked off this week.
      weeksOff: { none: { weekOf: weekStart } },
    },
    include: {
      memberships: { include: { user: true } },
    },
    orderBy: { name: "asc" },
  });

  if (dances.length === 0) {
    return { placements: [], unplaced: [], totalExpectedAttendance: 0 };
  }

  const settings = await getAttendanceSettings();

  // Candidates come from the existing per-dance engine, so the solver
  // inherits every hard constraint it already enforces.
  const toPlace: DanceToPlace[] = [];
  for (const dance of dances) {
    // Ask for slots inside this week, rather than taking the general
    // suggestions and filtering.
    //
    // This is what stopped the button working. getCandidateSlots searches
    // forward from now and returns the best eight it finds anywhere in the
    // next few weeks; filtering those down to one week usually left nothing,
    // because the best eight overall are rarely all in the same week. Every
    // dance then came back unplaced and the week looked unschedulable — while
    // placing the same dances by hand worked, since by hand the AD could see
    // all four weeks at once.
    const candidates = await getCandidateSlots(
      dance.id,
      ANY_SPACE,
      dance.defaultDurationMinutes ?? 90,
      [],
      { startIso: weekStart.toISOString(), endIso: weekEnd.toISOString() },
    );
    toPlace.push({
      danceId: dance.id,
      danceName: dance.name,
      cast: dance.memberships.map((m) => ({
        userId: m.userId,
        role: m.role,
      })),
      candidates,
    });
  }

  const nameById = new Map(
    dances.flatMap((d) =>
      d.memberships.map(
        (m) => [m.userId, m.user.name ?? m.user.email] as const,
      ),
    ),
  );

  const result = solveWeek({
    dances: toPlace,
    history: settings.useHistoricalWeighting
      ? buildHistory(await missRates(dances.map((d) => d.id)))
      : undefined,
  });

  return {
    placements: result.placements.map((p: Placement) => ({
      danceId: p.danceId,
      danceName: p.danceName,
      spaceId: p.slot.spaceId,
      spaceName: p.slot.spaceName,
      startIso: p.slot.startDateTime.toISOString(),
      endIso: p.slot.endDateTime.toISOString(),
      expectedCount: p.expectedCount,
      castSize: p.castSize,
      missingNames: p.missingUserIds.map((id) => nameById.get(id) ?? id),
    })),
    unplaced: result.unplaced,
    totalExpectedAttendance: result.totalExpectedAttendance,
  };
}

/** Writes an accepted proposal out as draft practices.
 *
 * Drafts, not confirmed: the AD looks the week over and publishes when
 * they're happy, which is the same step that notifies everyone and writes
 * the team calendar. */
export async function applyWeekProposal(
  proposal: BuildWeekProposal,
): Promise<{ created: number }> {
  await requireAdmin();

  let created = 0;
  for (const placement of proposal.placements) {
    const start = new Date(placement.startIso);
    const end = new Date(placement.endIso);

    // Re-check the room is still free — the proposal may be minutes old and
    // the AD may have placed something by hand in the meantime.
    const clash = await prisma.practice.findFirst({
      where: {
        spaceId: placement.spaceId,
        startDateTime: { lt: end },
        endDateTime: { gt: start },
      },
      select: { id: true },
    });
    if (clash) continue;

    await prisma.practice.create({
      data: {
        danceId: placement.danceId,
        spaceId: placement.spaceId,
        startDateTime: start,
        endDateTime: end,
        status: "PROPOSED",
      },
    });
    created++;
  }

  revalidatePath("/admin/schedule-builder");
  return { created };
}
