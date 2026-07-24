import Link from "next/link";
import { listOfficers, listClubOptions, clubOfficerCounts, type ListOfficersParams } from "../../../lib/admin/data2";
import { listUniversities } from "../../../lib/admin/data";
import { SectionCard, Badge, IdentityCell, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td } from "../../../components/admin/Table";
import { AddOfficerDialog, MemberRowActions } from "../../../components/admin/MembershipControls";

export const dynamic = "force-dynamic";

export default async function AdminOfficersPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);
  const params: ListOfficersParams = {
    search: get("q"),
    clubId: get("club"),
    universityId: get("university"),
    dir: (get("dir") as "asc" | "desc") ?? "desc",
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const [result, universities, clubs] = await Promise.all([
    listOfficers(params),
    listUniversities(),
    listClubOptions(),
  ]);
  const officerCounts = await clubOfficerCounts(result.rows.map((r) => r.club_id));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Officers</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Authority is <code className="rounded bg-gray-100 px-1 text-xs">club_members.role = &apos;officer&apos;</code>.
            The <code className="rounded bg-gray-100 px-1 text-xs">club_officers</code> roster holds the display title.
          </p>
        </div>
        <AddOfficerDialog />
      </div>

      <ListControls
        searchPlaceholder="Search by officer name, username, title, or club…"
        filters={[
          { key: "club", label: "Club", options: clubs.map((c) => ({ value: c.id, label: c.name })) },
          { key: "university", label: "University", options: universities.map((u) => ({ value: u.id, label: u.name })) },
        ]}
        sorts={[{ value: "joined_at", label: "Since" }]}
      />

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState icon="🎖️" title="No officers found" message="Adjust the search or filters." />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>Officer</Th>
                  <Th>Title</Th>
                  <Th>Club</Th>
                  <Th>University</Th>
                  <Th>Manage</Th>
                </>
              }
            >
              {result.rows.map((o) => (
                <tr key={o.id} className="text-gray-700">
                  <Td>
                    <IdentityCell
                      name={o.full_name || o.username}
                      sub={`@${o.username}${o.email ? ` · ${o.email}` : ""}`}
                      avatarUrl={o.avatar_url}
                      href={`/admin/users/${o.user_id}`}
                    />
                  </Td>
                  <Td><Badge tone="teal">{o.officer_title ?? "Officer"}</Badge></Td>
                  <Td>
                    <Link href={`/admin/clubs/${o.club_id}`} className="text-sm font-medium text-gray-900 hover:text-teal-600">
                      {o.club_name}
                    </Link>
                    <span className="block text-xs text-gray-500">@{o.club_handle}</span>
                  </Td>
                  <Td className="text-gray-600">{o.university ?? <span className="text-gray-300">—</span>}</Td>
                  <Td>
                    <MemberRowActions
                      clubId={o.club_id}
                      userId={o.user_id}
                      role="officer"
                      officerCount={officerCounts.get(o.club_id) ?? 1}
                      roleTitle={o.officer_title}
                    />
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
