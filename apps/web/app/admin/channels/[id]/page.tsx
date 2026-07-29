import Link from "next/link";
import { notFound } from "next/navigation";
import { getChannelDetail } from "../../../../lib/admin/messagingData";
import { Avatar } from "../../../../components/shared/Avatar";
import { Badge, Field, SectionCard, EmptyState } from "../../../../components/admin/primitives";
import { DetailTabs } from "../../../../components/admin/DetailTabs";
import { ChannelManageActions } from "../../../../components/admin/ChannelActions";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const PERM_TONE: Record<string, "green" | "amber" | "blue"> = { everyone: "green", officers: "amber", certain: "blue" };
const TYPE_TONE: Record<string, "blue" | "teal" | "green" | "amber"> = {
  direct: "blue",
  group: "teal",
  club_group: "green",
  officer_chat: "amber",
};

function MsgTypeIcon(type: string): string {
  return type === "poll" ? "📊" : type === "image" ? "🖼️" : type === "video" ? "🎬" : type === "file" ? "📎" : "💬";
}

export default async function AdminChannelDetailPage({ params }: { params: { id: string } }) {
  const ch = await getChannelDetail(params.id);
  if (!ch) notFound();

  const overviewTab = (
    <div className="grid gap-6 md:grid-cols-3">
      <SectionCard title="Channel" className="md:col-span-2">
        <dl className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Name">#{ch.name}</Field>
          <Field label="Kind">{ch.kind === "main" ? <Badge tone="teal">Main chat</Badge> : <Badge tone="neutral">Hashtag channel</Badge>}</Field>
          <Field label="Parent conversation">
            <Link href={`/admin/conversations/${ch.conversation_id}`} className="text-teal-700 hover:underline">
              {ch.conversation_title}
            </Link>{" "}
            <Badge tone={TYPE_TONE[ch.conversation_type] ?? "gray"}>{ch.conversation_type_label}</Badge>
          </Field>
          <Field label="Club">
            {ch.club_id ? (
              <Link href={`/admin/clubs/${ch.club_id}`} className="text-teal-700 hover:underline">
                {ch.club_name} <span className="text-gray-400">@{ch.club_handle}</span>
              </Link>
            ) : (
              <span className="text-gray-400">Not a club conversation</span>
            )}
          </Field>
          <Field label="University">{ch.university}</Field>
          <Field label="Posting permission">
            <Badge tone={PERM_TONE[ch.post_permission] ?? "gray"}>{ch.post_permission}</Badge>
          </Field>
          <Field label="Creator">
            {ch.creator_id ? (
              <Link href={`/admin/users/${ch.creator_id}`} className="text-teal-700 hover:underline">
                @{ch.creator_username}
              </Link>
            ) : (
              <span className="text-gray-400">System / seeded</span>
            )}
          </Field>
          <Field label="Created">{fmtDateTime(ch.created_at)}</Field>
          <Field label="State">{ch.archived ? <Badge tone="gray">Archived</Badge> : <Badge tone="green">Active</Badge>}</Field>
        </dl>
      </SectionCard>
      <SectionCard title="Summary">
        <dl className="grid grid-cols-2 gap-4 p-4">
          <Stat label="Messages" value={ch.messageCount} />
          <Stat label="Reports" value={ch.reportCount} />
        </dl>
        {ch.post_permission === "certain" ? (
          <div className="border-t border-gray-100 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Allowed posters ({ch.allowed_posters.length})</p>
            {ch.allowed_posters.length === 0 ? (
              <p className="text-xs text-gray-400">No specific posters listed.</p>
            ) : (
              <ul className="space-y-1">
                {ch.allowed_posters.map((p) => (
                  <li key={p.user_id}>
                    <Link href={`/admin/users/${p.user_id}`} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-gray-50">
                      <Avatar uri={p.avatar_url} name={p.full_name} size={22} />
                      <span className="text-xs text-gray-700">@{p.username}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        <div className="border-t border-gray-100 p-4 text-xs text-gray-500">
          Hierarchy: <span className="font-medium text-gray-700">Conversation → Channel → Message</span>.
        </div>
      </SectionCard>
    </div>
  );

  const messagesTab = (
    <SectionCard
      title="Recent messages (metadata)"
      action={
        <Link href={`/admin/messages?channel=${ch.id}`} className="text-xs text-teal-600 hover:underline">
          Open in Messages →
        </Link>
      }
    >
      {ch.recentMessages.length === 0 ? (
        <EmptyState icon="✉️" title="No messages in this channel" />
      ) : (
        <ul className="divide-y divide-gray-100">
          {ch.recentMessages.map((m) => (
            <li key={m.id}>
              <Link href={`/admin/messages/${m.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-gray-50">
                <div className="flex min-w-0 items-center gap-2">
                  <span>{MsgTypeIcon(m.message_type)}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-900">
                      {m.deleted ? <span className="italic text-gray-400">Deleted message</span> : m.preview || <span className="text-gray-400">{m.message_type}</span>}
                    </p>
                    <p className="truncate text-xs text-gray-500">@{m.sender_username}</p>
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
    </SectionCard>
  );

  const actionsTab = (
    <SectionCard title="Channel actions">
      <div className="space-y-4 p-4">
        <ChannelManageActions channelId={ch.id} name={ch.name} kind={ch.kind} permission={ch.post_permission} isEmpty={ch.isEmpty} />
        <p className="text-xs text-gray-400">
          Rename, posting-permission, and empty-channel removal write to the canonical <code>conversation_channels</code> row with founder
          authorization, a read-back check, and an audit event, and require the write kill switch to be enabled. The Main chat is permanent; a channel
          holding messages can never be removed here (no message cascade).
        </p>
      </div>
    </SectionCard>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 text-sm text-gray-500">
        <Link href="/admin/channels" className="hover:text-teal-600">
          ← Back to Channels
        </Link>
        <span className="text-gray-300">·</span>
        <Link href={`/admin/conversations/${ch.conversation_id}`} className="hover:text-teal-600">
          Parent conversation
        </Link>
      </div>

      <div className="flex flex-wrap items-start gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-teal-50 text-3xl">#</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900">#{ch.name}</h1>
            {ch.kind === "main" ? <Badge tone="teal">Main</Badge> : null}
            <Badge tone={PERM_TONE[ch.post_permission] ?? "gray"}>{ch.post_permission}</Badge>
            {ch.archived ? <Badge tone="gray">Archived</Badge> : null}
            {ch.reportCount > 0 ? <Badge tone="red">{ch.reportCount} reports</Badge> : null}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">
            in{" "}
            <Link href={`/admin/conversations/${ch.conversation_id}`} className="text-teal-700 hover:underline">
              {ch.conversation_title}
            </Link>{" "}
            · {ch.messageCount} messages
          </p>
        </div>
      </div>

      <DetailTabs
        tabs={[
          { key: "overview", label: "Overview", content: overviewTab },
          { key: "messages", label: "Messages", count: ch.messageCount, content: messagesTab },
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
