import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/header";
import { SidebarNav, type NavItem } from "@/components/sidebar-nav";

const ADMIN_NAV: NavItem[] = [
  { href: "/admin/roster", label: "Roster" },
  { href: "/admin/spaces", label: "Spaces" },
  { href: "/admin/dances", label: "Dances" },
  { href: "/admin/categories", label: "Conflict Categories" },
  { href: "/admin/conflicts", label: "Conflict Review" },
  { href: "/admin/schedule-builder", label: "Schedule Builder" },
  { href: "/admin/attendance", label: "Attendance Review" },
  { href: "/admin/settings", label: "Settings" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.isAdmin) {
    redirect("/schedule");
  }

  const unreadCount = await prisma.notification.count({
    where: { userId: session.user.id, read: false },
  });

  return (
    <div className="flex h-full flex-col">
      <Header
        userName={session.user.name}
        userImage={session.user.image}
        unreadCount={unreadCount}
      />
      <div className="flex flex-1 flex-col overflow-hidden sm:flex-row">
        <SidebarNav
          items={ADMIN_NAV}
          switchLink={{ href: "/schedule", label: "← My Schedule" }}
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
