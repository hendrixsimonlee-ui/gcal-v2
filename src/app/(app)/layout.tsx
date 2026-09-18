import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/header";
import { SidebarNav, type NavItem } from "@/components/sidebar-nav";
import { PushPrompt } from "@/components/push-prompt";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Roles are additive, not modes: everyone gets the personal screens, and
  // choreographing any dance simply adds check-off alongside them.
  const nav: NavItem[] = [
    { href: "/schedule", label: "My Schedule", shortLabel: "Schedule" },
    { href: "/conflicts", label: "My Conflicts", shortLabel: "Conflicts" },
    { href: "/my-attendance", label: "My Attendance", shortLabel: "Mine" },
  ];

  let unreadCount = 0;
  if (session?.user?.id) {
    const [choreographs, unread] = await Promise.all([
      prisma.danceMembership.findFirst({
        where: { userId: session.user.id, role: "CHOREOGRAPHER" },
        select: { id: true },
      }),
      prisma.notification.count({
        where: { userId: session.user.id, read: false },
      }),
    ]);
    // The treasurer gets one extra destination and nothing else. No casting,
    // no room bookings, no conflict notes — that is the entire point of the
    // flag existing instead of just making them an admin.
    if (session.user.isFinanceAdmin && !session.user.isAdmin) {
      nav.push({ href: "/dues", label: "Late charges", shortLabel: "Charges" });
    }

    if (choreographs) {
      // "Check off" rather than "Attendance": a choreographer already has a
      // tab for their own record, and two tabs reading the same word is no
      // navigation at all.
      nav.push({
        href: "/attendance",
        label: "Check off attendance",
        shortLabel: "Check off",
      });
    }
    unreadCount = unread;
  }

  return (
    <div className="flex h-full flex-col">
      <Header
        userName={session?.user?.name}
        userImage={session?.user?.image}
        unreadCount={unreadCount}
      />
      <div className="flex flex-1 flex-col overflow-hidden sm:flex-row">
        <SidebarNav
          items={nav}
          switchLink={
            session?.user?.isAdmin
              ? { href: "/admin", label: "Admin Console →", shortLabel: "Admin" }
              : undefined
          }
        />
        {/* The max-width keeps text from running the full width of a desktop
            monitor. The extra bottom padding that used to clear the fixed
            phone tab bar went with the bar itself. */}
        <main className="flex-1 overflow-y-auto px-4 pb-8 pt-5 sm:px-6 sm:pt-6">
          <div className="mx-auto w-full max-w-5xl">
            {/* Above the page, on every screen. Notifications are the only
                way the app reaches anybody, and burying the switch on one
                page meant people installed the app and then heard nothing
                all term. It asks once per visit and hides itself the moment
                there is nothing to ask. */}
            <PushPrompt />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
