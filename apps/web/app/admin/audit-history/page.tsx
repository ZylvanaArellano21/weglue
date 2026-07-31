import Link from "next/link";
import {
  isAuditTableAvailable,
  listAuditEvents,
  listAuditActions,
  getAuditSummary,
  type ListAuditParams,
} from "../../../lib/admin/auditData";
import { AUDIT_TARGET_TYPES } from "../../../lib/admin/auditSanitize";
import { SectionCard, Badge, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td, RowLink } from "../../../components/admin/Table";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Short id for dense table cells; the full value is always in the detail view. */
function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : "—";
}

export default async function AdminAuditHistoryPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);

  // Migration 055 is deliberately NOT applied to production during Day 10A, so
  // this page must degrade honestly rather than error. The probe asks the
  // database in use, not a config flag.
  const available = await isAuditTableAvailable();

  if (!available) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Audit History</h1>
          <p className="mt-0.5 text-sm text-gray-500">Who changed what, when — from the durable audit table.</p>
        </div>

        <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4 text-sm text-amber-800">
          <p className="font-medium">Migration 055 is not applied to this database</p>
          <p className="mt-1 text-amber-700">
            The durable audit table (<code>admin_audit_events</code>) does not exist here yet, so there is nothing to
            query. This page is wired and ready; it will show real records the moment 055 is applied. No historical
            records were fabricated or backfilled — the trail begins at the first action taken after deployment.
          </p>
        </div>

        <SectionCard title="Until then">
          <EmptyState
            icon="🕵️"
            title="Audit events are being written to server logs only"
            message="Every admin action still emits a structured, greppable line under the admin_audit tag. Those lines are operational telemetry, not a durable trail — which is exactly the gap migration 055 closes."
          />
        </SectionCard>
      </div>
    );
  }

  const params: ListAuditParams = {
    action: get("action") ?? "all",
    targetType: get("targetType") ?? "all",
    outcome: get("outcome") ?? "all",
    dateFrom: get("dateFrom"),
    dateTo: get("dateTo"),
    correlationId: get("correlation"),
    actorId: get("actor"),
    targetId: get("target"),
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const [result, actions, summary] = await Promise.all([
    listAuditEvents(params),
    listAuditActions(),
    getAuditSummary(),
  ]);

  const correlationScope = get("correlation");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Audit History</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {summary.total.toLocaleString()} durable event{summary.total === 1 ? "" : "s"} · append-only · read-only
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Total events</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{summary.total.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Last 24 hours</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{summary.last24h.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Failures</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{summary.failures.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Administrators</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{summary.distinctActors.toLocaleString()}</p>
        </div>
      </div>

      {correlationScope ? (
        <div className="flex items-center justify-between rounded-lg border border-teal-100 bg-teal-50/60 px-4 py-2 text-sm text-teal-800">
          <span>
            Showing one correlated operation · <code className="text-xs">{correlationScope}</code>
          </span>
          <Link href="/admin/audit-history" className="font-medium hover:underline">
            Clear →
          </Link>
        </div>
      ) : null}

      <ListControls
        searchPlaceholder="Filter with the controls →"
        dateFilter
        filters={[
          {
            key: "action",
            label: "Action",
            options: actions.map((a) => ({ value: a.action, label: a.action })),
          },
          {
            key: "targetType",
            label: "Target type",
            options: AUDIT_TARGET_TYPES.map((t) => ({ value: t, label: t })),
          },
          {
            key: "outcome",
            label: "Outcome",
            options: [
              { value: "success", label: "Success" },
              { value: "failure", label: "Failure" },
            ],
          },
        ]}
      />

      <SectionCard title="Events">
        {result.rows.length === 0 ? (
          <EmptyState
            icon="🕵️"
            title="No audit events match"
            message="Either no administrator action has been recorded yet, or the current filters exclude everything. The table is append-only and starts empty by design — nothing is backfilled."
          />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>When</Th>
                  <Th>Administrator</Th>
                  <Th>Action</Th>
                  <Th>Target</Th>
                  <Th>Reason</Th>
                  <Th>Outcome</Th>
                  <Th>Correlation</Th>
                </>
              }
            >
              {result.rows.map((e) => (
                <RowLink key={e.id} href={`/admin/audit-history/${e.id}`}>
                  <Td className="whitespace-nowrap text-xs text-gray-600">{fmtTs(e.occurred_at)}</Td>
                  <Td>
                    <span className="text-sm text-gray-900">{e.actor_email ?? "—"}</span>
                    <span className="block font-mono text-[11px] text-gray-400">{shortId(e.actor_user_id)}</span>
                  </Td>
                  <Td>
                    <code className="text-xs text-gray-900">{e.action}</code>
                  </Td>
                  <Td>
                    <span className="text-xs text-gray-700">{e.target_type}</span>
                    <span className="block font-mono text-[11px] text-gray-400">{shortId(e.target_id)}</span>
                  </Td>
                  <Td className="max-w-[220px] truncate text-xs text-gray-600">{e.reason ?? undefined}</Td>
                  <Td>
                    {e.success ? (
                      <Badge tone="green">Success</Badge>
                    ) : (
                      <Badge tone="amber">Failed</Badge>
                    )}
                  </Td>
                  <Td className="font-mono text-[11px] text-gray-400">{shortId(e.correlation_id)}</Td>
                </RowLink>
              ))}
            </Table>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} />
          </>
        )}
      </SectionCard>

      <p className="text-xs text-gray-400">
        This table is append-only at the database level: no administrator — and not even the service-role key — can
        update or delete a recorded event. Related:{" "}
        <Link href="/admin/edit-history" className="text-teal-600 hover:underline">
          Edit History
        </Link>{" "}
        ·{" "}
        <Link href="/admin/settings" className="text-teal-600 hover:underline">
          Admin Settings
        </Link>
      </p>
    </div>
  );
}
