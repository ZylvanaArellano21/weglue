import Link from "next/link";
import { notFound } from "next/navigation";
import { getCommentDetail } from "../../../../lib/admin/contentData";
import { Avatar } from "../../../../components/shared/Avatar";
import { Badge, Field, SectionCard } from "../../../../components/admin/primitives";
import { EditCommentDialog } from "../../../../components/admin/CommentActions";
import { LifecycleDetails } from "../../../../components/admin/LifecycleDetails";
import { LifecycleBadge } from "../../../../components/admin/ContentLifecycleActions";
import { getContentLifecycleDetail } from "../../../../lib/admin/lifecycleData";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function AdminCommentDetailPage({ params }: { params: { id: string } }) {
  const comment = await getCommentDetail(params.id);
  if (!comment) notFound();
  const lifecycle = await getContentLifecycleDetail("comment", comment.id);
  const canonicalMutable = lifecycle.available && lifecycle.record?.state === "active";

  return (
    <div className="space-y-5">
      <Link href="/admin/comments" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-600">
        ← Back to Comments
      </Link>

      <div className="grid gap-6 md:grid-cols-3">
        <SectionCard title="Comment" className="md:col-span-2">
          <div className="space-y-4 p-4">
            {lifecycle.available && lifecycle.record ? <LifecycleBadge status={lifecycle.record.displayStatus} /> : <Badge tone="amber">Lifecycle unavailable</Badge>}
            <p className="whitespace-pre-wrap text-sm text-gray-900">{comment.content}</p>
            {comment.parent_comment_id ? (
              <div className="rounded-lg border border-teal-100 bg-teal-50/50 px-3 py-2 text-sm text-teal-900">
                <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Reply to</p>
                <Link href={`/admin/comments/${comment.parent_comment_id}`} className="font-medium hover:underline">
                  {comment.parent_author_name || "another comment"}
                </Link>
                {comment.parent_content ? (
                  <p className="mt-1 truncate text-xs text-teal-800">“{comment.parent_content}”</p>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-center gap-3 border-t border-gray-100 pt-3">
              <Link href={`/admin/users/${comment.user_id}`}>
                <Avatar uri={comment.avatar_url} name={comment.author_name} size={36} />
              </Link>
              <div className="min-w-0">
                <Link href={`/admin/users/${comment.user_id}`} className="text-sm font-medium text-gray-900 hover:underline">
                  {comment.author_name || comment.author_username}
                </Link>
                <p className="text-xs text-gray-500">
                  @{comment.author_username}
                  {comment.author_email ? ` · ${comment.author_email}` : ""}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>

        <div className="space-y-6">
          <SectionCard title="Context">
            <dl className="grid gap-4 p-4">
              <Field label="Parent post">
                <Link href={`/admin/posts/${comment.post_id}`} className="text-teal-700 hover:underline">
                  {comment.post_caption || "View post"} →
                </Link>
              </Field>
              <Field label="Club">
                {comment.club_id && comment.club_name ? (
                  <Link href={`/admin/clubs/${comment.club_id}`} className="text-teal-700 hover:underline">
                    {comment.club_name}
                  </Link>
                ) : (
                  <Badge tone="gray">Not tagged</Badge>
                )}
              </Field>
              <Field label="University">{comment.university}</Field>
              <Field label="Created">{fmtDateTime(comment.created_at)}</Field>
            </dl>
          </SectionCard>

          <SectionCard title="Actions">
            <div className="space-y-3 p-4">
              {canonicalMutable ? (
                <>
                  <EditCommentDialog commentId={comment.id} content={comment.content} />
                  <p className="text-xs text-gray-400">
                    Editing writes to the canonical <code>post_comments</code> row with a read-back check and audit
                    event. Lifecycle removal and restoration are below and require recent MFA.
                  </p>
                </>
              ) : (
                <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  Canonical editing is unavailable while lifecycle state is not active. Review or restore it below.
                </p>
              )}
            </div>
          </SectionCard>
        </div>
        <div className="md:col-span-3"><LifecycleDetails result={lifecycle} /></div>
      </div>
    </div>
  );
}
