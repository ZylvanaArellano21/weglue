import { listClubs, listUniversities, type ListClubsParams } from "../../../lib/admin/data";
import { SectionCard, Badge, IdentityCell, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td, RowLink } from "../../../components/admin/Table";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminClubsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);

  const params: ListClubsParams = {
    search: get("q"),
    universityId: get("university"),
    status: (get("status") as ListClubsParams["status"]) ?? "all",
    sort: (get("sort") as ListClubsParams["sort"]) ?? "created_at",
    dir: (get("dir") as "asc" | "desc") ?? "desc",
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const [result, universities] = await Promise.all([listClubs(params), listUniversities()]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Clubs</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {result.total.toLocaleString()} club{result.total === 1 ? "" : "s"} across every university.
        </p>
      </div>

      <ListControls
        searchPlaceholder="Search by club name or handle…"
        filters={[
          {
            key: "university",
            label: "University",
            options: universities.map((u) => ({ value: u.id, label: u.name })),
          },
          {
            key: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ],
          },
        ]}
        sorts={[
          { value: "created_at", label: "Created date" },
          { value: "name", label: "Name" },
          { value: "handle", label: "Handle" },
        ]}
      />

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState
            icon="🏛️"
            title="No clubs found"
            message="Try a different name or handle — or clear the filters."
          />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>Club</Th>
                  <Th>University</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Members</Th>
                  <Th className="text-right">Officers</Th>
                  <Th className="text-right">Posts</Th>
                  <Th className="text-right">Events</Th>
                  <Th className="text-right">Reports</Th>
                  <Th>Created</Th>
                </>
              }
            >
              {result.rows.map((c) => (
                <RowLink key={c.id} href={`/admin/clubs/${c.id}`}>
                  <Td>
                    <IdentityCell name={c.name} sub={`@${c.handle}`} avatarUrl={c.avatar_url} />
                  </Td>
                  <Td className="text-gray-600">{c.university ?? <span className="text-gray-300">—</span>}</Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      {c.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}
                      {c.claimed ? <Badge tone="blue">Claimed</Badge> : null}
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums">{c.member_count}</Td>
                  <Td className="text-right tabular-nums">
                    {c.officer_count > 0 ? <Badge tone="teal">{c.officer_count}</Badge> : <span className="text-gray-400">0</span>}
                  </Td>
                  <Td className="text-right tabular-nums">{c.post_count}</Td>
                  <Td className="text-right tabular-nums">{c.event_count}</Td>
                  <Td className="text-right tabular-nums">
                    {c.report_count > 0 ? <Badge tone="red">{c.report_count}</Badge> : <span className="text-gray-400">0</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-gray-600">{fmtDate(c.created_at)}</Td>
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
