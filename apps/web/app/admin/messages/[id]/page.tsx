import Link from "next/link";
import { notFound } from "next/navigation";
import { getMessageDetail } from "../../../../lib/admin/messagingData";
import { Avatar } from "../../../../components/shared/Avatar";
import { Badge, Field, SectionCard, EmptyState } from "../../../../components/admin/primitives";
import { DetailTabs } from "../../../../components/admin/DetailTabs";
import { DisabledAction } from "../../../../components/admin/DisabledAction";
import { MessageBodyReveal } from "../../../../components/admin/MessageBodyReveal";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
}
function fmtSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TYPE_TONE: Record<string, "blue" | "teal" | "green" | "amber"> = {
  direct: "blue",
  group: "teal",
  club_group: "green",
  officer_chat: "amber",
};
const REPORT_TONE: Record<string, "amber" | "blue" | "green" | "gray"> = {
  pending: "amber",
  reviewing: "blue",
  resolved: "green",
  dismissed: "gray",
};

export default async function AdminMessageDetailPage({ params }: { params: { id: string } }) {
  const msg = await getMessageDetail(params.id);
  if (!msg) notFound();

  const overviewTab = (
    <div className="grid gap-6 md:grid-cols-3">
      <SectionCard title="Message" className="md:col-span-2">
        <div className="space-y-4 p-4">
          {msg.deleted ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
              <div className="flex items-center gap-2">
                <Badge tone="gray">Deleted / redacted</Badge>
                <span className="text-xs text-gray-500">deleted {fmtDateTime(msg.deleted_at)}</span>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                The ordinary message body and attachment references were scrubbed. Any retained report evidence is
                available only from its report after the founder private gateway and fresh MFA verification.
              </p>
            </div>
          ) : (
            <>
              {msg.preview ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Preview</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{msg.preview}</p>
                </div>
              ) : (
                <p className="text-sm text-gray-500 capitalize">{msg.message_type.replace("_", " ")} message — no text preview.</p>
              )}
              <MessageBodyReveal messageId={msg.id} deleted={msg.deleted} />
            </>
          )}
        </div>
      </SectionCard>
      <SectionCard title="Metadata">
        <dl className="grid gap-4 p-4">
          <Field label="Type">
            <span className="capitalize">{msg.message_type.replace("_", " ")}</span>
          </Field>
          <Field label="State">{msg.deleted ? <Badge tone="gray">Deleted</Badge> : <Badge tone="green">Active</Badge>}</Field>
          <Field label="Sent">{fmtDateTime(msg.created_at)}</Field>
          <Field label="Edited">{msg.edited ? <Badge tone="amber">Edited</Badge> : <span className="text-gray-400">No</span>}</Field>
          {msg.edited ? <Field label="Last updated">{fmtDateTime(msg.updated_at)}</Field> : null}
          <Field label="Reports">{msg.reportCount > 0 ? <Badge tone="red">{msg.reportCount}</Badge> : "0"}</Field>
        </dl>
      </SectionCard>
    </div>
  );

  const contextTab = (
    <div className="grid gap-6 md:grid-cols-3">
      <SectionCard title="Sender">
        <div className="flex items-center justify-between p-4">
          <Link href={`/admin/users/${msg.sender_id}`} className="flex items-center gap-3 hover:opacity-80">
            <Avatar uri={msg.sender_avatar} name={msg.sender_name} size={40} />
            <div>
              <p className="text-sm font-medium text-gray-900">{msg.sender_name || msg.sender_username}</p>
              <p className="text-xs text-gray-500">@{msg.sender_username}</p>
            </div>
          </Link>
          <Link href={`/admin/users/${msg.sender_id}`} className="text-sm text-teal-600 hover:underline">
            View →
          </Link>
        </div>
      </SectionCard>
      <SectionCard title="Conversation">
        <div className="space-y-2 p-4">
          <Link href={`/admin/conversations/${msg.conversation_id}`} className="text-sm font-medium text-teal-700 hover:underline">
            {msg.conversation_title}
          </Link>
          <div>
            <Badge tone={TYPE_TONE[msg.conversation_type] ?? "gray"}>{msg.conversation_type_label}</Badge>
          </div>
          {msg.club_id ? (
            <Link href={`/admin/clubs/${msg.club_id}`} className="block text-xs text-teal-600 hover:underline">
              {msg.club_name} →
            </Link>
          ) : null}
        </div>
      </SectionCard>
      <SectionCard title="Channel">
        <div className="p-4">
          {msg.channel_id ? (
            <Link href={`/admin/channels/${msg.channel_id}`} className="text-sm font-medium text-teal-700 hover:underline">
              #{msg.channel_name}
            </Link>
          ) : (
            <p className="text-sm text-gray-400">No channel (direct message or custom group)</p>
          )}
          <p className="mt-2 text-xs text-gray-400">Conversation → Channel → Message</p>
        </div>
      </SectionCard>
    </div>
  );

  const attachmentPollTab = (
    <div className="grid gap-6 md:grid-cols-2">
      <SectionCard title={`Attachments (${msg.attachments.length})`}>
        {msg.attachments.length > 0 ? (
          <ol className="divide-y divide-gray-100">
            {msg.attachments.map((attachment) => (
              <li key={attachment.position} className="space-y-2 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">#{attachment.position + 1}</Badge>
                    <span className="text-sm font-medium capitalize text-gray-900">{attachment.kind}</span>
                  </div>
                  {attachment.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <Field label="Type / MIME">{attachment.mime ?? "unknown"}</Field>
                  <Field label="Filename">{attachment.name ?? "Unnamed attachment"}</Field>
                  <Field label="Size">{fmtSize(attachment.size)}</Field>
                  <Field label="Dimensions">
                    {attachment.width && attachment.height ? `${attachment.width} × ${attachment.height}` : "—"}
                  </Field>
                </dl>
                <DisabledAction
                  label="Preview attachment"
                  reason="Authorized temporary signed preview is not enabled in this build; storage paths are never exposed and no long-lived public URL is created"
                />
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState icon="📎" title="No attachments" message={msg.deleted ? "Deleted messages never expose retained attachments." : "This message has no attachment."} />
        )}
      </SectionCard>
      <SectionCard title="Poll">
        {msg.poll ? (
          <div className="space-y-3 p-4">
            <p className="text-sm font-medium text-gray-900">{msg.poll.question}</p>
            <p className="text-xs text-gray-500">
              {msg.poll.allow_multiple ? "Multiple choice" : "Single choice"} · {msg.poll.totalVotes} vote{msg.poll.totalVotes === 1 ? "" : "s"}
            </p>
            <ul className="space-y-2">
              {msg.poll.options.map((o) => {
                const pct = msg.poll!.totalVotes > 0 ? Math.round((o.votes / msg.poll!.totalVotes) * 100) : 0;
                return (
                  <li key={o.id}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-800">{o.text}</span>
                      <span className="tabular-nums text-gray-500">
                        {o.votes} · {pct}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-teal-400" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-gray-400">Vote totals only. Direct writes to poll_votes are never performed from the dashboard.</p>
          </div>
        ) : (
          <EmptyState icon="📊" title="No poll" message={msg.deleted ? "Deleted messages never expose retained poll content." : "This message is not a poll."} />
        )}
      </SectionCard>
    </div>
  );

  const reactionsTab = (
    <SectionCard title={`Reactions (${msg.reactions.reduce((total, reaction) => total + reaction.count, 0)})`}>
      {msg.reactions.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {msg.reactions.map((reaction) => (
            <li key={reaction.emoji} className="space-y-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl" aria-label={`${reaction.emoji} reaction`}>
                  {reaction.emoji}
                </span>
                <Badge tone="neutral">{reaction.count}</Badge>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-700">
                {reaction.reactors.map((reactor, index) => (
                  <span key={`${reactor.username ?? reactor.display_name}-${index}`}>
                    {reactor.display_name}
                    {reactor.username ? <span className="ml-1 text-xs text-gray-400">@{reactor.username}</span> : null}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="🙂" title="No reactions" message={msg.deleted ? "Deleted messages never expose reaction data." : "This message has no reactions."} />
      )}
      <p className="border-t border-gray-100 p-4 text-xs text-gray-400">
        Read-only conversation metadata. Reactions are not independently moderatable and cascade with the message.
      </p>
    </SectionCard>
  );

  const reportsTab = (
    <SectionCard
      title={`Reports (${msg.reportCount})`}
      action={
        <Link href={`/admin/reports?type=message&id=${msg.id}`} className="text-xs text-teal-600 hover:underline">
          Open in Reports →
        </Link>
      }
    >
      {msg.reports.length === 0 ? (
        <EmptyState icon="🚩" title="No reports" message="This message has not been reported." />
      ) : (
        <ul className="divide-y divide-gray-100">
          {msg.reports.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <Badge tone={REPORT_TONE[r.status] ?? "gray"}>{r.status}</Badge>
                <span className="text-sm font-medium text-gray-900">{r.reason ?? "Reported"}</span>
                <span className="text-xs text-gray-400">{fmtDateTime(r.created_at)}</span>
              </div>
              {r.details ? <p className="mt-1 text-sm text-gray-600">{r.details}</p> : null}
              {r.reporter_username ? <p className="mt-0.5 text-xs text-gray-400">Reported by @{r.reporter_username}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-gray-100 p-4 text-xs text-gray-400">
        Retained report content/attachment snapshots are never displayed in this dashboard.
      </div>
    </SectionCard>
  );

  const actionsTab = (
    <SectionCard title="Actions">
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <DisabledAction label="Delete / redact message" reason="This dashboard does not bypass the dedicated server-authorized message privacy lifecycle" tone="danger" />
        <DisabledAction label="Restore deleted message" reason="Restore is disabled; retained history is never accessed" tone="danger" />
        <DisabledAction label="Clear deletion fields" reason="Direct edits to deletion state are never permitted" tone="danger" />
        <DisabledAction label="Delete attachment" reason="Managed attachment deletion is disabled in this build" tone="danger" />
      </div>
      <div className="border-t border-gray-100 p-4 text-xs text-gray-400">
        Supported here: navigate to the sender, conversation, channel, or related reports; reveal the full active body with a recent MFA
        verification. Deleted-message evidence is available only from a related protected report. No direct message mutation is exposed.
      </div>
    </SectionCard>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
        <Link href="/admin/messages" className="hover:text-teal-600">
          ← Back to Messages
        </Link>
        <span className="text-gray-300">·</span>
        <Link href={`/admin/conversations/${msg.conversation_id}`} className="hover:text-teal-600">
          {msg.conversation_title}
        </Link>
        {msg.channel_id ? (
          <>
            <span className="text-gray-300">›</span>
            <Link href={`/admin/channels/${msg.channel_id}`} className="hover:text-teal-600">
              #{msg.channel_name}
            </Link>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-start gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <Avatar uri={msg.sender_avatar} name={msg.sender_name} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-gray-900">Message from @{msg.sender_username}</h1>
            <Badge tone={msg.deleted ? "gray" : "green"}>{msg.deleted ? "Deleted" : "Active"}</Badge>
            <Badge tone="neutral">{msg.message_type.replace("_", " ")}</Badge>
            {msg.reportCount > 0 ? <Badge tone="red">{msg.reportCount} reports</Badge> : null}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">
            {msg.conversation_type_label} · {fmtDateTime(msg.created_at)}
          </p>
        </div>
      </div>

      <DetailTabs
        tabs={[
          { key: "overview", label: "Message", content: overviewTab },
          { key: "context", label: "Sender & context", content: contextTab },
          { key: "media", label: "Attachment & poll", content: attachmentPollTab },
          { key: "reactions", label: "Reactions", count: msg.reactions.reduce((total, reaction) => total + reaction.count, 0), content: reactionsTab },
          { key: "reports", label: "Reports", count: msg.reportCount, content: reportsTab },
          { key: "actions", label: "Actions", content: actionsTab },
        ]}
      />
    </div>
  );
}
