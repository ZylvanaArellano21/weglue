import Link from "next/link";
import { listEditHistory, EDIT_ENTITY_TYPES, type ListEditHistoryParams } from "../../../lib/admin/historyData";
import { SectionCard, Badge, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td } from "../../../components/admin/Table";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const TYPE_TONE: Record<string, "teal" | "blue" | "amber" | "gray"> = {
  event: "teal",
  club: "blue",
  profile: "amber",
  message: "gray",
};

export default async function AdminEditHistoryPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);
  const params: ListEditHistoryParams = {
    type: (get("type") as ListEditHistoryParams["type"]) ?? "all",
    search: get("q"),
    dateFrom: get("dateFrom"),
    dateTo: get("dateTo") ? `${get("dateTo")}T23:59:59.999Z` : undefined,
    dir: (get("dir") as "asc" | "desc") ?? "desc",
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const result = await listEditHistory(params);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Edit History</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Entities whose <code>updated_at</code> advanced past creation. The schema records no before/after values.
        </p>
      </div>

      <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4 text-sm text-amber-800">
        <p className="font-medium">Full historical values were not recorded.</p>
        <p className="mt-1 text-amber-700">
          The current schema has no version/before-after tables and does not record who made an edit. This surface
          honestly shows only last-updated metadata — it never fabricates prior values from the current state. Deleted
          messages are excluded (privacy-locked); private deleted-message history stays unavailable until the approved
          privacy backend is deployed.
        </p>
      </div>

      <ListControls
        searchPlaceholder="Search edited entity by name / title / username…"
        dateFilter
        filters={[{ key: "type", label: "Type", options: EDIT_ENTITY_TYPES.map((t) => ({ value: t.value, label: t.label })) }]}
      />

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState icon="📝" title="No recorded edits" message="No entity in this window shows an edit after its creation." />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>Type</Th>
                  <Th>Entity</Th>
                  <Th>Editor</Th>
                  <Th>Changed fields</Th>
                  <Th>Created</Th>
                  <Th>Last edited</Th>
                </>
              }
            >
              {result.rows.map((r) => (
                <tr key={r.key} className="text-gray-700">
                  <Td><Badge tone={TYPE_TONE[r.entity_type] ?? "gray"}>{r.entity_type_label}</Badge></Td>
                  <Td>
                    <div className="min-w-0 max-w-[280px]">
                      {r.detail_href ? (
                        <Link href={r.detail_href} className="truncate text-sm text-gray-900 hover:text-teal-600">{r.identity}</Link>
                      ) : (
                        <span className="truncate text-sm text-gray-900">{r.identity}</span>
                      )}
                    </div>
                  </Td>
                  <Td className="text-gray-400"><span className="text-xs italic">Not recorded</span></Td>
                  <Td className="text-gray-400"><span className="text-xs italic">Not recorded</span></Td>
                  <Td className="whitespace-nowrap text-gray-600"><span className="text-xs">{fmtDateTime(r.created_at)}</span></Td>
                  <Td className="whitespace-nowrap text-gray-900"><span className="text-xs font-medium">{fmtDateTime(r.updated_at)}</span></Td>
                </tr>
              ))}
            </Table>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} />
          </>
        )}
      </SectionCard>

      <p className="text-xs text-gray-400">
        A true field-level edit history (before/after, editor, source) requires the same append-only history/audit
        infrastructure tracked for Audit History. Deferred to the Day-6/final backlog.{" "}
        <Link href="/admin/audit-history" className="text-teal-600 hover:underline">
          Audit History →
        </Link>
      </p>
    </div>
  );
}
