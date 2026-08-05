"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  removeRosterMember,
  toggleAdmin,
  updateRosterMember,
} from "@/lib/actions/roster";

export interface RosterPerson {
  id: string;
  name: string | null;
  email: string;
  isAdmin: boolean;
  danceCount: number;
  hasSignedIn: boolean;
  calendarName: string | null;
}

/** One roster row, editable where it sits.
 *
 * Correcting a typo used to mean removing the person and adding them back,
 * which threw away every conflict and attendance record attached to them. */
export function RosterRow({ person }: { person: RosterPerson }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await updateRosterMember(person.id, formData);
        setEditing(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work.");
      }
    });
  }

  if (editing) {
    return (
      <tr>
        <td colSpan={6} className="px-4 py-3">
          <form action={save} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-soft">Name</span>
              <input
                name="name"
                defaultValue={person.name ?? ""}
                placeholder="How the team says it"
                className="w-44 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-soft">
                Google account email
              </span>
              <input
                name="email"
                type="email"
                required
                defaultValue={person.email}
                className="w-64 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="text-sm font-medium text-ink-soft hover:underline"
            >
              Cancel
            </button>
            {error && (
              <p className="w-full text-sm font-medium text-bad">{error}</p>
            )}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="px-4 py-2">
        <Link
          href={`/admin/roster/${person.id}`}
          className="font-medium text-ink underline decoration-line-strong decoration-1 underline-offset-2 transition-colors hover:text-accent-ink hover:decoration-accent"
        >
          {person.name || (
            <span className="italic text-ink-faint">Not signed in yet</span>
          )}
        </Link>
      </td>
      <td className="px-4 py-2 text-ink-soft">{person.email}</td>
      <td className="px-4 py-2 tabular-nums text-ink-soft">
        {person.danceCount}
      </td>
      <td className="px-4 py-2 text-xs">
        {person.calendarName ? (
          <span className="text-good">{person.calendarName}</span>
        ) : person.hasSignedIn ? (
          <span className="text-warn">Not linked</span>
        ) : (
          <span className="text-ink-faint">—</span>
        )}
      </td>
      <td className="px-4 py-2">
        <form action={toggleAdmin.bind(null, person.id, !person.isAdmin)}>
          <button
            type="submit"
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${ person.isAdmin
                ? "bg-accent text-on-accent"
                : "border border-line-strong text-ink-soft"
            }`}
          >
            {person.isAdmin ? "Admin" : "Make admin"}
          </button>
        </form>
      </td>
      <td className="px-4 py-2 text-right">
        <button
          onClick={() => setEditing(true)}
          className="mr-3 text-xs font-medium text-accent-ink hover:underline"
        >
          Edit
        </button>
        <form
          className="inline"
          action={removeRosterMember.bind(null, person.id)}
        >
          <button
            type="submit"
            className="text-xs font-medium text-ink-faint transition-colors hover:text-bad"
          >
            Remove
          </button>
        </form>
      </td>
    </tr>
  );
}
