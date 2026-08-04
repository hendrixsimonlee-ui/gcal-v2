import { getDancerCalendars } from "@/lib/actions/conflicts";
import { DancerCalendars } from "@/components/dancer-calendars";
import { activeRange } from "@/lib/terms";

export default async function DancerCalendarsPage() {
  const [rows, { term }] = await Promise.all([
    getDancerCalendars(),
    activeRange(),
  ]);

  return <DancerCalendars initialRows={rows} termName={term?.name ?? null} />;
}
