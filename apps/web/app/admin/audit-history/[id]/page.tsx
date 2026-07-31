import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuditEventDetail } from "../../../../lib/admin/auditData";
import { SectionCard, Badge, Field, EmptyState } from "../../../../components/admin/primitives";

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

/**
 * Render a sanitized state object as typed key/value rows.
 *
 * Deliberately NOT a raw JSON dump. Everything in these columns already passed
 * an application allowlist and a database scan, so there is no secret here to
 * leak — but a readable table is what makes an unexpected value obvious, and an
 * unreadable blob is where a mistake would hide.
 */
function StateTable({ state }: { state: Record<string, unknown> | null }) {
  if (!state || Object.keys(state).length === 0) {
    return <p className="px-4 py-3 text-sm text-gray-400">Not recorded.</p>;
  }
  return (
    <dl className="divide-y divide-gray-100">
      {Object.entries(state).map(([k, v]) => (
        <div key={k} className="flex items-start gap-4 px-4 py-2.5">
          <dt className="w-44 shrink-0 font-mono text-xs text-gray-500">{k}</dt>
          <dd className="min-w-0 flex-1 break-words text-sm text-gray-900">
            {v === null || v === undefined ? (
              <span className="text-gray-300">null</span>
            ) : typeof v === "boolean" ? (
              <Badge tone={v ? "green" : "gray"}>{String(v)}</Badge>
            ) : typeof v === "object" ? (
              <span className="font-mono text-xs text-gray-600">{JSON.stringify(v)}</span>
            ) : (
              String(v)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Compare before/after and mark the fields that actually moved. */
function changedKeys(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): string[] {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

export default async function AdminAuditEventPage({ params }: { params: { id: string } }) {
  const event = await getAuditEventDetail(params.id);
  if (!event) notFound();

  const changed = changedKeys(event.before_state, event.after_state);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/admin/audit-history" className="text-xs text-teal-600 hover:underline">
            ← Audit History
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-gray-900">
            <code>{event.action}</code>
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">{event.description ?? "Recorded administrator action."}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {event.success ? <Badge tone="green">Success</Badge> : <Badge tone="amber">Failed</Badge>}
          {event.sensitivity ? (
            <Badge tone={event.sensitivity === "destructive" ? "amber" : event.sensitivity === "sensitive" ? "amber" : "gray"}>
              {event.sensitivity}
            </Badge>
          ) : null}
        </div>
      </div>

      <SectionCard title="Record">
        <div className="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-2">
          <Field label="Timestamp">{fmtTs(event.occurred_at)}</Field>
          <Field label="Outcome">{event.success ? "Success" : `Failed — ${event.error_code ?? "unspecified"}`}</Field>
          <Field label="Administrator">{event.actor_email ?? "—"}</Field>
          <Field label="Administrator UUID">
            <span className="font-mono text-xs">{event.actor_user_id}</span>
          </Field>
          <Field label="Target type">{event.target_type}</Field>
          <Field label="Target ID">
            <span className="font-mono text-xs">{event.target_id ?? "—"}</span>
          </Field>
          <Field label="Correlation ID">
            <Link
              href={`/admin/audit-history?correlation=${event.correlation_id}`}
              className="font-mono text-xs text-teal-600 hover:underline"
            >
              {event.correlation_id}
            </Link>
          </Field>
          <Field label="Event ID">
            <span className="font-mono text-xs">{event.id}</span>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Reason">
        {event.reason ? (
          <p className="px-4 py-3 text-sm text-gray-900">{event.reason}</p>
        ) : (
          <p className="px-4 py-3 text-sm text-gray-400">
            No reason recorded. This action does not require one
            {event.success ? "" : ", and failure records are never dropped for want of a reason"}.
          </p>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={`Before${changed.length ? ` · ${changed.length} field(s) changed` : ""}`}>
          <StateTable state={event.before_state} />
        </SectionCard>
        <SectionCard title="After">
          <StateTable state={event.after_state} />
        </SectionCard>
      </div>

      <SectionCard title="Metadata">
        <StateTable state={event.metadata} />
      </SectionCard>

      <SectionCard title={`Rest of this operation (${event.related.length})`}>
        {event.related.length === 0 ? (
          <EmptyState
            icon="🔗"
            title="Single-step operation"
            message="No other audit event shares this correlation ID, so this action stood alone."
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {event.related.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <div className="min-w-0">
                  <Link href={`/admin/audit-history/${r.id}`} className="text-sm text-teal-600 hover:underline">
                    <code className="text-xs">{r.action}</code>
                  </Link>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {fmtTs(r.occurred_at)} · {r.target_type}
                  </p>
                </div>
                {r.success ? <Badge tone="green">Success</Badge> : <Badge tone="amber">Failed</Badge>}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <p className="text-xs text-gray-400">
        Read-only. Audit events cannot be edited or deleted by anyone, including the founder — append-only is enforced
        by database trigger, not by this interface.
      </p>
    </div>
  );
}
