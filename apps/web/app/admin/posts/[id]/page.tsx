import Link from "next/link";
import { notFound } from "next/navigation";
import { getPostDetail } from "../../../../lib/admin/contentData";
import { Avatar } from "../../../../components/shared/Avatar";
import { Badge, Field, SectionCard, EmptyState } from "../../../../components/admin/primitives";
import { DetailTabs } from "../../../../components/admin/DetailTabs";
import { EditCaptionDialog, RemoveFromClubButton } from "../../../../components/admin/PostActions";
import { DisablePostExternalShareButton } from "../../../../components/admin/ExternalShareActions";
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

const REPORT_TONE: Record<string, "amber" | "blue" | "green" | "gray"> = {
  pending: "amber",
  reviewing: "blue",
  resolved: "green",
  dismissed: "gray",
};

export default async function AdminPostDetailPage({ params }: { params: { id: string } }) {
  const post = await getPostDetail(params.id);
  if (!post) notFound();
  const lifecycle = await getContentLifecycleDetail("post", post.id);
  const canonicalMutable = lifecycle.available && lifecycle.record?.state === "active";

  const primaryTag = post.tags.find((t) => t.primary) ?? post.tags[0] ?? null;
  const primaryImage = post.images[0]?.path ?? post.image_url;

  const contentTab = (
    <div className="grid gap-6 md:grid-cols-3">
      <SectionCard title="Content" className="md:col-span-2">
        <div className="space-y-4 p-4">
          {post.images.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {post.images.map((image) => (
                <figure key={image.position} className="overflow-hidden rounded-lg border border-gray-100 bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.path} alt="" className="max-h-96 w-full object-contain" />
                  <figcaption className="px-2 py-1 text-xs text-gray-400">Image {image.position + 1}</figcaption>
                </figure>
              ))}
            </div>
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
          <Field label="Author kind">
            {post.author_kind === "club" ? <Badge tone="teal">Club-authored</Badge> : <Badge tone="gray">User-authored</Badge>}
          </Field>
          <Field label="Media">{post.images.length ? `${post.images.length} image${post.images.length === 1 ? "" : "s"}` : "None"}</Field>
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
      {post.author_kind === "club" ? (
        <div className="space-y-4 p-4">
          <Link href={`/admin/clubs/${post.club_id}`} className="flex items-center gap-3 hover:opacity-80">
            <Avatar uri={post.club_avatar} name={post.club_name ?? "Club"} size={44} />
            <div>
              <p className="text-sm font-medium text-gray-900">{post.club_name || "Unknown club"}</p>
              <p className="text-xs text-gray-500">{post.club_handle ? `@${post.club_handle}` : "Club identity"}</p>
            </div>
          </Link>
          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Officer / audit identity</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <Link href={`/admin/users/${post.author_id}`} className="flex items-center gap-3 hover:opacity-80">
                <Avatar uri={post.author_avatar} name={post.author_name} size={36} />
                <div>
                  <p className="text-sm font-medium text-gray-900">{post.author_name || post.author_username}</p>
                  <p className="text-xs text-gray-500">
                    @{post.author_username}
                    {post.author_email ? ` · ${post.author_email}` : ""}
                  </p>
                </div>
              </Link>
              <Link href={`/admin/users/${post.author_id}`} className="text-sm text-teal-600 hover:underline">
                View officer →
              </Link>
            </div>
          </div>
        </div>
      ) : (
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
      )}
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
      {post.images.length > 0 ? (
        <div className="space-y-4 p-4">
          {post.images.map((image) => (
            <div key={image.position} className="rounded-lg border border-gray-100 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.path} alt="" className="max-h-[70vh] w-full rounded-lg object-contain" />
              <p className="mt-2 text-xs text-gray-500">Image {image.position + 1}</p>
              <p className="text-xs text-gray-400">
                {image.width && image.height ? `${image.width} × ${image.height}` : "Dimensions unavailable"}
              </p>
            </div>
          ))}
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

  const externalSharing = (
    <SectionCard title="External sharing">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <Badge tone={post.externalShare.enabled ? "green" : "gray"}>
          {post.externalShare.enabled ? "Enabled" : "Disabled"}
        </Badge>
        {post.externalShare.enabled_by_name && post.externalShare.enabled_at ? (
          <span className="text-sm text-gray-600">
            Enabled by {post.externalShare.enabled_by_name} on {fmtDateTime(post.externalShare.enabled_at)}.
          </span>
        ) : (
          <span className="text-sm text-gray-500">This post has not been enabled for external sharing.</span>
        )}
        {post.externalShare.enabled ? (
          <DisablePostExternalShareButton postId={post.id} />
        ) : null}
      </div>
    </SectionCard>
  );

  const actionsTab = (
    <div className="space-y-5">
      {externalSharing}
      <SectionCard title="Actions">
        <div className="space-y-4 p-4">
          {canonicalMutable ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <EditCaptionDialog postId={post.id} caption={post.caption} />
                {primaryTag ? (
                  <RemoveFromClubButton postId={post.id} clubId={primaryTag.club_id} clubName={primaryTag.name} />
                ) : null}
              </div>
              <p className="text-xs text-gray-400">
                Editing writes to the canonical <code>posts</code> row with a read-back check and audit event.
                Lifecycle removal and restoration are in the Lifecycle tab and require recent MFA.
              </p>
            </>
          ) : (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
              Canonical editing is unavailable while lifecycle state is not active. Use the Lifecycle tab to review or
              restore eligible content.
            </p>
          )}
        </div>
      </SectionCard>
    </div>
  );

  return (
    <div className="space-y-5">
      <Link href="/admin/posts" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-600">
        ← Back to Posts
      </Link>

      <div className="flex flex-wrap items-start gap-4 rounded-xl border border-gray-200 bg-white p-5">
        {primaryImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={primaryImage} alt="" className="h-16 w-16 rounded-lg object-cover" />
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
            <Badge tone={post.author_kind === "club" ? "teal" : "gray"}>
              {post.author_kind === "club" ? "Club-authored" : "User-authored"}
            </Badge>
            {lifecycle.available && lifecycle.record ? (
              <LifecycleBadge status={lifecycle.record.displayStatus} />
            ) : (
              <Badge tone="amber">Lifecycle unavailable</Badge>
            )}
            {post.author_kind === "club" && post.club_name ? <Badge tone="teal">{post.club_name}</Badge> : primaryTag ? <Badge tone="teal">{primaryTag.name}</Badge> : <Badge tone="gray">Not tagged</Badge>}
            {post.reportCount > 0 ? <Badge tone="red">{post.reportCount} reports</Badge> : null}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">
            {post.author_kind === "club" ? (
              <>
                published by <span className="font-medium text-gray-700">{post.club_name || "club"}</span> · Officer / audit{" "}
                <Link href={`/admin/users/${post.author_id}`} className="text-teal-700 hover:underline">
                  @{post.author_username}
                </Link>{" "}
              </>
            ) : (
              <>by{" "}<Link href={`/admin/users/${post.author_id}`} className="text-teal-700 hover:underline">@{post.author_username}</Link>{" "}</>
            )}
            · {fmtDateTime(post.created_at)}
          </p>
        </div>
      </div>

      <DetailTabs
        tabs={[
          { key: "content", label: "Content", content: contentTab },
          { key: "author", label: "Author", content: authorTab },
          { key: "club", label: "Club", count: post.tags.length, content: clubTab },
          { key: "media", label: "Media", count: post.images.length, content: mediaTab },
          { key: "comments", label: "Comments", count: post.commentCount, content: commentsTab },
          { key: "reports", label: "Reports", count: post.reportCount, content: reportsTab },
          { key: "history", label: "History", content: historyTab },
          { key: "lifecycle", label: "Lifecycle", content: <LifecycleDetails result={lifecycle} /> },
          { key: "actions", label: "Actions", content: actionsTab },
        ]}
      />
    </div>
  );
}
