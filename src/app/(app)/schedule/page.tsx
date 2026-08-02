import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function MySchedulePage() {
  const session = await auth();
  const userId = session!.user.id;

  const memberships = await prisma.danceMembership.findMany({
    where: { userId },
    include: {
      dance: {
        include: {
          practices: {
            where: { endDateTime: { gte: new Date() } },
            orderBy: { startDateTime: "asc" },
            include: { space: true },
          },
        },
      },
    },
    orderBy: { dance: { name: "asc" } },
  });

  if (memberships.length === 0) {
    return (
      <EmptyState message="You're not part of any dances yet. Once the AD adds you to a dance, it'll show up here." />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        My Schedule
      </h1>
      {memberships.map(({ dance, role }) => (
        <section
          key={dance.id}
          className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="mb-3 flex items-center gap-2">
            <h2 className="font-medium text-zinc-900 dark:text-zinc-50">
              {dance.name}
            </h2>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {role === "CHOREOGRAPHER" ? "Choreographer" : "Dancer"}
            </span>
          </div>
          {dance.practices.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No practices scheduled yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {dance.practices.map((practice) => (
                <li
                  key={practice.id}
                  className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800"
                >
                  <span className="text-zinc-800 dark:text-zinc-200">
                    {dateFormatter.format(practice.startDateTime)}
                  </span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {practice.space?.name ?? "Space TBD"}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      practice.status === "CONFIRMED"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                    }`}
                  >
                    {practice.status === "CONFIRMED" ? "Confirmed" : "Proposed"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        My Schedule
      </h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{message}</p>
    </div>
  );
}
