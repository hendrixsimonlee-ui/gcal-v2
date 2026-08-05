import Image from "next/image";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { devLoginEnabled } from "@/lib/dev-login";

export default async function SignInPage() {
  const showDevLogin = devLoginEnabled();
  const devUsers = showDevLogin
    ? await prisma.user.findMany({
        orderBy: [{ isAdmin: "desc" }, { name: "asc" }],
        take: 12,
        select: { email: true, name: true, isAdmin: true },
      })
    : [];

  return (
    <div className="flex flex-1 items-center justify-center bg-surface-2 px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
        <Image
          src="/icon.png"
          alt=""
          aria-hidden="true"
          width={88}
          height={88}
          className="mx-auto mb-4 rounded-2xl"
          priority
        />
        <h1 className="text-xl font-semibold text-ink">
          PADT Calendar
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Sign in with your Google account to view your schedule, log
          conflicts, and (if you connect it) import events from Google
          Calendar.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
          >
            Sign in with Google
          </button>
        </form>

        {showDevLogin && (
          <div className="mt-8 border-t border-dashed border-warn/50 pt-6 text-left">
            <p className="text-xs font-semibold uppercase tracking-wide text-warn">
              Local development only
            </p>
            <p className="mt-1 text-xs text-ink-soft">
              Sign in as anyone on the roster without Google. This block
              cannot appear in a real deployment.
            </p>
            {devUsers.length === 0 ? (
              <p className="mt-3 text-xs text-ink-soft">
                No roster members yet — run{" "}
                <code className="rounded bg-surface-3 px-1 bg-surface-3">
                  npm run seed:demo
                </code>
                .
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-1">
                {devUsers.map((user) => (
                  <li key={user.email}>
                    <form action="/api/dev-login" method="post">
                      <input type="hidden" name="email" value={user.email} />
                      <button
                        type="submit"
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm text-ink-soft transition-colors hover:bg-surface-3"
                      >
                        <span>{user.name ?? user.email}</span>
                        {user.isAdmin && (
                          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-white">
                            AD
                          </span>
                        )}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
