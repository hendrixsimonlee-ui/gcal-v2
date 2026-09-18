import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DuesLedger } from "@/components/dues/dues-ledger";

/** The dues ledger, inside the dancer app.
 *
 * This is the treasurer's door. They are an ordinary member of the troupe who
 * happens to chase Venmo requests, so they stay in their own shell with their
 * own navigation and get exactly one extra destination.
 *
 * The AD has their own route into the same screen at
 * /admin/attendance-charges, which keeps them inside the admin console rather
 * than dropping them into the dancer app halfway through a job. Same
 * component, two doors — because the alternative was letting a non-admin past
 * the admin layout, and that check is worth more than the duplication. */
export default async function DuesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; month?: string; term?: string }>;
}) {
  const session = await auth();
  const user = session?.user;
  if (!user?.isAdmin && !user?.isFinanceAdmin) redirect("/schedule");

  return <DuesLedger basePath="/dues" params={await searchParams} />;
}
