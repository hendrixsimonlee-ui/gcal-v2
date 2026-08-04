"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireChoreographerOrAdmin, requireUser } from "@/lib/authz";

export interface PracticeNoteView {
  id: string;
  body: string;
  authorName: string;
  subjectUserId: string | null;
  subjectName: string | null;
  createdAt: Date;
  canEdit: boolean;
}

/** Who is allowed to write about whom.
 *
 * Anyone in the cast can write about the practice or about themselves — that's
 * how "I'm going to be late, class runs over" gets said. Choreographers of the
 * dance and admins can write about anybody, since it often gets mentioned to
 * them in person first. */
async function assertCanWrite(practiceId: string, subjectUserId: string | null) {
  const user = await requireUser();
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    include: { dance: { include: { memberships: true } } },
  });

  const membership = practice.dance.memberships.find((m) => m.userId === user.id);
  const isChoreographer =
    membership?.role === "CHOREOGRAPHER" || user.isAdmin === true;

  if (!membership && !user.isAdmin) {
    throw new Error("You're not part of this dance");
  }
  if (subjectUserId && subjectUserId !== user.id && !isChoreographer) {
    throw new Error("Only a choreographer or admin can write about someone else");
  }
  return { user, practice };
}

export async function addPracticeNote(
  practiceId: string,
  subjectUserId: string | null,
  body: string,
) {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Write something first");

  const { user } = await assertCanWrite(practiceId, subjectUserId);
  await prisma.practiceNote.create({
    data: { practiceId, authorId: user.id, subjectUserId, body: trimmed },
  });

  revalidatePath(`/attendance/${practiceId}`);
  revalidatePath("/schedule");
  revalidatePath("/admin/attendance");
}

export async function deletePracticeNote(noteId: string) {
  const user = await requireUser();
  const note = await prisma.practiceNote.findUniqueOrThrow({
    where: { id: noteId },
    include: { practice: { select: { danceId: true, id: true } } },
  });

  if (note.authorId !== user.id) {
    // Not your note — you need to run the dance, or the app.
    await requireChoreographerOrAdmin(note.practice.danceId);
  }

  await prisma.practiceNote.delete({ where: { id: noteId } });
  revalidatePath(`/attendance/${note.practice.id}`);
  revalidatePath("/schedule");
}

/** Notes for one practice, filtered to what this person is allowed to read.
 *
 * A note about the practice is for the whole cast. A note about a person is
 * for that person, the dance's choreographers, and admins. */
export async function getVisiblePracticeNotes(
  practiceId: string,
): Promise<PracticeNoteView[]> {
  const user = await requireUser();
  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    include: {
      dance: { include: { memberships: true } },
      notes: {
        include: {
          author: { select: { name: true, email: true } },
          subject: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const membership = practice.dance.memberships.find((m) => m.userId === user.id);
  const isChoreographer =
    membership?.role === "CHOREOGRAPHER" || user.isAdmin === true;

  return practice.notes
    .filter(
      (note) =>
        note.subjectUserId === null ||
        isChoreographer ||
        note.subjectUserId === user.id,
    )
    .map((note) => ({
      id: note.id,
      body: note.body,
      authorName: note.author.name ?? note.author.email,
      subjectUserId: note.subjectUserId,
      subjectName: note.subject
        ? (note.subject.name ?? note.subject.email)
        : null,
      createdAt: note.createdAt,
      canEdit: note.authorId === user.id || isChoreographer,
    }));
}
