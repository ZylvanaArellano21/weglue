import Link from "next/link";
import { listGluemates, type ListGluematesParams } from "../../../lib/admin/data2";
import { listUniversities } from "../../../lib/admin/data";
import { SectionCard, EmptyState } from "../../../components/admin/primitives";
import { Avatar } from "../../../components/shared/Avatar";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { RemoveGluemateButton } from "../../../components/admin/GluemateControls";

export const dynamic = "force-dynamic";

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
}

function UserChip({ u }: { u: { id: string; full_name: string; username: string; avatar_url: string | null } }) {
  return (
    <Link href={`/admin/users/${u.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-gray-50">
      <Avatar uri={u.avatar_url} name={u.full_name} size={28} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-gray-900">{u.full_name || u.username}</span>
        <span className="block truncate text-xs text-gray-500">@{u.username}</span>
      </span>
    </Link>
  );
}

export default async function AdminGluematesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);
  const params: ListGluematesParams = {
    search: get("q"),
    universityId: get("university"),
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const [result, universities] = await Promise.all([listGluemates(params), listUniversities()]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Gluemates</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {result.total.toLocaleString()} mutual-follow relationship{result.total === 1 ? "" : "s"} — derived live from{" "}
          <code className="rounded bg-gray-100 px-1 text-xs">follows</code> (accepted both ways). Not a separate table.
        </p>
      </div>

      <ListControls
        searchPlaceholder="Search by either user's name or username…"
        filters={[{ key: "university", label: "University", options: universities.map((u) => ({ value: u.id, label: u.name })) }]}
      />

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState icon="🔗" title="No gluemates found" message="No mutual follows match these filters." />
        ) : (
          <>
            <ul className="divide-y divide-gray-100">
              {result.rows.map((g) => (
                <li key={`${g.a.id}:${g.b.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <UserChip u={g.a} />
                    <span className="text-teal-500">🔗</span>
                    <UserChip u={g.b} />
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-gray-400">since {fmtDate(g.since)}</span>
                    <RemoveGluemateButton
                      userAId={g.a.id}
                      userBId={g.b.id}
                      nameA={g.a.full_name || g.a.username}
                      nameB={g.b.full_name || g.b.username}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} />
          </>
        )}
      </SectionCard>
    </div>
  );
}
