import { listConversations, type ListConversationsParams } from "../../../lib/admin/messagingData";
import { listClubOptions } from "../../../lib/admin/data2";
import { SectionCard, Badge, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td, RowLink } from "../../../components/admin/Table";

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

export default async function AdminConversationsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);

  const params: ListConversationsParams = {
    search: get("q"),
    type: (get("type") as ListConversationsParams["type"]) ?? "all",
    clubId: get("club"),
    state: (get("state") as ListConversationsParams["state"]) ?? "all",
    reports: (get("reports") as ListConversationsParams["reports"]) ?? "all",
    dateFrom: get("dateFrom"),
    dateTo: get("dateTo"),
    dir: (get("dir") as "asc" | "desc") ?? "desc",
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const [result, clubs] = await Promise.all([listConversations(params), listClubOptions()]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Conversations</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {result.total.toLocaleString()} conversation{result.total === 1 ? "" : "s"} — DMs, custom groups, and official club chats.
        </p>
      </div>

      <ListControls
        searchPlaceholder="Search conversation name, participant name/username/email, or club…"
        dateFilter
        filters={[
          {
            key: "type",
            label: "Type",
            options: [
              { value: "direct", label: "Direct message" },
              { value: "group", label: "Custom group" },
              { value: "club_group", label: "Club chat" },
              { value: "officer_chat", label: "Official club chat" },
            ],
          },
          { key: "club", label: "Club", options: clubs.map((c) => ({ value: c.id, label: c.name })) },
          {
            key: "state",
            label: "State",
            options: [
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
            ],
          },
          { key: "reports", label: "Reports", options: [{ value: "reported", label: "Reported only" }] },
        ]}
        sorts={[{ value: "created_at", label: "Created date" }]}
      />

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState icon="🗨️" title="No conversations found" message="Try a different name, participant, club, or clear the filters." />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>Conversation</Th>
                  <Th>Type</Th>
                  <Th>Club</Th>
                  <Th className="text-right">People</Th>
                  <Th className="text-right">Channels</Th>
                  <Th className="text-right">Messages</Th>
                  <Th className="text-right">Reports</Th>
                  <Th>Last activity</Th>
                  <Th>State</Th>
                </>
              }
            >
              {result.rows.map((c) => (
                <RowLink key={c.id} href={`/admin/conversations/${c.id}`}>
                  <Td>
                    <div className="min-w-0 max-w-[240px]">
                      <p className="truncate text-sm font-medium text-gray-900">{c.title}</p>
                      {c.creator_username ? <p className="truncate text-xs text-gray-400">by @{c.creator_username}</p> : null}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={TYPE_TONE[c.type] ?? "gray"}>{c.type_label}</Badge>
                  </Td>
                  <Td className="text-gray-600">{c.club_name ?? <span className="text-gray-300">—</span>}</Td>
                  <Td className="text-right tabular-nums">{c.participant_count}</Td>
                  <Td className="text-right tabular-nums">{c.channel_count}</Td>
                  <Td className="text-right tabular-nums">{c.message_count}</Td>
                  <Td className="text-right tabular-nums">
                    {c.report_count > 0 ? <Badge tone="red">{c.report_count}</Badge> : <span className="text-gray-400">0</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-gray-500">{fmtDateTime(c.last_activity)}</Td>
                  <Td>{c.archived ? <Badge tone="gray">Archived</Badge> : <Badge tone="green">Active</Badge>}</Td>
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
