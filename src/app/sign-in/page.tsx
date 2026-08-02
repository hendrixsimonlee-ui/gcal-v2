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
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Dance Scheduler
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
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
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Sign in with Google
          </button>
        </form>

        {showDevLogin && (
          <div className="mt-8 border-t border-dashed border-amber-400 pt-6 text-left">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Local development only
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Sign in as anyone on the roster without Google. This block
              cannot appear in a real deployment.
            </p>
            {devUsers.length === 0 ? (
              <p className="mt-3 text-xs text-zinc-500">
                No roster members yet — run{" "}
                <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
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
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        <span>{user.name ?? user.email}</span>
                        {user.isAdmin && (
                          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-white dark:bg-white dark:text-zinc-900">
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
