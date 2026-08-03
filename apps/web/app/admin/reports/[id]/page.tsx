import Link from "next/link";
import { notFound } from "next/navigation";
import { getReportDetail } from "../../../../lib/admin/reportsData";
import { Avatar } from "../../../../components/shared/Avatar";
import { Badge, Field, SectionCard, EmptyState } from "../../../../components/admin/primitives";
import { DetailTabs } from "../../../../components/admin/DetailTabs";
import { ReportResolutionPanel } from "../../../../components/admin/ReportResolutionPanel";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const STATUS_TONE: Record<string, "amber" | "blue" | "green" | "gray"> = {
  pending: "amber",
  reviewing: "blue",
  resolved: "green",
  dismissed: "gray",
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function AdminReportDetailPage({ params }: { params: { id: string } }) {
  const report = await getReportDetail(params.id);
  if (!report) notFound();

  const overviewTab = (
    <div className="grid gap-6 md:grid-cols-3">
      <SectionCard title="Report" className="md:col-span-2">
        <dl className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Status"><Badge tone={STATUS_TONE[report.status] ?? "gray"}>{report.status}</Badge></Field>
          <Field label="Report ID"><span className="font-mono text-xs">{report.id}</span></Field>
          <Field label="Target type">{report.entity_type_label}</Field>
          <Field label="Target ID"><span className="font-mono text-xs">{report.entity_id ?? "—"}</span></Field>
          <Field label="Reason">{report.reason ?? "—"}</Field>
          <Field label="Reported">{fmtDateTime(report.created_at)}</Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              {report.details ? (
                <p className="whitespace-pre-wrap text-sm text-gray-900">{report.details}</p>
              ) : (
                <span className="text-gray-400">No description provided by the reporter</span>
              )}
            </Field>
          </div>
        </dl>
      </SectionCard>

      <SectionCard title="Target">
        <div className="space-y-3 p-4">
          <p className="text-sm text-gray-900">{report.target_label}</p>
          <p className="text-xs text-gray-500">{report.entity_type_label}</p>
          {report.target_href ? (
            <Link href={report.target_href} className="inline-block text-sm text-teal-600 hover:underline">
              Open {report.entity_type_label.toLowerCase()} →
            </Link>
          ) : (
            <p className="text-xs text-gray-400">The target could not be linked (it may have been deleted).</p>
          )}
          {report.club_id ? (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Related club</p>
              <Link href={`/admin/clubs/${report.club_id}`} className="text-sm text-teal-700 hover:underline">
                {report.club_name ?? "Club"} {report.club_handle ? `· @${report.club_handle}` : ""}
              </Link>
              {report.university ? <p className="mt-0.5 text-xs text-gray-400">{report.university}</p> : null}
            </div>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );

  const peopleTab = (
    <div className="grid gap-6 md:grid-cols-2">
      <SectionCard title="Reporter">
        {report.reporter_username || report.reporter_email ? (
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Avatar uri={report.reporter_avatar} name={report.reporter_name || report.reporter_username || "Reporter"} size={44} />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {report.reporter_name || (report.reporter_username ? `@${report.reporter_username}` : "Reporter")}
                </p>
                <p className="text-xs text-gray-500">
                  {report.reporter_username ? `@${report.reporter_username}` : ""}
                  {report.reporter_email ? ` · ${report.reporter_email}` : ""}
                </p>
              </div>
            </div>
            {report.reporter_id && report.reporter_exists ? (
              <Link href={`/admin/users/${report.reporter_id}`} className="text-sm text-teal-600 hover:underline">
                View user →
              </Link>
            ) : (
              <Badge tone="gray">No profile</Badge>
            )}
          </div>
        ) : (
          <EmptyState icon="🕵️" title="Anonymous / deleted reporter" message="The reporter's account is no longer available." />
        )}
      </SectionCard>

      <SectionCard title="Reported user">
        {report.reported_user_id ? (
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Avatar uri={report.reported_avatar} name={report.reported_name || report.reported_username || "User"} size={44} />
              <div>
                <p className="text-sm font-medium text-gray-900">{report.reported_name || `@${report.reported_username}`}</p>
                <p className="text-xs text-gray-500">{report.reported_username ? `@${report.reported_username}` : ""}</p>
              </div>
            </div>
            <Link href={`/admin/users/${report.reported_user_id}`} className="text-sm text-teal-600 hover:underline">
              View user →
            </Link>
          </div>
        ) : (
          <EmptyState icon="👤" title="No reported user" message="This report targets content or a club, not a specific user." />
        )}
      </SectionCard>
    </div>
  );

  const evidenceTab = (
    <SectionCard title="Evidence & message context">
      <div className="space-y-4 p-4">
        {report.message ? (
          <>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Conversation type">{report.message.conversation_type ?? "—"}</Field>
              <Field label="Message type">{report.message.message_type ?? "—"}</Field>
              <Field label="Conversation">
                {report.message.conversation_href ? (
                  <Link href={report.message.conversation_href} className="text-teal-600 hover:underline">
                    Open conversation →
                  </Link>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Message">
                {report.message.message_id ? (
                  <Link href={`/admin/messages/${report.message.message_id}`} className="text-teal-600 hover:underline">
                    Open message metadata →
                  </Link>
                ) : (
                  "—"
                )}
              </Field>
            </dl>
            {report.evidence ? (
              <div className="rounded-lg border border-teal-100 bg-teal-50/60 px-4 py-3 text-sm text-teal-900">
                <p className="font-medium">Retained evidence (founder-only)</p>
                {report.evidence.content_snapshot ? <p className="mt-2 whitespace-pre-wrap">{report.evidence.content_snapshot}</p> : <p className="mt-2 text-teal-700">No retained text snapshot.</p>}
                {report.evidence.attachment ? <p className="mt-2 text-xs">Attachment: {report.evidence.attachment.available && report.evidence.attachment.signed_url ? <a className="underline" href={report.evidence.attachment.signed_url} target="_blank" rel="noreferrer">Open short-lived secure media</a> : "Unavailable or expired"}</p> : null}
              </div>
            ) : <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-4 py-3 text-sm text-amber-800"><p className="font-medium">Evidence unavailable</p><p className="mt-1">No legally accessible retained evidence is currently available.</p></div>}
          </>
        ) : (
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-600">
            This report has no protected message evidence. Use the target link to review the reported content directly.
          </div>
        )}
        <p className="text-xs text-gray-400">
          Email delivery: {report.email_delivered ? "sent to the moderation inbox" : "not yet delivered"}
          {report.email_error ? ` · last error logged (${report.email_error})` : ""}. Evidence is server-authorized and never copied into audit metadata or browser logs.
        </p>
      </div>
    </SectionCard>
  );

  const relatedTab = (
    <SectionCard title={`Related reports (${report.relatedReports.length})`}>
      {report.relatedReports.length === 0 ? (
        <EmptyState icon="🗂️" title="No related reports" message="No other reports target this same entity." />
      ) : (
        <ul className="divide-y divide-gray-100">
          {report.relatedReports.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_TONE[r.status] ?? "gray"}>{r.status}</Badge>
                <span className="text-sm text-gray-900">{r.reason ?? "Reported"}</span>
                {r.reporter_username ? <span className="text-xs text-gray-400">by @{r.reporter_username}</span> : null}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">{fmtDateTime(r.created_at)}</span>
                <Link href={`/admin/reports/${r.id}`} className="text-xs text-teal-600 hover:underline">
                  Open →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );

  const actionsTab = (
    <SectionCard title="Moderation">
      <div className="space-y-4 p-4">
        {report.decisions.length > 0 ? <div className="rounded-lg border border-gray-100 bg-gray-50 p-3"><h3 className="text-sm font-semibold text-gray-900">Decision history</h3><ol className="mt-3 space-y-3">{report.decisions.map((d) => <li key={d.id} className="border-l-2 border-teal-300 pl-3 text-sm"><div className="flex flex-wrap gap-2"><Badge tone={STATUS_TONE[d.new_status] ?? "gray"}>{d.new_status}</Badge><span className="text-gray-600">{d.resolution_outcome.replace(/_/g, " ")}</span><span className="text-xs text-gray-400">{fmtDateTime(d.created_at)}</span></div><p className="mt-1 text-gray-700">{d.internal_decision_note}</p><p className="mt-1 text-xs text-gray-400">Enforcement: {d.enforcement_action.replace(/_/g, " ")} · {d.enforcement_status} · Notification: {d.delivery_status ?? d.notification_status} · Correlation {d.correlation_id}</p></li>)}</ol></div> : null}
        {report.auditEvents.length > 0 ? <div className="rounded-lg border border-gray-100 p-3"><h3 className="text-sm font-semibold text-gray-900">Related audit events</h3><ul className="mt-2 space-y-2 text-xs">{report.auditEvents.map((a) => <li key={a.id} className="flex flex-wrap gap-2"><Badge tone={a.success ? "green" : "red"}>{a.success ? "success" : "failure"}</Badge><span>{a.action}</span><span className="text-gray-400">{a.correlation_id}</span><span className="text-gray-400">{fmtDateTime(a.occurred_at)}</span></li>)}</ul></div> : null}
        <ReportResolutionPanel reportId={report.id} status={report.status} entityType={report.entity_type} />
        <p className="text-xs text-gray-400">
          Decisions are terminal, append-only, atomically enforced, and linked by one correlation ID. Internal notes never
          reach students or notification payloads.
        </p>
      </div>
    </SectionCard>
  );

  return (
    <div className="space-y-5">
      <Link href="/admin/reports" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-600">
        ← Back to Reports
      </Link>

      <div className="flex flex-wrap items-start gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gray-100 text-2xl">🚩</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-gray-900">{report.reason ?? "Report"}</h1>
            <Badge tone={STATUS_TONE[report.status] ?? "gray"}>{report.status}</Badge>
            <Badge tone="gray">{report.entity_type_label}</Badge>
            {report.relatedReports.length > 0 ? <Badge tone="red">+{report.relatedReports.length} related</Badge> : null}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">
            Target: <span className="text-gray-700">{report.target_label}</span> · {fmtDateTime(report.created_at)}
          </p>
        </div>
      </div>

      <DetailTabs
        tabs={[
          { key: "overview", label: "Overview", content: overviewTab },
          { key: "people", label: "People", content: peopleTab },
          { key: "evidence", label: "Evidence", content: evidenceTab },
          { key: "related", label: "Related", count: report.relatedReports.length, content: relatedTab },
          { key: "actions", label: "Actions", content: actionsTab },
        ]}
      />
    </div>
  );
}
