import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { PublicPreviewShell, type PublicEventPreviewRaw } from "../../../components/public/PublicContentPreview";
import type { MoreAtCampusItem } from "../../../components/public/MoreAtCampus";

export const dynamic = "force-dynamic";

/** Canonical permanent event link — same shape as the post version. Events
 *  additionally require `visibility = 'everyone'` inside the RPC itself;
 *  'members'/'specific' events can never reach an anonymous preview here,
 *  with no override. */
export default async function EventLinkPage({
  params,
  searchParams,
}: {
  params: { eventId: string };
  searchParams: { ssid?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const next = `/event/${params.eventId}`;
  if (user) redirect(`/home?event=${encodeURIComponent(params.eventId)}`);

  const sessionId = typeof searchParams.ssid === "string" ? searchParams.ssid : null;

  const { data: eventData } = await supabase.rpc("get_public_preview_event", { p_event_id: params.eventId });
  const event = eventData as unknown as PublicEventPreviewRaw | null;

  if (!event) return <UnavailablePreview next={next} />;

  // Fire-and-forget analytics via the validating RPC — a failed/rejected
  // call must never break the preview.
  void supabase
    .rpc("log_share_funnel_event", {
      p_share_session_id: sessionId,
      p_event_name: "preview_opened",
      p_entity_type: "event",
      p_entity_id: params.eventId,
      p_source: null,
      p_platform: "web",
    })
    .then(() => {}, () => {});

  let more: MoreAtCampusItem[] = [];
  const { data: moreData } = await supabase.rpc("get_public_preview_more", {
    p_hero_type: "event",
    p_hero_id: params.eventId,
    p_limit: 3,
  });
  if (moreData) more = moreData as unknown as MoreAtCampusItem[];

  return (
    <PublicPreviewShell
      data={{ type: "event", ...event }}
      entityId={params.eventId}
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
