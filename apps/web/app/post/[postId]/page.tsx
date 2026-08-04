import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Canonical copied post links resolve through the authenticated Home overlay.
 * The overlay re-queries the post under RLS, so this route never serializes a
 * private or blocked payload into the page before access is rechecked.
 */
export default async function PostDirectLink({ params }: { params: { postId: string } }): Promise<never> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const next = `/post/${params.postId}`;
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  redirect(`/home?post=${encodeURIComponent(params.postId)}`);
}
