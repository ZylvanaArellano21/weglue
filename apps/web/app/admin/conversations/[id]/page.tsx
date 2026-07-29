import Link from "next/link";
import { notFound } from "next/navigation";
import { getConversationDetail } from "../../../../lib/admin/messagingData";
import { Avatar } from "../../../../components/shared/Avatar";
import { Badge, Field, SectionCard, EmptyState } from "../../../../components/admin/primitives";
import { DetailTabs } from "../../../../components/admin/DetailTabs";
import { DisabledAction } from "../../../../components/admin/DisabledAction";
import { CreateChannelDialog } from "../../../../components/admin/ChannelActions";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
const PERM_TONE: Record<string, "green" | "amber" | "blue"> = { everyone: "green", officers: "amber", certain: "blue" };

function MsgTypeIcon(type: string): string {
  return type === "poll" ? "📊" : type === "image" ? "🖼️" : type === "video" ? "🎬" : type === "file" ? "📎" : type === "shared_event" ? "📅" : type === "shared_post" ? "🖼️" : "💬";
}

export default async function AdminConversationDetailPage({ params }: { params: { id: string } }) {
  const conv = await getConversationDetail(params.id);
  if (!conv) notFound();

  const overviewTab = (
    <div className="grid gap-6 md:grid-cols-3">
      <SectionCard title="Conversation" className="md:col-span-2">
        <dl className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Title">{conv.title}</Field>
          <Field label="Type">
            <Badge tone={TYPE_TONE[conv.type] ?? "gray"}>{conv.type_label}</Badge>
          </Field>
          <Field label="Club">
            {conv.club_id ? (
              <Link href={`/admin/clubs/${conv.club_id}`} className="text-teal-700 hover:underline">
                {conv.club_name} <span className="text-gray-400">@{conv.club_handle}</span>
              </Link>
            ) : (
              <span className="text-gray-400">Not a club conversation</span>
            )}
          </Field>
          <Field label="University">{conv.university}</Field>
          <Field label="Creator / admin">
            {conv.creator_id ? (
              <Link href={`/admin/users/${conv.creator_id}`} className="text-teal-700 hover:underline">
                {conv.creator_name || `@${conv.creator_username}`}
              </Link>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </Field>
          <Field label="State">{conv.archived ? <Badge tone="gray">Archived</Badge> : <Badge tone="green">Active</Badge>}</Field>
          <Field label="Created">{fmtDateTime(conv.created_at)}</Field>
          <Field label="Last activity">{fmtDateTime(conv.last_activity)}</Field>
        </dl>
      </SectionCard>
      <SectionCard title="Summary">
        <dl className="grid grid-cols-2 gap-4 p-4">
          <Stat label="Participants" value={conv.participantCount} />
          <Stat label="Channels" value={conv.channelCount} />
          <Stat label="Messages" value={conv.messageCount} />
          <Stat label="Reports" value={conv.reportCount} />
          <Stat label="Open reports" value={conv.openReportCount} />
        </dl>
        <div className="border-t border-gray-100 p-4 text-xs text-gray-500">
          Hierarchy: <span className="font-medium text-gray-700">Conversation → Channel → Message</span>. This{" "}
          {conv.type_label.toLowerCase()} has {conv.channelCount} channel{conv.channelCount === 1 ? "" : "s"}.
        </div>
      </SectionCard>
    </div>
  );

  const participantsTab = (
    <SectionCard title={`Participants (${conv.participantCount})`}>
      {conv.participants.length === 0 ? (
        <EmptyState icon="👥" title="No participants" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5">Participant</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Joined</th>
                <th className="px-4 py-2.5">State</th>
                {conv.club_id ? <th className="px-4 py-2.5">Club eligibility</th> : null}
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {conv.participants.map((p) => (
                <tr key={p.user_id} className="text-gray-700">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/users/${p.user_id}`} className="flex items-center gap-2 hover:opacity-80">
                      <Avatar uri={p.avatar_url} name={p.full_name} size={28} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-gray-900">{p.full_name || p.username}</span>
                        <span className="block truncate text-xs text-gray-500">
                          @{p.username}
                          {p.email ? ` · ${p.email}` : ""}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={p.role === "Officer" || p.role === "Group admin" ? "amber" : "neutral"}>{p.role}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-gray-500">{fmtDateTime(p.joined_at)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {p.hidden ? <Badge tone="gray">Hidden</Badge> : null}
                      {p.archived ? <Badge tone="gray">Archived</Badge> : null}
                      {p.muted ? <Badge tone="gray">Muted</Badge> : null}
                      {!p.hidden && !p.archived && !p.muted ? <span className="text-xs text-gray-400">Active</span> : null}
                    </div>
                  </td>
                  {conv.club_id ? (
                    <td className="px-4 py-2.5">
                      {p.eligibility === "ok" ? (
                        <Badge tone="green">Eligible</Badge>
                      ) : p.eligibility === "not_club_member" ? (
                        <Badge tone="red">No longer a member</Badge>
                      ) : p.eligibility === "not_officer" ? (
                        <Badge tone="red">Not an officer</Badge>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  ) : null}
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/admin/users/${p.user_id}`} className="text-xs text-teal-600 hover:underline">
                      View user →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-gray-100 p-4">
        <ParticipantActionsNote type={conv.type} />
      </div>
    </SectionCard>
  );

  const channelsTab = (
    <SectionCard
      title={`Channels (${conv.channelCount})`}
      action={
        conv.type === "club_group" || conv.type === "officer_chat" || conv.type === "group" ? (
          <CreateChannelDialog conversationId={conv.id} />
        ) : null
      }
    >
      {conv.channels.length === 0 ? (
        <EmptyState icon="📢" title="No channels" message="Direct messages and custom groups may have no sub-channels." />
      ) : (
        <ul className="divide-y divide-gray-100">
          {conv.channels.map((ch) => (
            <li key={ch.id}>
              <Link href={`/admin/channels/${ch.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">#</span>
                  <span className="text-sm font-medium text-gray-900">{ch.name}</span>
                  {ch.kind === "main" ? <Badge tone="teal">Main</Badge> : null}
                  <Badge tone={PERM_TONE[ch.post_permission] ?? "gray"}>{ch.post_permission}</Badge>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="tabular-nums">{ch.message_count} msgs</span>
                  {ch.report_count > 0 ? <Badge tone="red">{ch.report_count} reports</Badge> : null}
                  <span className="text-teal-600">Open →</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );

  const messagesTab = (
    <SectionCard
      title="Recent messages (metadata)"
      action={
        <Link href={`/admin/messages?conversation=${conv.id}`} className="text-xs text-teal-600 hover:underline">
          Open in Messages →
        </Link>
      }
    >
      {conv.recentMessages.length === 0 ? (
        <EmptyState icon="✉️" title="No messages" />
      ) : (
        <ul className="divide-y divide-gray-100">
          {conv.recentMessages.map((m) => (
            <li key={m.id}>
              <Link href={`/admin/messages/${m.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-gray-50">
                <div className="flex min-w-0 items-center gap-2">
                  <span>{MsgTypeIcon(m.message_type)}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-900">
                      {m.deleted ? <span className="italic text-gray-400">Deleted message</span> : m.preview || <span className="text-gray-400">{m.message_type}</span>}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      @{m.sender_username}
                      {m.channel_name ? ` · #${m.channel_name}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-gray-400">
                  {m.has_attachment ? <span title="Has attachment">📎</span> : null}
                  {m.report_count > 0 ? <Badge tone="red">{m.report_count}</Badge> : null}
                  <span>{fmtDateTime(m.created_at)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-gray-100 p-4 text-xs text-gray-400">
        Message bodies are not shown here. Open a message to reveal its full body with a recent MFA verification. Deleted messages never reveal
        retained content.
      </div>
    </SectionCard>
  );

  const reportsTab = (
    <SectionCard
      title={`Reports (${conv.reportCount})`}
      action={
        <Link href={`/admin/reports?type=message&conversation=${conv.id}`} className="text-xs text-teal-600 hover:underline">
          Open in Reports →
        </Link>
      }
    >
      {conv.reports.length === 0 ? (
        <EmptyState icon="🚩" title="No reports" message="No messages in this conversation have been reported." />
      ) : (
        <ul className="divide-y divide-gray-100">
          {conv.reports.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <Badge tone={REPORT_TONE[r.status] ?? "gray"}>{r.status}</Badge>
                <span className="text-sm font-medium text-gray-900">{r.reason ?? "Reported message"}</span>
                {r.reporter_username ? <span className="text-xs text-gray-400">by @{r.reporter_username}</span> : null}
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span>{fmtDateTime(r.created_at)}</span>
                {r.message_id ? (
                  <Link href={`/admin/messages/${r.message_id}`} className="text-teal-600 hover:underline">
                    View message →
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-gray-100 p-4 text-xs text-gray-400">
        Retained report snapshots (content/attachment evidence) are never displayed in this dashboard.
      </div>
    </SectionCard>
  );

  const actionsTab = (
    <SectionCard title="Actions">
      <div className="space-y-4 p-4">
        <p className="text-sm text-gray-600">
          Channel management (create / rename / permissions / remove empty) lives on each{" "}
          <Link href={`/admin/channels?conversation=${conv.id}`} className="text-teal-600 hover:underline">
            channel
          </Link>
          . Message deletion and conversation deletion remain disabled.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <DisabledAction label="Add participant" reason="Only supported on custom groups via the canonical group-admin flow (not exposed here yet)" />
          <DisabledAction label="Remove participant" reason="Removing club-chat participants must go through club membership; group removal is officer-side" />
          <DisabledAction label="Delete conversation" reason="Global conversation deletion is disabled" tone="danger" />
          <DisabledAction label="Purge messages" reason="Message purge is disabled until the approved deleted-message lifecycle is deployed" tone="danger" />
        </div>
      </div>
    </SectionCard>
  );

  return (
    <div className="space-y-5">
      <Link href="/admin/conversations" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-600">
        ← Back to Conversations
      </Link>

      <div className="flex flex-wrap items-start gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-teal-50 text-3xl">
          {conv.type === "direct" ? "💬" : conv.type === "group" ? "👥" : conv.type === "officer_chat" ? "🎖️" : "🏛️"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900">{conv.title}</h1>
            <Badge tone={TYPE_TONE[conv.type] ?? "gray"}>{conv.type_label}</Badge>
            {conv.archived ? <Badge tone="gray">Archived</Badge> : null}
            {conv.reportCount > 0 ? <Badge tone="red">{conv.reportCount} reports</Badge> : null}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">
            {conv.club_id ? (
              <>
                <Link href={`/admin/clubs/${conv.club_id}`} className="text-teal-700 hover:underline">
                  {conv.club_name}
                </Link>{" "}
                ·{" "}
              </>
            ) : null}
            {conv.participantCount} participants · {conv.channelCount} channels · {conv.messageCount} messages
          </p>
        </div>
      </div>

      <DetailTabs
        tabs={[
          { key: "overview", label: "Overview", content: overviewTab },
          { key: "participants", label: "Participants", count: conv.participantCount, content: participantsTab },
          { key: "channels", label: "Channels", count: conv.channelCount, content: channelsTab },
          { key: "messages", label: "Messages", count: conv.messageCount, content: messagesTab },
          { key: "reports", label: "Reports", count: conv.reportCount, content: reportsTab },
          { key: "actions", label: "Actions", content: actionsTab },
        ]}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{value.toLocaleString()}</dd>
    </div>
  );
}

function ParticipantActionsNote({ type }: { type: string }) {
  if (type === "group") {
    return (
      <p className="text-xs text-gray-500">
        Custom-group participant management (add / remove / role) is a group-admin flow in the app. This dashboard surfaces participants read-only;
        destructive changes are not performed here.
      </p>
    );
  }
  if (type === "club_group" || type === "officer_chat") {
    return (
      <p className="text-xs text-gray-500">
        Official club-chat membership is derived from club membership (<code>club_members.role</code>). Add or remove people through the club, never by
        editing participants directly.
      </p>
    );
  }
  return <p className="text-xs text-gray-500">Direct-message participants are fixed for the life of the thread and are never modified.</p>;
}
