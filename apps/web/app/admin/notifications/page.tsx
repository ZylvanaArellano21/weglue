import Link from "next/link";
import { listNotifications, listNotificationTypes, type ListNotificationsParams } from "../../../lib/admin/messagingData";
import { Avatar } from "../../../components/shared/Avatar";
import { SectionCard, Badge, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td, RowLink } from "../../../components/admin/Table";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const CAT_TONE: Record<string, "blue" | "teal" | "green" | "amber" | "neutral"> = {
  social: "blue",
  clubs: "green",
  events: "amber",
  messages: "teal",
  social_proof: "neutral",
  account: "neutral",
};

export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);

  const params: ListNotificationsParams = {
    search: get("q"),
    type: get("type") ?? "all",
    read: (get("read") as ListNotificationsParams["read"]) ?? "all",
    entityType: (get("entity") as ListNotificationsParams["entityType"]) ?? "all",
    dateFrom: get("dateFrom"),
    dateTo: get("dateTo"),
    dir: (get("dir") as "asc" | "desc") ?? "desc",
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const [result, types] = await Promise.all([listNotifications(params), listNotificationTypes()]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Notifications</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {result.total.toLocaleString()} notification{result.total === 1 ? "" : "s"}. Recipient, type, actor, target, and read state. Device push
          tokens are never shown.
        </p>
      </div>

      <ListControls
        searchPlaceholder="Search recipient name/username/email, or type…"
        dateFilter
        filters={[
          { key: "type", label: "Type", options: types.map((t) => ({ value: t.type, label: `${t.type} (${t.category})` })) },
          {
            key: "read",
            label: "Read state",
            options: [
              { value: "unread", label: "Unread" },
              { value: "read", label: "Read" },
            ],
          },
          {
            key: "entity",
            label: "Related to",
            options: [
              { value: "event", label: "Event" },
              { value: "club", label: "Club" },
              { value: "message", label: "Message / chat" },
            ],
          },
        ]}
        sorts={[{ value: "created_at", label: "Created date" }]}
      />

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState icon="🔔" title="No notifications found" message="Try a different recipient, type, or clear the filters." />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>Recipient</Th>
                  <Th>Type</Th>
                  <Th>Summary</Th>
                  <Th>Actor</Th>
                  <Th>Target</Th>
                  <Th>Read</Th>
                  <Th>Created</Th>
                </>
              }
            >
              {result.rows.map((n) => (
                <RowLink key={n.id} href={`/admin/notifications/${n.id}`}>
                  <Td>
                    <div className="min-w-0 max-w-[200px]">
                      <p className="truncate text-sm font-medium text-gray-900">{n.recipient_name || `@${n.recipient_username}`}</p>
                      <p className="truncate text-xs text-gray-400">@{n.recipient_username}</p>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-gray-700">{n.type}</span>
                      {n.category ? <Badge tone={CAT_TONE[n.category] ?? "gray"}>{n.category}</Badge> : null}
                    </div>
                  </Td>
                  <Td>
                    <span className="block max-w-[220px] truncate text-sm text-gray-600">
                      {n.title || <span className="text-gray-300">—</span>}
                      {n.group_count > 1 ? <span className="ml-1 text-xs text-gray-400">(+{n.group_count - 1})</span> : null}
                    </span>
                  </Td>
                  <Td className="text-gray-600">{n.actor_username ? `@${n.actor_username}` : <span className="text-gray-300">—</span>}</Td>
                  <Td className="text-gray-600">
                    {n.entity_type ? (
                      <span className="capitalize">
                        {n.entity_type}
                        {n.route_screen ? <span className="text-xs text-gray-400"> · {n.route_screen}</span> : null}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </Td>
                  <Td>{n.read ? <Badge tone="gray">Read</Badge> : <Badge tone="teal">Unread</Badge>}</Td>
                  <Td className="whitespace-nowrap text-xs text-gray-500">{fmtDateTime(n.created_at)}</Td>
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
