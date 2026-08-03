import {
  LIFECYCLE_ENTITY_TYPES,
  LIFECYCLE_STATUS_OPTIONS,
  listContentLifecycle,
  type ListLifecycleParams,
} from "../../../lib/admin/lifecycleData";
import { LifecycleBadge } from "../../../components/admin/ContentLifecycleActions";
import { EmptyState, SectionCard } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { RowLink, Table, Td, Th } from "../../../components/admin/Table";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function creatorLabel(record: Awaited<ReturnType<typeof listContentLifecycle>>["data"]["rows"][number]): string {
  const creator = record.creator;
  if (creator.name) return creator.username ? `${creator.name} (@${creator.username})` : creator.name;
  if (creator.username) return `@${creator.username}`;
  return creator.id ? `Creator ${creator.id.slice(0, 8)}` : "Creator unavailable";
}

export default async function AdminContentLifecyclePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (key: string) => (typeof searchParams[key] === "string" ? searchParams[key] as string : undefined);
  const params: ListLifecycleParams = {
    entityType: (get("type") as ListLifecycleParams["entityType"]) ?? "all",
    status: (get("status") as ListLifecycleParams["status"]) ?? "all",
    search: get("q"),
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };
  const result = await listContentLifecycle(params);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Content lifecycle</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Private lifecycle management for posts, comments and events. Purge eligibility and status are read-only.
        </p>
      </div>

      {!result.available ? (
        <SectionCard>
          <div className="p-4">
            <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {result.message}
            </p>
          </div>
        </SectionCard>
      ) : (
        <>
          <ListControls
            searchPlaceholder="Search creator name/username or full content ID…"
            filters={[
              { key: "type", label: "Content type", options: LIFECYCLE_ENTITY_TYPES },
              { key: "status", label: "Lifecycle status", options: LIFECYCLE_STATUS_OPTIONS },
            ]}
          />

          <SectionCard className="overflow-hidden">
            {result.data.rows.length === 0 ? (
              <EmptyState
                icon="🧭"
                title="No lifecycle records found"
                message="Try a different creator, full content ID, content type or lifecycle status."
              />
            ) : (
              <>
                <Table
                  head={
                    <>
                      <Th>Content</Th>
                      <Th>Lifecycle</Th>
                      <Th>Creator</Th>
                      <Th>Removed</Th>
                      <Th>Restored</Th>
                      <Th>Purge status</Th>
                    </>
                  }
                >
                  {result.data.rows.map((record) => (
                    <RowLink key={record.key} href={`/admin/content-lifecycle/${record.entity_type}/${record.entity_id}`}>
                      <Td>
                        <span className="block text-sm font-medium capitalize text-gray-900">{record.entity_type}</span>
                        <code className="block font-mono text-[11px] text-gray-500">{record.entity_id}</code>
                      </Td>
                      <Td><LifecycleBadge status={record.displayStatus} /></Td>
                      <Td><span className="text-sm text-gray-700">{creatorLabel(record)}</span></Td>
                      <Td className="whitespace-nowrap text-xs text-gray-600">{fmt(record.removed_at)}</Td>
                      <Td className="whitespace-nowrap text-xs text-gray-600">{fmt(record.restored_at)}</Td>
                      <Td>
                        <span className={record.purge.eligible ? "text-sm text-teal-700" : "text-sm text-gray-600"}>{record.purge.status}</span>
                        <span className="mt-0.5 block text-xs text-gray-400">{record.purge.eligible ? "Eligible" : "Not eligible"}</span>
                      </Td>
                    </RowLink>
                  ))}
                </Table>
                <Pagination page={result.data.page} pageSize={result.data.pageSize} total={result.data.total} />
              </>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
