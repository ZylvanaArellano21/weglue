import Link from "next/link";
import { ContentLifecycleControls, LifecycleBadge } from "./ContentLifecycleActions";
import { Badge, Field, SectionCard, EmptyState } from "./primitives";
import type { AuditEventRow } from "../../lib/admin/auditData";
import type { LifecycleDetailResult, LifecycleRecord } from "../../lib/admin/lifecycleData";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : "—";
}

function AuditHistory({ events }: { events: AuditEventRow[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon="🕵️"
        title="No related audit events"
        message="No lifecycle audit row is available for this item. Creator deletions recorded before migration 063 are not reconstructed."
      />
    );
  }
  return (
    <ul className="divide-y divide-gray-100">
      {events.map((event) => (
        <li key={event.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-xs font-medium text-gray-900">{event.action}</code>
              <Badge tone={event.success ? "green" : "amber"}>{event.success ? "Success" : "Failed"}</Badge>
            </div>
            <p className="mt-1 text-xs text-gray-500">{fmt(event.occurred_at)}</p>
            {event.reason ? <p className="mt-1 text-sm text-gray-700">Internal reason: {event.reason}</p> : null}
            {event.error_code ? <p className="mt-1 text-sm text-amber-700">Outcome: {event.error_code}</p> : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
            <Link href={`/admin/audit-history/${event.id}`} className="text-teal-700 hover:underline">
              View event →
            </Link>
            <Link
              href={`/admin/audit-history?correlation=${event.correlation_id}`}
              className="font-mono text-gray-500 hover:text-teal-700 hover:underline"
              title={event.correlation_id}
            >
              Correlation {shortId(event.correlation_id)}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Details({ record, available }: { record: LifecycleRecord; available: boolean }) {
  const creator = record.creator;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <SectionCard title="Lifecycle" className="lg:col-span-2">
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <LifecycleBadge status={record.displayStatus} />
              {record.displayStatus === "restored" ? <span className="text-xs text-gray-500">Active after administrator restoration</span> : null}
            </div>
            <ContentLifecycleControls
              entityType={record.entity_type}
              entityId={record.entity_id}
              state={record.state}
              displayStatus={record.displayStatus}
              available={available}
            />
          </div>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Lifecycle status"><LifecycleBadge status={record.displayStatus} /></Field>
            <Field label="Underlying access state"><span className="capitalize">{record.state.replace(/_/g, " ")}</span></Field>
            <Field label="Content type"><span className="capitalize">{record.entity_type}</span></Field>
            <Field label="Content identifier"><code className="break-all text-xs">{record.entity_id}</code></Field>
            <Field label="Creator">
              {creator.id ? (
                <Link href={`/admin/users/${creator.id}`} className="text-teal-700 hover:underline">
                  {creator.name || creator.username || "Deleted creator"}
                  {creator.username ? ` (@${creator.username})` : ""}
                </Link>
              ) : (
                <span className="text-gray-400">Unavailable</span>
              )}
            </Field>
            <Field label="Creator identifier"><code className="break-all text-xs">{creator.id ?? "—"}</code></Field>
            <Field label="Creator deletion"><span>{fmt(record.creator_deleted_at)}</span></Field>
            <Field label="Administrator removal"><span>{fmt(record.removed_at)}</span></Field>
            <Field label="Removed by"><code className="break-all text-xs">{record.removed_by ?? "—"}</code></Field>
            <Field label="Removal correlation">
              {record.removal_correlation_id ? (
                <Link href={`/admin/audit-history?correlation=${record.removal_correlation_id}`} className="font-mono text-xs text-teal-700 hover:underline">
                  {record.removal_correlation_id}
                </Link>
              ) : "—"}
            </Field>
            <Field label="Restored"><span>{fmt(record.restored_at)}</span></Field>
            <Field label="Restored by"><code className="break-all text-xs">{record.restored_by ?? "—"}</code></Field>
            <Field label="Restoration correlation">
              {record.restoration_correlation_id ? (
                <Link href={`/admin/audit-history?correlation=${record.restoration_correlation_id}`} className="font-mono text-xs text-teal-700 hover:underline">
                  {record.restoration_correlation_id}
                </Link>
              ) : "—"}
            </Field>
            <Field label="Content created"><span>{fmt(record.content_created_at)}</span></Field>
          </dl>
        </div>
      </SectionCard>

      <div className="space-y-6">
        <SectionCard title="Purge — read only">
          <div className="space-y-3 p-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Eligibility</p>
              <p className={`mt-1 text-sm font-medium ${record.purge.eligible ? "text-teal-700" : "text-gray-700"}`}>
                {record.purge.eligible ? "Eligible" : "Not eligible"}
              </p>
              <p className="mt-1 text-sm text-gray-600">{record.purge.eligibilityReason}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Purge status</p>
              <p className="mt-1 text-sm text-gray-700">{record.purge.status}</p>
              {record.purge_requested_at ? <p className="mt-1 text-xs text-gray-500">Requested: {fmt(record.purge_requested_at)}</p> : null}
              {record.purge_completed_at ? <p className="mt-1 text-xs text-gray-500">Completed: {fmt(record.purge_completed_at)}</p> : null}
            </div>
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              Day 10C does not provide a purge request, worker, schedule, secret or permanent-delete control.
            </p>
          </div>
        </SectionCard>
        <Link
          href={`/admin/audit-history?target=${record.entity_id}&targetType=${record.entity_type}`}
          className="inline-flex text-sm font-medium text-teal-700 hover:underline"
        >
          View all related audit history →
        </Link>
      </div>
    </div>
  );
}

export function LifecycleDetails({ result }: { result: LifecycleDetailResult }) {
  if (!result.available) {
    return (
      <SectionCard title="Lifecycle">
        <div className="p-4">
          <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {result.message ?? "Lifecycle management is unavailable."}
          </p>
        </div>
      </SectionCard>
    );
  }
  if (!result.record) {
    return (
      <SectionCard title="Lifecycle">
        <EmptyState icon="🔍" title="Content lifecycle record not found" message="The content may no longer exist or the identifier is invalid." />
      </SectionCard>
    );
  }
  return (
    <div className="space-y-6">
      {result.message ? <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">{result.message}</p> : null}
      <Details record={result.record} available={result.available} />
      <SectionCard title="Removal and restoration history" action={<Link href={`/admin/audit-history?target=${result.record.entity_id}&targetType=${result.record.entity_type}`} className="text-xs text-teal-700 hover:underline">View audit history →</Link>}>
        <AuditHistory events={result.auditEvents} />
      </SectionCard>
    </div>
  );
}
