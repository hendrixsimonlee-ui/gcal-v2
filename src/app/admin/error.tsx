"use client";

import { useEffect } from "react";

/** Catches anything that blows up rendering an admin screen.
 *
 * Without this, a server-render failure shows Next's stock line about the
 * message being "omitted in production builds to avoid leaking sensitive
 * details" and a digest, which tells the AD nothing and gives them nothing to
 * press. The digest is the key to the real error in the Vercel log, so this
 * puts it on screen where it can be copied, and offers the retry that most of
 * these need — a lot of them are a Google token that needed refreshing. */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Goes to the Vercel function log with the digest attached, so the two can
    // be lined up.
    console.error("Admin screen failed to render", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-bad/35 bg-bad-soft p-5">
      <h1 className="text-lg font-semibold text-bad">
        This screen couldn&rsquo;t load
      </h1>
      <p className="mt-2 text-sm text-bad">
        Something failed while building the page. Your data is fine — nothing
        was written.
      </p>

      {error.digest && (
        <p className="mt-3 text-xs text-bad">
          Reference code:{" "}
          <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-ink">
            {error.digest}
          </code>
          <span className="mt-1 block">
            In Vercel, open Logs and search that code to see what actually went
            wrong.
          </span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
        >
          Try again
        </button>
        <a
          href="/admin"
          className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-surface-2"
        >
          Back to this week
        </a>
      </div>
    </div>
  );
}
