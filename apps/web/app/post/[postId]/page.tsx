import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { PublicPreviewShell, type PublicPostPreviewRaw } from "../../../components/public/PublicContentPreview";
import type { MoreAtCampusItem } from "../../../components/public/MoreAtCampus";

export const dynamic = "force-dynamic";

/**
 * Canonical permanent post link. Authenticated visitors keep the existing
 * behavior exactly (re-query under normal RLS via the Home overlay — never
 * serializes a private payload here). A logged-out visitor gets the public
 * preview ONLY if the post's authorized owner has explicitly enabled
 * external sharing (migration 143) — knowing this URL is never enough by
 * itself. Ineligible, disabled, and deleted content all render the same
 * clean "unavailable" state; nothing here can be used to tell them apart.
 */
export default async function PostDirectLink({
  params,
  searchParams,
}: {
  params: { postId: string };
  searchParams: { ssid?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const next = `/post/${params.postId}`;
  if (user) redirect(`/home?post=${encodeURIComponent(params.postId)}`);

  // ssid (share_session_id) is a plain query param — it never affects which
  // content this resolves to, only which funnel journey a later click
  // correlates back to. Absent (direct/unattributed visit) is handled safely
  // by log_share_funnel_event accepting a null session id.
  const sessionId = typeof searchParams.ssid === "string" ? searchParams.ssid : null;

  // Cast the awaited value, not the query builder: types.ts hasn't been
  // regenerated for these RPCs yet (no schema change, so nothing to
  // regenerate from), and the untyped `Json` fallback trips the builder's
  // own array-vs-object generic guard.
  const { data: postData } = await supabase.rpc("get_public_preview_post", { p_post_id: params.postId });
  const post = postData as unknown as PublicPostPreviewRaw | null;

  if (!post) return <UnavailablePreview next={next} />;

  // Fire-and-forget analytics via the validating RPC — a failed/rejected
  // call must never break the preview.
  void supabase
    .rpc("log_share_funnel_event", {
      p_share_session_id: sessionId,
      p_event_name: "preview_opened",
      p_entity_type: "post",
      p_entity_id: params.postId,
      p_source: null,
      p_platform: "web",
    })
    .then(() => {}, () => {});

  let more: MoreAtCampusItem[] = [];
  const { data: moreData } = await supabase.rpc("get_public_preview_more", {
    p_hero_type: "post",
    p_hero_id: params.postId,
    p_limit: 3,
  });
  if (moreData) more = moreData as unknown as MoreAtCampusItem[];

  return (
    <PublicPreviewShell
      data={{ type: "post", ...post }}
      entityId={params.postId}
      more={more}
      loginNext={next}
      sessionId={sessionId}
    />
  );
}

function UnavailablePreview({ next }: { next: string }): JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-lg font-semibold text-gray-900">This content isn&rsquo;t available.</p>
      <p className="mt-2 text-sm text-gray-500">It may have been removed, or its owner hasn&rsquo;t shared it publicly.</p>
      <a href={`/login?next=${encodeURIComponent(next)}`} className="mt-6 rounded-full px-5 py-2.5 text-sm font-semibold text-white" style={{ background: "#0FA6A6" }}>
        Open in We Glue
      </a>
    </main>
  );
}
