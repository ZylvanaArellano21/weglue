import Link from "next/link";
import { listRsvps, type ListRsvpsParams } from "../../../lib/admin/contentData";
import { listUniversities } from "../../../lib/admin/data";
import { listClubOptions } from "../../../lib/admin/data2";
import { SectionCard, Badge, IdentityCell, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td } from "../../../components/admin/Table";
import { RsvpRowActions } from "../../../components/admin/RsvpActions";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtEventDate(d: string): string {
  if (!d) return "—";
  const [y = 1970, m = 1, day = 1] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function AdminRsvpsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);
  const eventScope = get("event");

  const params: ListRsvpsParams = {
    search: get("q"),
    status: (get("status") as ListRsvpsParams["status"]) ?? "all",
    clubId: get("club"),
    universityId: get("university"),
    eventId: eventScope,
    dateFrom: get("dateFrom"),
    dateTo: get("dateTo") ? `${get("dateTo")}T23:59:59.999Z` : undefined,
    dir: (get("dir") as "asc" | "desc") ?? "desc",
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const [result, universities, clubs] = await Promise.all([
    listRsvps(params),
    listUniversities(),
    listClubOptions(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">RSVPs</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {result.total.toLocaleString()} RSVP{result.total === 1 ? "" : "s"} across every event.
        </p>
      </div>

      {eventScope ? (
        <div className="flex items-center justify-between rounded-lg border border-teal-100 bg-teal-50/60 px-4 py-2 text-sm text-teal-800">
          <span>Showing RSVPs for one event.</span>
          <Link href={`/admin/events/${eventScope}`} className="font-medium hover:underline">
            View the event →
          </Link>
        </div>
      ) : null}

      <ListControls
        searchPlaceholder="Search by attendee name/username/email or event title…"
        dateFilter
        filters={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "going", label: "Going" },
              { value: "cant", label: "Can't go" },
            ],
          },
          { key: "university", label: "University", options: universities.map((u) => ({ value: u.id, label: u.name })) },
          { key: "club", label: "Club", options: clubs.map((c) => ({ value: c.id, label: c.name })) },
        ]}
        sorts={[{ value: "created_at", label: "RSVP date" }]}
      />

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState icon="✅" title="No RSVPs found" message="Try a different attendee, event, or clear the filters." />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>Attendee</Th>
                  <Th>Event</Th>
                  <Th>Club</Th>
                  <Th>University</Th>
                  <Th>Status</Th>
                  <Th>Event date</Th>
                  <Th>RSVP&apos;d</Th>
                  <Th className="text-right">Actions</Th>
                </>
              }
            >
              {result.rows.map((r) => (
                <tr key={r.id} className="text-gray-700">
                  <Td>
                    <Link href={`/admin/users/${r.user_id}`} className="hover:opacity-80">
                      <IdentityCell
                        name={r.attendee_name || r.attendee_username}
                        sub={`@${r.attendee_username}${r.attendee_email ? ` · ${r.attendee_email}` : ""}`}
                        avatarUrl={r.avatar_url}
                      />
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/admin/events/${r.event_id}`} className="text-teal-700 hover:underline">
                      <span className="max-w-[180px] truncate">{r.event_title || "View event"}</span>
                    </Link>
                  </Td>
                  <Td className="text-gray-600">
                    {r.club_id && r.club_name ? (
                      <Link href={`/admin/clubs/${r.club_id}`} className="hover:underline">
                        {r.club_name}
                      </Link>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </Td>
                  <Td className="text-gray-600">{r.university ?? <span className="text-gray-300">—</span>}</Td>
                  <Td>
                    {r.status === "going" ? <Badge tone="green">Going</Badge> : <Badge tone="gray">Can&apos;t</Badge>}
                  </Td>
                  <Td className="whitespace-nowrap text-gray-600">{fmtEventDate(r.event_date)}</Td>
                  <Td className="whitespace-nowrap text-gray-600">{fmtDate(r.created_at)}</Td>
                  <Td>
                    <RsvpRowActions eventId={r.event_id} userId={r.user_id} status={r.status} />
                  </Td>
                </tr>
              ))}
            </Table>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} />
          </>
        )}
      </SectionCard>
    </div>
  );
}
