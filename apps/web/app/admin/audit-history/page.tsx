import Link from "next/link";
import { getAuditStatus } from "../../../lib/admin/historyData";
import { SectionCard, Badge, EmptyState } from "../../../components/admin/primitives";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminAuditHistoryPage() {
  const status = await getAuditStatus();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Audit History</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Who changed what, when. Structured audit events are emitted today; a persisted, queryable table is deferred.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Canonical audit table</p>
          <div className="mt-2"><Badge tone="amber">Not yet available</Badge></div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Structured logging</p>
          <div className="mt-2"><Badge tone="green">Active</Badge></div>
          <p className="mt-1 text-xs text-gray-400">tag: <code>{status.logTag}</code></p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Persisted queries</p>
          <div className="mt-2"><Badge tone="gray">Unavailable</Badge></div>
        </div>
      </div>

      <SectionCard title="What emits structured audit events today">
        <ul className="divide-y divide-gray-100">
          {status.coverage.map((c) => (
            <li key={c.namespace} className="flex items-start justify-between gap-4 px-4 py-3">
              <div>
                <code className="text-sm font-medium text-gray-900">{c.namespace}</code>
                <p className="mt-0.5 text-xs text-gray-500">{c.description}</p>
              </div>
              <Badge tone="green">Logged</Badge>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Persisted audit query">
        <EmptyState
          icon="🕵️"
          title="No persisted audit table to query"
          message="Every admin write is recorded as a structured, greppable server-log line under the admin_audit tag. Those lines are the durable trail today; the dashboard never presents in-memory browser events as permanent audit history."
        />
      </SectionCard>

      <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4 text-sm text-amber-800">
        <p className="font-medium">Deferred to the Day-6 / final backlog</p>
        <p className="mt-1 text-amber-700">{status.deferredRequirement}</p>
      </div>

      <p className="text-xs text-gray-400">
        Related: <Link href="/admin/edit-history" className="text-teal-600 hover:underline">Edit History</Link> ·{" "}
        <Link href="/admin/settings" className="text-teal-600 hover:underline">Admin Settings</Link>
      </p>
    </div>
  );
}
