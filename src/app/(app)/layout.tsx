import { auth } from "@/auth";
import { Header } from "@/components/header";
import { SidebarNav, type NavItem } from "@/components/sidebar-nav";

const PERSONAL_NAV: NavItem[] = [
  { href: "/schedule", label: "My Schedule" },
  { href: "/conflicts", label: "My Conflicts" },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <div className="flex h-full flex-col">
      <Header
        userName={session?.user?.name}
        userImage={session?.user?.image}
      />
      <div className="flex flex-1 flex-col overflow-hidden sm:flex-row">
        <SidebarNav
          items={PERSONAL_NAV}
          switchLink={
            session?.user?.isAdmin
              ? { href: "/admin", label: "Admin Console →" }
              : undefined
          }
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
