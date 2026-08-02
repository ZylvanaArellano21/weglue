import Link from "next/link";
import { notFound } from "next/navigation";
import { getCommentDetail } from "../../../../lib/admin/contentData";
import { ContentLifecycleActions, LifecycleBadge } from "../../../../components/admin/ContentLifecycleActions";
import { getLifecycleSummary } from "../../../../lib/admin/lifecycleData";
import { Avatar } from "../../../../components/shared/Avatar";
import { Badge, Field, SectionCard } from "../../../../components/admin/primitives";
import { DisabledAction } from "../../../../components/admin/DisabledAction";
import { EditCommentDialog } from "../../../../components/admin/CommentActions";

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

  const lifecycle = await getLifecycleSummary("comment", comment.id);

  return (
    <div className="space-y-5">
      <Link href="/admin/comments" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-600">
        ← Back to Comments
      </Link>

      <div className="grid gap-6 md:grid-cols-3">
        <SectionCard title="Comment" className="md:col-span-2">
          <div className="space-y-4 p-4">
            <p className="whitespace-pre-wrap text-sm text-gray-900">{comment.content}</p>
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
              <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Visibility</span>
                  <LifecycleBadge state={lifecycle.state} />
                </div>
                <ContentLifecycleActions
                  entity="comment"
                  entityId={comment.id}
                  state={lifecycle.state}
                  summary={`Comment ${comment.id.slice(0, 8)} — ${comment.author_name ?? "unknown author"}`}
                />
              </div>
              <EditCommentDialog commentId={comment.id} content={comment.content} />
              <p className="text-xs text-gray-400">
                Editing writes to the canonical <code>post_comments</code> row with a read-back check and an
                audit event. Requires the write kill switch to be enabled.
              </p>
              <div className="grid gap-3">
                <DisabledAction label="Hide / archive comment" reason="No canonical hidden state exists on comments" />
                <DisabledAction label="Delete comment" reason="No approved comment-deletion lifecycle yet" tone="danger" />
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
