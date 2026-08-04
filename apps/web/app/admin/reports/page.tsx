import Link from "next/link";
import {
  listReports,
  listReportReasons,
  getReportsSummary,
  reportEntityTypeLabel,
  REPORT_ENTITY_TYPES,
  type ListReportsParams,
} from "../../../lib/admin/reportsData";
import { listUniversities } from "../../../lib/admin/data";
import { listClubOptions } from "../../../lib/admin/data2";
import { SectionCard, Badge, IdentityCell, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td, RowLink } from "../../../components/admin/Table";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const STATUS_TONE: Record<string, "amber" | "blue" | "green" | "gray"> = {
  pending: "amber",
  reviewing: "blue",
  resolved: "green",
  dismissed: "gray",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);

  // An entity page may deep-link `?type=post&id=<uuid>` — treat `id` as a
  // human-readable target search by resolving through the target label, but the
  // simplest safe behavior is to filter by entity type and let search narrow.
  const params: ListReportsParams = {
    search: get("q"),
    searchField: (get("field") as ListReportsParams["searchField"]) ?? "any",
    status: (get("status") as ListReportsParams["status"]) ?? "all",
    entityType: (get("type") as ListReportsParams["entityType"]) ?? "all",
    entityId: get("id"),
    reason: get("reason"),
    clubId: get("club"),
    universityId: get("university"),
    dateFrom: get("dateFrom"),
    dateTo: get("dateTo") ? `${get("dateTo")}T23:59:59.999Z` : undefined,
    dir: (get("dir") as "asc" | "desc") ?? "desc",
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const [result, summary, reasons, universities, clubs] = await Promise.all([
    listReports(params),
    getReportsSummary(),
    listReportReasons(),
    listUniversities(),
    listClubOptions(),
  ]);

  const stat = [
    { key: "all", label: "Total", value: summary.total, href: "/admin/reports" },
    { key: "pending", label: "Pending", value: summary.pending, href: "/admin/reports?status=pending" },
    { key: "reviewing", label: "Reviewing", value: summary.reviewing, href: "/admin/reports?status=reviewing" },
    { key: "resolved", label: "Resolved", value: summary.resolved, href: "/admin/reports?status=resolved" },
    { key: "dismissed", label: "Dismissed", value: summary.dismissed, href: "/admin/reports?status=dismissed" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Reports</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            The canonical moderation queue across every club and university. {summary.pending + summary.reviewing}{" "}
            open of {summary.total.toLocaleString()} total.
          </p>
        </div>
        <Link href="/admin/restrictions" className="text-sm text-teal-600 hover:underline">
          Restrictions →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stat.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            className="rounded-xl border border-gray-200 bg-white p-3 transition hover:border-teal-300"
          >
            <p className="text-lg font-semibold tabular-nums text-gray-900">{s.value.toLocaleString()}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </Link>
        ))}
      </div>

      <ListControls
        searchPlaceholder="Search reporter, reported user, or target (name/username/email)…"
        dateFilter
        filters={[
          {
            key: "field",
            label: "Search in",
            options: [
              { value: "reporter", label: "Reporter" },
              { value: "reported", label: "Reported user" },
              { value: "target", label: "Target" },
            ],
          },
          {
            key: "status",
            label: "Status",
            options: [
              { value: "open", label: "Open (pending + reviewing)" },
              { value: "pending", label: "Pending" },
              { value: "reviewing", label: "Reviewing" },
              { value: "resolved", label: "Resolved" },
              { value: "dismissed", label: "Dismissed" },
            ],
          },
          {
            key: "type",
            label: "Type",
            options: REPORT_ENTITY_TYPES.map((t) => ({ value: t, label: reportEntityTypeLabel(t) })),
          },
          { key: "reason", label: "Reason", options: reasons.map((r) => ({ value: r, label: r })) },
          { key: "university", label: "University", options: universities.map((u) => ({ value: u.id, label: u.name })) },
          { key: "club", label: "Club", options: clubs.map((c) => ({ value: c.id, label: c.name })) },
        ]}
        sorts={[{ value: "created_at", label: "Reported date" }]}
      />

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState icon="🚩" title="No reports found" message="Try a different reporter, target, status, or clear the filters." />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>Report ID</Th>
                  <Th>Status</Th>
                  <Th>Resolution</Th>
                  <Th>Enforcement</Th>
                  <Th>Target</Th>
                  <Th>Reason</Th>
                  <Th>Reporter</Th>
                  <Th>Reported user</Th>
                  <Th>Club</Th>
                  <Th>University</Th>
                  <Th className="text-right">Grouped</Th>
                  <Th>Evidence</Th>
                  <Th>Reported</Th>
                </>
              }
            >
              {result.rows.map((r) => (
                <RowLink key={r.id} href={`/admin/reports/${r.id}`}>
                  <Td className="font-mono text-xs text-gray-500">{r.id}</Td>
                  <Td><Badge tone={STATUS_TONE[r.status] ?? "gray"}>{r.status}</Badge></Td>
                  <Td className="text-gray-700">{r.resolution_outcome?.replace(/_/g, " ") ?? <span className="text-gray-300">—</span>}</Td>
                  <Td className="text-gray-700">{r.enforcement_action?.replace(/_/g, " ") ?? <span className="text-gray-300">—</span>}</Td>
                  <Td>
                    <div className="min-w-0 max-w-[240px]">
                      <p className="truncate text-sm text-gray-900">{r.target_label}</p>
                      <p className="text-xs text-gray-400">{r.entity_type_label}</p>
                    </div>
                  </Td>
                  <Td className="text-gray-700">{r.reason ?? <span className="text-gray-300">—</span>}</Td>
                  <Td>
                    {r.reporter_username ? (
                      <IdentityCell name={`@${r.reporter_username}`} sub={r.reporter_email ?? undefined} />
                    ) : (
                      <span className="text-gray-400">Deleted / anonymous</span>
                    )}
                  </Td>
                  <Td className="text-gray-700">
                    {r.reported_username ? `@${r.reported_username}` : <span className="text-gray-300">—</span>}
                  </Td>
                  <Td className="text-gray-600">{r.club_name ?? <span className="text-gray-300">—</span>}</Td>
                  <Td className="text-gray-600">{r.university ?? <span className="text-gray-300">—</span>}</Td>
                  <Td className="text-right tabular-nums">
                    {r.related_count > 0 ? <Badge tone="red">+{r.related_count}</Badge> : <span className="text-gray-400">0</span>}
                  </Td>
                  <Td>
                    {r.has_protected_evidence ? (
                      <span title="Protected evidence is available only after the founder private gateway and fresh MFA verification.">
                        <Badge tone="gray">🔒 Retained</Badge>
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-gray-600">{fmtDate(r.created_at)}</Td>
                </RowLink>
              ))}
            </Table>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} />
          </>
        )}
      </SectionCard>

      <p className="text-xs text-gray-400">
        Message &amp; conversation reports show only safe workflow metadata. Retained evidence is available only from an
        authorized report detail view after the founder private gateway and fresh MFA verification.
      </p>
    </div>
  );
}
