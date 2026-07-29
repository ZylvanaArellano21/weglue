import Link from "next/link";
import { listMessages, type ListMessagesParams } from "../../../lib/admin/messagingData";
import { SectionCard, Badge, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td, RowLink } from "../../../components/admin/Table";
import { SensitiveMessageSearch } from "../../../components/admin/SensitiveMessageSearch";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const TYPE_TONE: Record<string, "blue" | "teal" | "green" | "amber"> = {
  direct: "blue",
  group: "teal",
  club_group: "green",
  officer_chat: "amber",
};

function MsgTypeIcon(type: string): string {
  return type === "poll" ? "📊" : type === "image" ? "🖼️" : type === "video" ? "🎬" : type === "file" ? "📎" : type === "shared_event" ? "📅" : type === "shared_post" ? "🖼️" : "💬";
}

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);

  const params: ListMessagesParams = {
    search: get("q"),
    conversationId: get("conversation"),
    channelId: get("channel"),
    type: (get("type") as ListMessagesParams["type"]) ?? "all",
    attachment: (get("attachment") as ListMessagesParams["attachment"]) ?? "all",
    poll: (get("poll") as ListMessagesParams["poll"]) ?? "all",
    reports: (get("reports") as ListMessagesParams["reports"]) ?? "all",
    state: (get("state") as ListMessagesParams["state"]) ?? "all",
    dateFrom: get("dateFrom"),
    dateTo: get("dateTo"),
    dir: (get("dir") as "asc" | "desc") ?? "desc",
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const result = await listMessages(params);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Messages</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {result.total.toLocaleString()} message{result.total === 1 ? "" : "s"}. Metadata only — full private bodies require a recent MFA
          verification, and deleted messages never reveal retained content.
        </p>
      </div>

      <ListControls
        searchPlaceholder="Search by sender name/username/email or conversation name…"
        dateFilter
        filters={[
          {
            key: "type",
            label: "Type",
            options: [
              { value: "text", label: "Text" },
              { value: "image", label: "Image" },
              { value: "video", label: "Video" },
              { value: "poll", label: "Poll" },
              { value: "file", label: "File" },
              { value: "shared_event", label: "Shared event" },
              { value: "shared_post", label: "Shared post" },
            ],
          },
          {
            key: "attachment",
            label: "Attachment",
            options: [
              { value: "with", label: "With attachment" },
              { value: "without", label: "No attachment" },
            ],
          },
          { key: "poll", label: "Poll", options: [{ value: "poll", label: "Polls only" }] },
          { key: "reports", label: "Reports", options: [{ value: "reported", label: "Reported only" }] },
          {
            key: "state",
            label: "State",
            options: [
              { value: "active", label: "Active" },
              { value: "deleted", label: "Deleted" },
            ],
          },
        ]}
        sorts={[{ value: "created_at", label: "Sent date" }]}
      />

      <SectionCard title="Sensitive: search message content">
        <div className="p-4">
          <SensitiveMessageSearch />
        </div>
      </SectionCard>

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState icon="✉️" title="No messages found" message="Try a different sender, conversation, filter, or clear the filters." />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>Message</Th>
                  <Th>Sender</Th>
                  <Th>Conversation</Th>
                  <Th>Channel</Th>
                  <Th>Type</Th>
                  <Th className="text-right">Reports</Th>
                  <Th>Sent</Th>
                  <Th>State</Th>
                </>
              }
            >
              {result.rows.map((m) => (
                <RowLink key={m.id} href={`/admin/messages/${m.id}`}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span>{MsgTypeIcon(m.message_type)}</span>
                      <div className="min-w-0 max-w-[220px]">
                        <p className="truncate text-sm text-gray-900">
                          {m.deleted ? (
                            <span className="italic text-gray-400">Deleted message</span>
                          ) : (
                            m.preview || <span className="text-gray-400 capitalize">{m.message_type.replace("_", " ")}</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400">
                          {m.has_attachment ? "📎 attachment " : ""}
                          {m.is_poll ? "📊 poll " : ""}
                          {m.edited ? "· edited" : ""}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-gray-600">@{m.sender_username}</Td>
                  <Td>
                    <div className="min-w-0 max-w-[180px]">
                      <p className="truncate text-sm text-gray-700">{m.conversation_title}</p>
                      {m.conversation_type ? <Badge tone={TYPE_TONE[m.conversation_type] ?? "gray"}>{m.conversation_type_label}</Badge> : null}
                    </div>
                  </Td>
                  <Td className="text-gray-600">{m.channel_name ? `#${m.channel_name}` : <span className="text-gray-300">—</span>}</Td>
                  <Td className="capitalize text-gray-600">{m.message_type.replace("_", " ")}</Td>
                  <Td className="text-right tabular-nums">
                    {m.report_count > 0 ? <Badge tone="red">{m.report_count}</Badge> : <span className="text-gray-400">0</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-gray-500">{fmtDateTime(m.created_at)}</Td>
                  <Td>{m.deleted ? <Badge tone="gray">Deleted</Badge> : <Badge tone="green">Active</Badge>}</Td>
                </RowLink>
              ))}
            </Table>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} />
          </>
        )}
      </SectionCard>
    </div>
  );
}
