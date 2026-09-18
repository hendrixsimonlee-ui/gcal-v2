import { DuesLedger } from "@/components/dues/dues-ledger";

/** The dues ledger, inside the admin console.
 *
 * The AD's door to the same screen the treasurer opens at /dues. Two routes
 * rather than one so each lands in the right shell: an AD who clicks Late
 * charges in the admin nav should keep the admin nav, not be dropped into the
 * dancer app.
 *
 * No permission check of its own is needed here — the admin layout already
 * redirects every non-admin before this renders, and that is precisely the
 * guarantee that made a second route worth having. */
export default async function AttendanceChargesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; month?: string; term?: string }>;
}) {
  return (
    <DuesLedger
      basePath="/admin/attendance-charges"
      params={await searchParams}
    />
  );
}
