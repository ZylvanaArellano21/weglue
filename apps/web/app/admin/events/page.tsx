import Link from "next/link";
import { listEvents, type ListEventsParams } from "../../../lib/admin/contentData";
import { listUniversities } from "../../../lib/admin/data";
import { listClubOptions } from "../../../lib/admin/data2";
import { SectionCard, Badge, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td, RowLink } from "../../../components/admin/Table";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtDate(d: string): string {
  // event_date is a plain YYYY-MM-DD; render without timezone shifting.
  const [y = 1970, m = 1, day = 1] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function hm(t: string): string {
  return t ? t.slice(0, 5) : "";
}

const VIS_TONE: Record<string, "green" | "amber" | "blue"> = {
  everyone: "green",
  members: "amber",
  specific: "blue",
};

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);

  const params: ListEventsParams = {
    search: get("q"),
    universityId: get("university"),
    clubId: get("club"),
    when: (get("when") as ListEventsParams["when"]) ?? "all",
    visibility: (get("visibility") as ListEventsParams["visibility"]) ?? "all",
    reports: (get("reports") as ListEventsParams["reports"]) ?? "all",
    dateFrom: get("dateFrom"),
    dateTo: get("dateTo"),
    sort: (get("sort") as ListEventsParams["sort"]) ?? "event_date",
    dir: (get("dir") as "asc" | "desc") ?? "desc",
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const [result, universities, clubs] = await Promise.all([
    listEvents(params),
    listUniversities(),
    listClubOptions(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Events</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {result.total.toLocaleString()} event{result.total === 1 ? "" : "s"} across every club.
        </p>
      </div>

      <ListControls
        searchPlaceholder="Search title, creator name/username/email, or club…"
        dateFilter
        filters={[
          { key: "university", label: "University", options: universities.map((u) => ({ value: u.id, label: u.name })) },
          { key: "club", label: "Club", options: clubs.map((c) => ({ value: c.id, label: c.name })) },
          {
            key: "when",
            label: "When",
            options: [
              { value: "upcoming", label: "Upcoming" },
              { value: "past", label: "Past" },
            ],
          },
          {
            key: "visibility",
            label: "Visibility",
            options: [
              { value: "everyone", label: "Everyone" },
              { value: "members", label: "Members only" },
              { value: "specific", label: "Specific" },
            ],
          },
          { key: "reports", label: "Reports", options: [{ value: "reported", label: "Reported only" }] },
        ]}
        sorts={[
          { value: "event_date", label: "Event date" },
          { value: "created_at", label: "Created date" },
        ]}
      />

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState icon="📅" title="No events found" message="Try a different title, creator, club, or clear the filters." />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>Event</Th>
                  <Th>Club</Th>
                  <Th>Creator</Th>
                  <Th>University</Th>
                  <Th>When</Th>
                  <Th>Location</Th>
                  <Th>Visibility</Th>
                  <Th className="text-right">RSVPs</Th>
                  <Th className="text-right">Reports</Th>
                </>
              }
            >
              {result.rows.map((e) => (
                <RowLink key={e.id} href={`/admin/events/${e.id}`}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="text-base">{e.emoji || "📅"}</span>
                      <div className="min-w-0 max-w-[220px]">
                        <p className="truncate text-sm font-medium text-gray-900">{e.title}</p>
                        <p className="text-xs text-gray-400">{e.is_past ? "Past" : "Upcoming"}</p>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-gray-600">{e.club_name ?? <span className="text-gray-300">—</span>}</Td>
                  <Td className="text-gray-600">{e.creator_name || `@${e.creator_username}`}</Td>
                  <Td className="text-gray-600">{e.university ?? <span className="text-gray-300">—</span>}</Td>
                  <Td className="whitespace-nowrap text-gray-600">
                    {fmtDate(e.event_date)}
                    <span className="block text-xs text-gray-400">
                      {hm(e.start_time)}–{hm(e.end_time)}
                    </span>
                  </Td>
                  <Td className="text-gray-600">
                    {e.location || e.building || e.room ? (
                      <span className="max-w-[160px] truncate">
                        {[e.location, e.building, e.room].filter(Boolean).join(" · ")}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={VIS_TONE[e.visibility] ?? "gray"}>{e.visibility}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{e.rsvp_count}</Td>
                  <Td className="text-right tabular-nums">
                    {e.report_count > 0 ? <Badge tone="red">{e.report_count}</Badge> : <span className="text-gray-400">0</span>}
                  </Td>
                </RowLink>
              ))}
            </Table>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} />
          </>
        )}
      </SectionCard>
    </div>
  );
}
