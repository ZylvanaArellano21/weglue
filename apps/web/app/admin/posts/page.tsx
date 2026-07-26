import Link from "next/link";
import { listPosts, type ListPostsParams } from "../../../lib/admin/contentData";
import { listUniversities } from "../../../lib/admin/data";
import { listClubOptions } from "../../../lib/admin/data2";
import { SectionCard, Badge, IdentityCell, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td, RowLink } from "../../../components/admin/Table";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminPostsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);

  const params: ListPostsParams = {
    search: get("q"),
    universityId: get("university"),
    clubId: get("club"),
    type: (get("type") as ListPostsParams["type"]) ?? "all",
    tag: (get("tag") as ListPostsParams["tag"]) ?? "all",
    reports: (get("reports") as ListPostsParams["reports"]) ?? "all",
    dateFrom: get("dateFrom"),
    dateTo: get("dateTo") ? `${get("dateTo")}T23:59:59.999Z` : undefined,
    dir: (get("dir") as "asc" | "desc") ?? "desc",
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const [result, universities, clubs] = await Promise.all([
    listPosts(params),
    listUniversities(),
    listClubOptions(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Posts</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {result.total.toLocaleString()} post{result.total === 1 ? "" : "s"} across every club and university.
        </p>
      </div>

      <ListControls
        searchPlaceholder="Search post text, author name/username/email, or club…"
        dateFilter
        filters={[
          { key: "university", label: "University", options: universities.map((u) => ({ value: u.id, label: u.name })) },
          { key: "club", label: "Club", options: clubs.map((c) => ({ value: c.id, label: c.name })) },
          {
            key: "type",
            label: "Type",
            options: [
              { value: "picture", label: "Picture" },
              { value: "event", label: "Event" },
            ],
          },
          {
            key: "tag",
            label: "Club tag",
            options: [
              { value: "tagged", label: "Tagged to a club" },
              { value: "untagged", label: "Not tagged" },
            ],
          },
          { key: "reports", label: "Reports", options: [{ value: "reported", label: "Reported only" }] },
        ]}
        sorts={[{ value: "created_at", label: "Created date" }]}
      />

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState icon="🖼️" title="No posts found" message="Try different text, an author, a club, or clear the filters." />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>Post</Th>
                  <Th>Author</Th>
                  <Th>Club</Th>
                  <Th>University</Th>
                  <Th className="text-right">Media</Th>
                  <Th className="text-right">Comments</Th>
                  <Th className="text-right">Likes</Th>
                  <Th className="text-right">Reports</Th>
                  <Th>Created</Th>
                </>
              }
            >
              {result.rows.map((p) => (
                <RowLink key={p.id} href={`/admin/posts/${p.id}`}>
                  <Td>
                    <div className="flex items-center gap-3">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image_url} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 text-sm">
                          {p.post_type === "event" ? "📅" : "🖼️"}
                        </span>
                      )}
                      <div className="min-w-0 max-w-[280px]">
                        <p className="truncate text-sm text-gray-900">
                          {p.caption || <span className="text-gray-400">No caption</span>}
                        </p>
                        <p className="text-xs text-gray-400 capitalize">{p.post_type}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <IdentityCell name={p.author_name || p.author_username} sub={`@${p.author_username}`} />
                  </Td>
                  <Td className="text-gray-600">
                    {p.club_name ? `${p.club_name}` : <Badge tone="gray">Not tagged</Badge>}
                  </Td>
                  <Td className="text-gray-600">{p.university ?? <span className="text-gray-300">—</span>}</Td>
                  <Td className="text-right tabular-nums">{p.media_count}</Td>
                  <Td className="text-right tabular-nums">{p.comment_count}</Td>
                  <Td className="text-right tabular-nums">{p.like_count}</Td>
                  <Td className="text-right tabular-nums">
                    {p.report_count > 0 ? <Badge tone="red">{p.report_count}</Badge> : <span className="text-gray-400">0</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-gray-600">{fmtDate(p.created_at)}</Td>
                </RowLink>
              ))}
            </Table>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} />
          </>
        )}
      </SectionCard>

      <p className="text-xs text-gray-400">
        Reports open the moderation queue filtered to that post. Full report triage ships on Day 5.{" "}
        <Link href="/admin/reports" className="text-teal-600 hover:underline">
          View Reports →
        </Link>
      </p>
    </div>
  );
}
