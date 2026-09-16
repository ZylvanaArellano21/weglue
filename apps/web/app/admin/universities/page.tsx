import {
  describeCampusEmailPolicy,
  getCampusMode,
  listUniversitiesFull,
} from "../../../lib/admin/data2";
import { SectionCard, Badge, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Table, Th, Td, RowLink } from "../../../components/admin/Table";
import { AddUniversityDialog } from "../../../components/admin/UniversityControls";
import { DisabledAction } from "../../../components/admin/DisabledAction";

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
  const [rows, campus] = await Promise.all([listUniversitiesFull(q), getCampusMode()]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Universities</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {rows.length.toLocaleString()} campus{rows.length === 1 ? "" : "es"} — canonical{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">universities</code>. Slug is the identifier the apps use;
            the email rule is per-campus data enforced by{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">campus_email_allowed()</code>.
          </p>
        </div>
        {/* Single-campus mode gates creation. The server action refuses on the
            same signal, so this is a matching affordance, not the whole rule. */}
        {campus.singleCampusMode ? (
          <DisabledAction
            label="＋ Add university"
            reason="We Glue is in single-campus mode (app_config.single_campus_mode = true)."
          />
        ) : (
          <AddUniversityDialog />
        )}
      </div>

      {campus.singleCampusMode ? (
        <div className="rounded-xl border border-teal-100 bg-teal-50/60 p-4 text-sm text-teal-800">
          <p className="font-medium">Single-campus mode is active</p>
          <p className="mt-1 text-teal-700">
            We Glue currently operates on one campus only
            {campus.launchUniversityName ? (
              <>
                {" "}
                — <span className="font-medium">{campus.launchUniversityName}</span>
              </>
            ) : null}
            . Adding a university is disabled in both the interface and the server action while{" "}
            <code className="rounded bg-white/60 px-1 text-xs">single_campus_mode</code> is true. Editing and
            activate/deactivate remain available. The capability is gated, not removed: turning single-campus mode off
            in <code className="rounded bg-white/60 px-1 text-xs">app_config</code> restores it with no code change.
          </p>
        </div>
      ) : null}

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
                <Th>Email rule</Th>
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
                <Td className="text-gray-600">
                  <Badge tone={u.email_mode === "allowlist" ? "blue" : "gray"}>
                    {describeCampusEmailPolicy(u)}
                  </Badge>
                </Td>
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
