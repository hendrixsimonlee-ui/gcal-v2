import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/header";
import { SidebarNav, type NavItem } from "@/components/sidebar-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Roles are additive, not modes: everyone gets the personal screens, and
  // choreographing any dance simply adds check-off alongside them.
  const nav: NavItem[] = [
    { href: "/schedule", label: "My Schedule" },
    { href: "/conflicts", label: "My Conflicts" },
    { href: "/my-attendance", label: "My Attendance" },
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
    if (choreographs) {
      nav.push({ href: "/attendance", label: "Attendance" });
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
              ? { href: "/admin", label: "Admin Console →" }
              : undefined
          }
        />
        {/* pb-24 on phones clears the fixed tab bar; the max-width keeps
            text from running the full width of a desktop monitor. */}
        <main className="flex-1 overflow-y-auto px-4 pb-24 pt-5 sm:px-6 sm:pb-8 sm:pt-6">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
