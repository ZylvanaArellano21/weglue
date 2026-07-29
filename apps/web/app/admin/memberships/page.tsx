import { listMemberships, listClubOptions, type ListMembershipsParams } from "../../../lib/admin/data2";
import { listUniversities } from "../../../lib/admin/data";
import { SectionCard, Badge, IdentityCell, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td, RowLink } from "../../../components/admin/Table";
import { AddMemberDialog } from "../../../components/admin/MembershipControls";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminMembershipsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);
  const params: ListMembershipsParams = {
    search: get("q"),
    role: (get("role") as ListMembershipsParams["role"]) ?? "all",
    clubId: get("club"),
    universityId: get("university"),
    sort: (get("sort") as ListMembershipsParams["sort"]) ?? "joined_at",
    dir: (get("dir") as "asc" | "desc") ?? "desc",
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const [result, universities, clubs] = await Promise.all([
    listMemberships(params),
    listUniversities(),
    listClubOptions(),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Memberships</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {result.total.toLocaleString()} membership{result.total === 1 ? "" : "s"} — the canonical{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">club_members</code> relationship.
          </p>
        </div>
        <AddMemberDialog />
      </div>

      <ListControls
        searchPlaceholder="Search by user, username, email, or club…"
        filters={[
          { key: "role", label: "Role", options: [ { value: "member", label: "Member" }, { value: "officer", label: "Officer" } ] },
          { key: "club", label: "Club", options: clubs.map((c) => ({ value: c.id, label: c.name })) },
          { key: "university", label: "University", options: universities.map((u) => ({ value: u.id, label: u.name })) },
        ]}
        sorts={[ { value: "joined_at", label: "Joined date" }, { value: "role", label: "Role" } ]}
      />

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState icon="🎟️" title="No memberships found" message="Adjust the search or filters." />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>User</Th>
                  <Th>Club</Th>
                  <Th>Role</Th>
                  <Th>Officer title</Th>
                  <Th>University</Th>
                  <Th>Joined</Th>
                </>
              }
            >
              {result.rows.map((m) => (
                <RowLink key={m.id} href={`/admin/memberships/${m.id}`}>
                  <Td>
                    <IdentityCell name={m.full_name || m.username} sub={`@${m.username}${m.email ? ` · ${m.email}` : ""}`} avatarUrl={m.avatar_url} />
                  </Td>
                  <Td>
                    <IdentityCell name={m.club_name} sub={`@${m.club_handle}`} avatarUrl={m.club_avatar} />
                  </Td>
                  <Td>{m.role === "officer" ? <Badge tone="teal">Officer</Badge> : <Badge>Member</Badge>}</Td>
                  <Td className="text-gray-600">{m.officer_title}</Td>
                  <Td className="text-gray-600">{m.university ?? <span className="text-gray-300">—</span>}</Td>
                  <Td className="whitespace-nowrap text-gray-600">{fmtDate(m.joined_at)}</Td>
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
