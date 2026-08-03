import Link from "next/link";
import { listComments, type ListCommentsParams } from "../../../lib/admin/contentData";
import { listUniversities } from "../../../lib/admin/data";
import { listClubOptions } from "../../../lib/admin/data2";
import { SectionCard, Badge, IdentityCell, EmptyState } from "../../../components/admin/primitives";
import { ListControls } from "../../../components/admin/ListControls";
import { Pagination } from "../../../components/admin/Pagination";
import { Table, Th, Td, RowLink } from "../../../components/admin/Table";
import { LifecycleBadge } from "../../../components/admin/ContentLifecycleActions";
import { getLifecycleRecordsForEntities } from "../../../lib/admin/lifecycleData";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminCommentsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : undefined);
  const postScope = get("post");

  const params: ListCommentsParams = {
    search: get("q"),
    universityId: get("university"),
    clubId: get("club"),
    postId: postScope,
    dateFrom: get("dateFrom"),
    dateTo: get("dateTo") ? `${get("dateTo")}T23:59:59.999Z` : undefined,
    dir: (get("dir") as "asc" | "desc") ?? "desc",
    page: get("page") ? parseInt(get("page")!, 10) : 1,
  };

  const [result, universities, clubs] = await Promise.all([
    listComments(params),
    listUniversities(),
    listClubOptions(),
  ]);
  const lifecycle = await getLifecycleRecordsForEntities("comment", result.rows.map((comment) => comment.id));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Comments</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {result.total.toLocaleString()} comment{result.total === 1 ? "" : "s"} on posts across every club.
        </p>
      </div>

      {postScope ? (
        <div className="flex items-center justify-between rounded-lg border border-teal-100 bg-teal-50/60 px-4 py-2 text-sm text-teal-800">
          <span>Showing comments on one post.</span>
          <Link href={`/admin/posts/${postScope}`} className="font-medium hover:underline">
            View the post →
          </Link>
        </div>
      ) : null}

      <ListControls
        searchPlaceholder="Search comment text, author name/username/email…"
        dateFilter
        filters={[
          { key: "university", label: "University", options: universities.map((u) => ({ value: u.id, label: u.name })) },
          { key: "club", label: "Club", options: clubs.map((c) => ({ value: c.id, label: c.name })) },
        ]}
        sorts={[{ value: "created_at", label: "Created date" }]}
      />

      <SectionCard className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState icon="💬" title="No comments found" message="Try different text, an author, a club, or clear the filters." />
        ) : (
          <>
            <Table
              head={
                <>
                  <Th>Comment</Th>
                  <Th>Lifecycle</Th>
                  <Th>Author</Th>
                  <Th>Parent post</Th>
                  <Th>Club</Th>
                  <Th>University</Th>
                  <Th>Created</Th>
                </>
              }
            >
              {result.rows.map((c) => (
                <RowLink key={c.id} href={`/admin/comments/${c.id}`}>
                  <Td>
                    <p className="max-w-[320px] truncate text-sm text-gray-900">{c.content}</p>
                  </Td>
                  <Td>
                    {lifecycle.available ? (
                      <LifecycleBadge status={lifecycle.records.get(c.id)?.displayStatus ?? "active"} />
                    ) : (
                      <Badge tone="amber">Lifecycle unavailable</Badge>
                    )}
                  </Td>
                  <Td>
                    <IdentityCell name={c.author_name || c.author_username} sub={`@${c.author_username}`} avatarUrl={c.avatar_url} />
                  </Td>
                  <Td className="text-gray-600">
                    {c.post_caption ? (
                      <span className="max-w-[160px] truncate">{c.post_caption}</span>
                    ) : (
                      <span className="text-gray-400">View post</span>
                    )}
                  </Td>
                  <Td className="text-gray-600">{c.club_name ?? <Badge tone="gray">Not tagged</Badge>}</Td>
                  <Td className="text-gray-600">{c.university ?? <span className="text-gray-300">—</span>}</Td>
                  <Td className="whitespace-nowrap text-gray-600">{fmtDate(c.created_at)}</Td>
                </RowLink>
              ))}
            </Table>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} />
          </>
        )}
      </SectionCard>

      <p className="text-xs text-gray-400">
        Comments are not a separate report target in the current schema — they are moderated through their
        parent post. Open a comment to edit it or jump to its post and author.
      </p>
    </div>
  );
}
