import Link from "next/link";
import {
  listDeletedContent,
  getDeletedContentSummary,
  DELETED_ENTITY_TYPES,
  type ListDeletedContentParams,
} from "../../../lib/admin/deletedContentData";
import { SectionCard, Badge, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td } from "../../../components/admin/Table";
import { RestoreClubButton } from "../../../components/admin/DeletedContentActions";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const TYPE_TONE: Record<string, "teal" | "blue" | "gray"> = {
  club: "teal",
  conversation: "blue",
  message: "gray",
};

export default async function AdminDeletedContentPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);

  const params: ListDeletedContentParams = {
    type: (get("type") as ListDeletedContentParams["type"]) ?? "all",
    restorable: (get("restorable") as ListDeletedContentParams["restorable"]) ?? "all",
    search: get("q"),
    dateFrom: get("dateFrom"),
    dateTo: get("dateTo") ? `${get("dateTo")}T23:59:59.999Z` : undefined,
    dir: (get("dir") as "asc" | "desc") ?? "desc",
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const [result, summary] = await Promise.all([listDeletedContent(params), getDeletedContentSummary()]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Deleted Content</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Safely-detectable deleted, deactivated, and removed entities in the current schema. Deleted-message bodies,
          attachments, and snapshots are never shown.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link href="/admin/deleted-content?type=club" className="rounded-xl border border-gray-200 bg-white p-3 hover:border-teal-300">
          <p className="text-lg font-semibold tabular-nums text-gray-900">{summary.clubs.toLocaleString()}</p>
          <p className="text-xs text-gray-500">Deactivated clubs</p>
        </Link>
        <Link href="/admin/deleted-content?type=conversation" className="rounded-xl border border-gray-200 bg-white p-3 hover:border-teal-300">
          <p className="text-lg font-semibold tabular-nums text-gray-900">{summary.conversations.toLocaleString()}</p>
          <p className="text-xs text-gray-500">Deleted conversations</p>
        </Link>
        <Link href="/admin/deleted-content?type=message" className="rounded-xl border border-gray-200 bg-white p-3 hover:border-teal-300">
          <p className="text-lg font-semibold tabular-nums text-gray-900">{summary.messages.toLocaleString()}</p>
          <p className="text-xs text-gray-500">Deleted messages</p>
        </Link>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-lg font-semibold tabular-nums text-gray-900">{summary.restorable.toLocaleString()}</p>
          <p className="text-xs text-gray-500">Restorable (clubs)</p>
        </div>
      </div>

      <ListControls
        searchPlaceholder="Search by name, handle, or username…"
        dateFilter
        filters={[
          { key: "type", label: "Type", options: DELETED_ENTITY_TYPES.map((t) => ({ value: t.value, label: t.label })) },
          {
            key: "restorable",
            label: "Restore",
            options: [
              { value: "restorable", label: "Restorable" },
              { value: "locked", label: "Locked / privacy" },
            ],
          },
        ]}
      />

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState icon="🗑️" title="Nothing here" message="No deleted, deactivated, or removed entities match these filters." />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>Type</Th>
                  <Th>Identity</Th>
                  <Th>Owner</Th>
                  <Th>Related</Th>
                  <Th>Status</Th>
                  <Th>When</Th>
                  <Th>Deleted by</Th>
                  <Th className="text-right">Reports</Th>
                  <Th className="text-right">Actions</Th>
                </>
              }
            >
              {result.rows.map((r) => (
                <tr key={r.key} className="text-gray-700">
                  <Td><Badge tone={TYPE_TONE[r.entity_type] ?? "gray"}>{r.entity_type_label}</Badge></Td>
                  <Td>
                    <div className="min-w-0 max-w-[220px]">
                      {r.detail_href ? (
                        <Link href={r.detail_href} className="truncate text-sm text-gray-900 hover:text-teal-600">
                          {r.identity}
                        </Link>
                      ) : (
                        <span className="truncate text-sm text-gray-900">{r.identity}</span>
                      )}
                      {r.privacy_locked ? <p className="text-xs text-gray-400">🔒 content withheld</p> : null}
                    </div>
                  </Td>
                  <Td>
                    {r.owner_label ? (
                      r.owner_href ? (
                        <Link href={r.owner_href} className="text-sm text-gray-700 hover:text-teal-600">{r.owner_label}</Link>
                      ) : (
                        <span className="text-sm text-gray-700">{r.owner_label}</span>
                      )
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </Td>
                  <Td>
                    {r.related_label ? (
                      r.related_href ? (
                        <Link href={r.related_href} className="text-sm text-gray-600 hover:text-teal-600">{r.related_label}</Link>
                      ) : (
                        <span className="text-sm text-gray-600">{r.related_label}</span>
                      )
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </Td>
                  <Td className="text-gray-600"><span className="text-xs">{r.status_label}</span></Td>
                  <Td className="whitespace-nowrap text-gray-600">
                    <span className="text-xs">{fmtDate(r.deleted_at)}</span>
                    {!r.timestamp_exact ? <span className="ml-1 text-[10px] text-gray-400">(approx)</span> : null}
                  </Td>
                  <Td className="text-gray-600">{r.deleted_by_username ? `@${r.deleted_by_username}` : <span className="text-gray-300">—</span>}</Td>
                  <Td className="text-right tabular-nums">
                    {r.report_count > 0 ? <Badge tone="red">{r.report_count}</Badge> : <span className="text-gray-400">0</span>}
                  </Td>
                  <Td className="text-right">
                    {r.entity_type === "club" && r.restorable ? (
                      <RestoreClubButton clubId={r.id} name={r.identity} />
                    ) : (
                      <span className="text-xs text-gray-400" title={r.privacy_locked ? "Privacy-locked: never restored or purged" : "No canonical restore operation"}>
                        Restore unavailable
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} />
          </>
        )}
      </SectionCard>

      <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4 text-sm text-amber-800">
        <p className="font-medium">Privacy &amp; lifecycle rules</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-700">
          <li>Deleted messages show safe metadata only — never the original body, attachments, poll content, or any snapshot; they are never restored or purged.</li>
          <li>Deleted conversations have no canonical restore operation, so restore is disabled.</li>
          <li>Deactivated clubs can be reactivated (canonical, reversible). Permanent purge is disabled everywhere — no approved purge lifecycle exists.</li>
          <li>Account deletion is a hard cascade (no soft-deleted user rows to list); posts/comments/events have no soft-delete state.</li>
        </ul>
      </div>
    </div>
  );
}
