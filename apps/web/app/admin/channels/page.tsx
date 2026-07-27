import Link from "next/link";
import { listChannels, type ListChannelsParams } from "../../../lib/admin/messagingData";
import { listClubOptions } from "../../../lib/admin/data2";
import { SectionCard, Badge, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td, RowLink } from "../../../components/admin/Table";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const PERM_TONE: Record<string, "green" | "amber" | "blue"> = { everyone: "green", officers: "amber", certain: "blue" };
const TYPE_TONE: Record<string, "blue" | "teal" | "green" | "amber"> = {
  direct: "blue",
  group: "teal",
  club_group: "green",
  officer_chat: "amber",
};

export default async function AdminChannelsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);

  const params: ListChannelsParams = {
    search: get("q"),
    conversationId: get("conversation"),
    clubId: get("club"),
    kind: (get("kind") as ListChannelsParams["kind"]) ?? "all",
    permission: (get("permission") as ListChannelsParams["permission"]) ?? "all",
    state: (get("state") as ListChannelsParams["state"]) ?? "all",
    dir: (get("dir") as "asc" | "desc") ?? "desc",
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const [result, clubs] = await Promise.all([listChannels(params), listClubOptions()]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Channels</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {result.total.toLocaleString()} channel{result.total === 1 ? "" : "s"} — sub-threads inside conversations (Conversation → Channel →
          Message).
        </p>
      </div>

      <ListControls
        searchPlaceholder="Search channel name, conversation, or club…"
        filters={[
          { key: "club", label: "Club", options: clubs.map((c) => ({ value: c.id, label: c.name })) },
          {
            key: "kind",
            label: "Kind",
            options: [
              { value: "main", label: "Main chat" },
              { value: "channel", label: "Hashtag channel" },
            ],
          },
          {
            key: "permission",
            label: "Posting",
            options: [
              { value: "everyone", label: "Everyone" },
              { value: "officers", label: "Officers only" },
              { value: "certain", label: "Certain members" },
            ],
          },
          {
            key: "state",
            label: "State",
            options: [
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
            ],
          },
        ]}
        sorts={[{ value: "created_at", label: "Created date" }]}
      />

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState icon="📢" title="No channels found" message="Try a different name, conversation, club, or clear the filters." />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>Channel</Th>
                  <Th>Conversation</Th>
                  <Th>Club</Th>
                  <Th>Posting</Th>
                  <Th className="text-right">Messages</Th>
                  <Th className="text-right">Reports</Th>
                  <Th>State</Th>
                </>
              }
            >
              {result.rows.map((ch) => (
                <RowLink key={ch.id} href={`/admin/channels/${ch.id}`}>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-400">#</span>
                      <span className="text-sm font-medium text-gray-900">{ch.name}</span>
                      {ch.kind === "main" ? <Badge tone="teal">Main</Badge> : null}
                    </div>
                  </Td>
                  <Td>
                    <div className="min-w-0 max-w-[200px]">
                      <p className="truncate text-sm text-gray-700">{ch.conversation_title}</p>
                      <Badge tone={TYPE_TONE[ch.conversation_type] ?? "gray"}>{ch.conversation_type_label}</Badge>
                    </div>
                  </Td>
                  <Td className="text-gray-600">{ch.club_name ?? <span className="text-gray-300">—</span>}</Td>
                  <Td>
                    <Badge tone={PERM_TONE[ch.post_permission] ?? "gray"}>{ch.post_permission}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{ch.message_count}</Td>
                  <Td className="text-right tabular-nums">
                    {ch.report_count > 0 ? <Badge tone="red">{ch.report_count}</Badge> : <span className="text-gray-400">0</span>}
                  </Td>
                  <Td>{ch.archived ? <Badge tone="gray">Archived</Badge> : <Badge tone="green">Active</Badge>}</Td>
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
