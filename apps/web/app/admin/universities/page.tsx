import { listUniversitiesFull } from "../../../lib/admin/data2";
import { SectionCard, Badge, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Table, Th, Td, RowLink } from "../../../components/admin/Table";
import { AddUniversityDialog } from "../../../components/admin/UniversityControls";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminUniversitiesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const q = typeof searchParams.q === "string" ? searchParams.q : undefined;
  const rows = await listUniversitiesFull(q);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Universities</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {rows.length.toLocaleString()} campus{rows.length === 1 ? "" : "es"} — canonical{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">universities</code>. (Domain→campus mapping is not yet in
            schema — slug is the identifier.)
          </p>
        </div>
        <AddUniversityDialog />
      </div>

      <ListControls searchPlaceholder="Search by name or slug…" />

      <SectionCard className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon="🎓" title="No universities found" />
        ) : (
          <Table
            head={
              <>
                <Th>Name</Th>
                <Th>Slug</Th>
                <Th>Status</Th>
                <Th className="text-right">Users</Th>
                <Th className="text-right">Clubs</Th>
                <Th>Created</Th>
              </>
            }
          >
            {rows.map((u) => (
              <RowLink key={u.id} href={`/admin/universities/${u.id}`}>
                <Td className="font-medium text-gray-900">{u.name}</Td>
                <Td className="font-mono text-gray-600">@{u.slug}</Td>
                <Td>{u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}</Td>
                <Td className="text-right tabular-nums">{u.user_count}</Td>
                <Td className="text-right tabular-nums">{u.club_count}</Td>
                <Td className="whitespace-nowrap text-gray-600">{fmtDate(u.created_at)}</Td>
              </RowLink>
            ))}
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
