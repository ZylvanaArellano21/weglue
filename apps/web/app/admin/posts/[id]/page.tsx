import Link from "next/link";
import { notFound } from "next/navigation";
import { getPostDetail } from "../../../../lib/admin/contentData";
import { Avatar } from "../../../../components/shared/Avatar";
import { Badge, Field, SectionCard, EmptyState } from "../../../../components/admin/primitives";
import { DetailTabs } from "../../../../components/admin/DetailTabs";
import { DisabledAction } from "../../../../components/admin/DisabledAction";
import { EditCaptionDialog, RemoveFromClubButton } from "../../../../components/admin/PostActions";

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

const REPORT_TONE: Record<string, "amber" | "blue" | "green" | "gray"> = {
  pending: "amber",
  reviewing: "blue",
  resolved: "green",
  dismissed: "gray",
};

export default async function AdminPostDetailPage({ params }: { params: { id: string } }) {
  const post = await getPostDetail(params.id);
  if (!post) notFound();

  const primaryTag = post.tags.find((t) => t.primary) ?? post.tags[0] ?? null;

  const contentTab = (
    <div className="grid gap-6 md:grid-cols-3">
      <SectionCard title="Content" className="md:col-span-2">
        <div className="space-y-4 p-4">
          {post.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.image_url} alt="" className="max-h-96 w-full rounded-lg object-contain" />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-lg bg-gray-50 text-3xl">
              {post.post_type === "event" ? "📅" : "🖼️"}
            </div>
          )}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Caption</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
              {post.caption || <span className="text-gray-400">No caption</span>}
            </p>
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Details">
        <dl className="grid gap-4 p-4">
          <Field label="Type"><span className="capitalize">{post.post_type}</span></Field>
          <Field label="Media">{post.image_url ? "1 image" : "None"}</Field>
          <Field label="Linked event">
            {post.linked_event_id ? (
              <Link href={`/admin/events/${post.linked_event_id}`} className="text-teal-700 hover:underline">
                View event →
              </Link>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Created">{fmtDateTime(post.created_at)}</Field>
          <Field label="Engagement">
            {post.likeCount} likes · {post.commentCount} comments
          </Field>
        </dl>
      </SectionCard>
    </div>
  );

  const authorTab = (
    <SectionCard title="Author">
      <div className="flex items-center justify-between p-4">
        <Link href={`/admin/users/${post.author_id}`} className="flex items-center gap-3 hover:opacity-80">
          <Avatar uri={post.author_avatar} name={post.author_name} size={44} />
          <div>
            <p className="text-sm font-medium text-gray-900">{post.author_name || post.author_username}</p>
            <p className="text-xs text-gray-500">
              @{post.author_username}
              {post.author_email ? ` · ${post.author_email}` : ""}
            </p>
          </div>
        </Link>
        <Link href={`/admin/users/${post.author_id}`} className="text-sm text-teal-600 hover:underline">
          View user →
        </Link>
      </div>
    </SectionCard>
  );

  const clubTab = (
    <SectionCard title="Tagged clubs">
      {post.tags.length === 0 ? (
        <EmptyState icon="🏛️" title="Not tagged to any club" message="This is a personal post on the author's profile." />
      ) : (
        <ul className="divide-y divide-gray-100">
          {post.tags.map((t) => (
            <li key={t.club_id} className="flex items-center justify-between px-4 py-3">
              <Link href={`/admin/clubs/${t.club_id}`} className="flex items-center gap-2 hover:opacity-80">
                <span className="text-sm font-medium text-gray-900">{t.name}</span>
                <span className="text-xs text-gray-500">@{t.handle}</span>
                {t.primary ? <Badge tone="teal">Primary</Badge> : <Badge tone="gray">Tag</Badge>}
              </Link>
              <Link href={`/admin/clubs/${t.club_id}`} className="text-xs text-teal-600 hover:underline">
                View club →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );

  const mediaTab = (
    <SectionCard title="Media">
      {post.image_url ? (
        <div className="p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.image_url} alt="" className="max-h-[70vh] rounded-lg object-contain" />
          <p className="mt-2 break-all text-xs text-gray-400">{post.image_url}</p>
        </div>
      ) : (
        <EmptyState icon="🖼️" title="No media" message="This post has no attached image." />
      )}
    </SectionCard>
  );

  const commentsTab = (
    <SectionCard
      title={`Comments (${post.commentCount})`}
      action={
        <Link href={`/admin/comments?post=${post.id}`} className="text-xs text-teal-600 hover:underline">
          Open in Comments →
        </Link>
      }
    >
      {post.comments.length === 0 ? (
        <EmptyState icon="💬" title="No comments" />
      ) : (
        <ul className="divide-y divide-gray-100">
          {post.comments.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-4 py-3">
              <Link href={`/admin/users/${c.user_id}`}>
                <Avatar uri={c.avatar_url} name={c.full_name} size={28} />
              </Link>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900">{c.content}</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  <Link href={`/admin/users/${c.user_id}`} className="hover:underline">
                    @{c.username}
                  </Link>{" "}
                  · {fmtDateTime(c.created_at)} ·{" "}
                  <Link href={`/admin/comments/${c.id}`} className="text-teal-600 hover:underline">
                    manage
                  </Link>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );

  const reportsTab = (
    <SectionCard
      title={`Reports (${post.reportCount})`}
      action={
        <Link href={`/admin/reports?type=post&id=${post.id}`} className="text-xs text-teal-600 hover:underline">
          Open in Reports →
        </Link>
      }
    >
      {post.reports.length === 0 ? (
        <EmptyState icon="🚩" title="No reports" message="This post has not been reported." />
      ) : (
        <ul className="divide-y divide-gray-100">
          {post.reports.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <Badge tone={REPORT_TONE[r.status] ?? "gray"}>{r.status}</Badge>
                <span className="text-sm font-medium text-gray-900">{r.reason ?? "Reported"}</span>
                <span className="text-xs text-gray-400">{fmtDateTime(r.created_at)}</span>
              </div>
              {r.details ? <p className="mt-1 text-sm text-gray-600">{r.details}</p> : null}
              {r.reporter_username ? (
                <p className="mt-0.5 text-xs text-gray-400">Reported by @{r.reporter_username}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );

  const historyTab = (
    <SectionCard title="History">
      <div className="p-4 text-sm text-gray-500">
        Posts do not carry a canonical edit/version history in the current schema. A dedicated edit-history
        surface (with the audit trail) is scheduled for Day 5.
      </div>
    </SectionCard>
  );

  const actionsTab = (
    <SectionCard title="Actions">
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <EditCaptionDialog postId={post.id} caption={post.caption} />
          {primaryTag ? (
            <RemoveFromClubButton postId={post.id} clubId={primaryTag.club_id} clubName={primaryTag.name} />
          ) : null}
        </div>
        <p className="text-xs text-gray-400">
          Editing writes to the canonical <code>posts</code> row with a read-back check and an audit event.
          &ldquo;Remove from club&rdquo; untags the post (it is not deleted). All writes require the write
          kill switch to be enabled.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <DisabledAction label="Remove attached media" reason="Storage lifecycle does not safely support in-place media removal yet" />
          <DisabledAction label="Hide globally" reason="No canonical global-hide state exists on posts" />
          <DisabledAction label="Restore to club" reason="No canonical single-step re-tag inverse exists" />
          <DisabledAction label="Permanently delete post" reason="Permanent deletion remains disabled" tone="danger" />
        </div>
      </div>
    </SectionCard>
  );

  return (
    <div className="space-y-5">
      <Link href="/admin/posts" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-600">
        ← Back to Posts
      </Link>

      <div className="flex flex-wrap items-start gap-4 rounded-xl border border-gray-200 bg-white p-5">
        {post.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.image_url} alt="" className="h-16 w-16 rounded-lg object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-gray-100 text-2xl">
            {post.post_type === "event" ? "📅" : "🖼️"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-gray-900">
              {post.caption ? post.caption.slice(0, 80) : "Untitled post"}
            </h1>
            <Badge tone="gray">{post.post_type}</Badge>
            {primaryTag ? <Badge tone="teal">{primaryTag.name}</Badge> : <Badge tone="gray">Not tagged</Badge>}
            {post.reportCount > 0 ? <Badge tone="red">{post.reportCount} reports</Badge> : null}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">
            by{" "}
            <Link href={`/admin/users/${post.author_id}`} className="text-teal-700 hover:underline">
              @{post.author_username}
            </Link>{" "}
            · {fmtDateTime(post.created_at)}
          </p>
        </div>
      </div>

      <DetailTabs
        tabs={[
          { key: "content", label: "Content", content: contentTab },
          { key: "author", label: "Author", content: authorTab },
          { key: "club", label: "Club", count: post.tags.length, content: clubTab },
          { key: "media", label: "Media", count: post.image_url ? 1 : 0, content: mediaTab },
          { key: "comments", label: "Comments", count: post.commentCount, content: commentsTab },
          { key: "reports", label: "Reports", count: post.reportCount, content: reportsTab },
          { key: "history", label: "History", content: historyTab },
          { key: "actions", label: "Actions", content: actionsTab },
        ]}
      />
    </div>
  );
}
