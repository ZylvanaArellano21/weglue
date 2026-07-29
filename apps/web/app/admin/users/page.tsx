import { listUsers, listUniversities, type ListUsersParams } from "../../../lib/admin/data";
import { SectionCard, Badge, IdentityCell, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td, RowLink } from "../../../components/admin/Table";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);

  const params: ListUsersParams = {
    search: get("q"),
    universityId: get("university"),
    onboarding: (get("onboarding") as ListUsersParams["onboarding"]) ?? "all",
    sort: (get("sort") as ListUsersParams["sort"]) ?? "created_at",
    dir: (get("dir") as "asc" | "desc") ?? "desc",
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const [result, universities] = await Promise.all([listUsers(params), listUniversities()]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Users</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {result.total.toLocaleString()} member{result.total === 1 ? "" : "s"} across every university.
        </p>
      </div>

      <ListControls
        searchPlaceholder="Search by name, username, or email…"
        filters={[
          {
            key: "university",
            label: "University",
            options: universities.map((u) => ({ value: u.id, label: u.name })),
          },
          {
            key: "onboarding",
            label: "Onboarding",
            options: [
              { value: "completed", label: "Completed" },
              { value: "pending", label: "Pending" },
            ],
          },
        ]}
        sorts={[
          { value: "created_at", label: "Joined date" },
          { value: "full_name", label: "Name" },
          { value: "username", label: "Username" },
        ]}
      />

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState
            icon="👤"
            title="No users found"
            message="Try a different name, username, or email — or clear the filters."
          />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>User</Th>
                  <Th>Email</Th>
                  <Th>University</Th>
                  <Th>Onboarding</Th>
                  <Th>Joined</Th>
                  <Th className="text-right">Clubs</Th>
                  <Th className="text-right">Officer</Th>
                  <Th className="text-right">Reports</Th>
                </>
              }
            >
              {result.rows.map((u) => (
                <RowLink key={u.id} href={`/admin/users/${u.id}`}>
                  <Td>
                    <IdentityCell name={u.full_name || u.username} sub={`@${u.username}`} avatarUrl={u.avatar_url} />
                  </Td>
                  <Td className="text-gray-600">{u.email ?? <span className="text-gray-300">—</span>}</Td>
                  <Td className="text-gray-600">{u.university ?? <span className="text-gray-300">—</span>}</Td>
                  <Td>
                    {u.onboarding_completed ? (
                      <Badge tone="green">Completed</Badge>
                    ) : (
                      <Badge tone="amber">Pending</Badge>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-gray-600">{fmtDate(u.created_at)}</Td>
                  <Td className="text-right tabular-nums">{u.club_count}</Td>
                  <Td className="text-right tabular-nums">
                    {u.officer_count > 0 ? <Badge tone="teal">{u.officer_count}</Badge> : <span className="text-gray-400">0</span>}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {u.report_count > 0 ? <Badge tone="red">{u.report_count}</Badge> : <span className="text-gray-400">0</span>}
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
