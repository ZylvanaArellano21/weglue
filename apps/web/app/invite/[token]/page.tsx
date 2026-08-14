import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import { createClient } from "../../../lib/supabase/server";
import { clubHubHref } from "../../../lib/messages/routes";

export const metadata = {
  title: "Join a chat",
  description: "You've been invited to a chat on We Glue.",
};

// ─── Invitation entry point ──────────────────────────────────────────────────
// Three destinies, decided server-side, in this order:
//   1. Invalid/reset token          → the exact invalid-invite page (Feature 2),
//                                      regardless of platform.
//   2. Desktop, valid token          → Feature 3: redeem immediately if already
//                                      authenticated, else straight to Login —
//                                      never a generic landing page.
//   3. iOS/Android, valid token      → Feature 2's temporary "get the app" page.
//      This only renders when the installed app did NOT already intercept the
//      link (Universal Links / App Links) — see Update 1. It never joins
//      anyone; only an authenticated app/web session can (join_chat_invitation).
//
// Real App Store Connect Apple ID, from apps/mobile/eas.json's submit.production.
// ios.ascAppId (6786491344) — this is the same numeric ID EAS Submit uploads
// to, so it's authoritative regardless of whether the iOS listing is public
// yet. If Apple ever reassigns the app's ascAppId, update both places.
const APP_STORE_URL = "https://apps.apple.com/app/we-glue/id6786491344";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.weglue.app";

interface InvitePreview {
  valid: boolean;
  type?: "club_group";
  club_name?: string | null;
  creator_name?: string | null;
  university?: string | null;
}

type VisitorPlatform = "ios" | "android" | "desktop";

function detectPlatform(userAgent: string): VisitorPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "desktop";
}

function InvalidInvitePage(): JSX.Element {
  // Exact required copy. Deliberately nothing else: no store buttons, no
  // login/signup, no auto-redirect, no extra explanation.
  return (
    <main className="min-h-screen bg-[#FEFCF0] flex flex-col items-center justify-center px-6 py-12 text-center">
      <Image src="/logo.png" alt="We Glue" width={64} height={64} priority />
      <h1 className="text-2xl font-bold text-black mt-6 mb-2 max-w-sm">
        This invite link is no longer valid
      </h1>
      <p className="text-sm text-[#5F5D5D]">Ask a club officer for a new one.</p>
    </main>
  );
}

export default async function InvitePage({
  params,
}: {
  params: { token: string };
}): Promise<JSX.Element> {
  const supabase = createClient();
  let preview: InvitePreview = { valid: false };
  try {
    const { data } = await supabase.rpc("preview_chat_invitation", {
      p_token: params.token,
    });
    if (data) preview = data as InvitePreview;
  } catch {
    preview = { valid: false };
  }

  if (!preview.valid) {
    return <InvalidInvitePage />;
  }

  const userAgent = headers().get("user-agent") ?? "";
  const platform = detectPlatform(userAgent);
  const clubLabel = preview.club_name ?? "your club";

  if (platform === "desktop") {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      let joinedConversationId: string | null = null;
      let terminallyInvalid = false;
      try {
        const { data, error } = await supabase.rpc("join_chat_invitation", {
          p_token: params.token,
        });
        if (error) throw error;
        joinedConversationId = (data as { conversation_id: string }).conversation_id;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("invitation_invalid")) terminallyInvalid = true;
        // Any other error (different_university, a transient failure): fall
        // through to Login below rather than trap an authenticated visitor
        // on a dead end.
      }
      if (terminallyInvalid) return <InvalidInvitePage />;
      if (joinedConversationId) redirect(clubHubHref(joinedConversationId));
    }

    // Not authenticated (or redemption didn't complete above) — straight to
    // Login, no landing page in between. The Login page persists this token
    // (localStorage) through Create an Account → verification → back to
    // Login if the visitor isn't an existing user.
    redirect(`/login?invite=${encodeURIComponent(params.token)}`);
  }

  // iOS / Android, app not installed: auto-redirect to the correct store,
  // with the single matching button as the only fallback if that doesn't
  // fire (popup/navigation blocked, slow connection, etc).
  const storeUrl = platform === "ios" ? APP_STORE_URL : PLAY_STORE_URL;
  const storeLabel = platform === "ios" ? "Continue to App Store" : "Continue to Google Play";
  const openingLabel = platform === "ios" ? "Opening the App Store…" : "Opening Google Play…";
  const headline =
    platform === "ios" ? `Download We Glue to find ${clubLabel}` : `Download We Glue to join ${clubLabel}`;

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex flex-col items-center justify-center px-6 py-12 text-center">
      {/* Fires as soon as this streams in — no client bundle to wait on. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `window.location.replace(${JSON.stringify(storeUrl)});`,
        }}
      />
      <Image src="/logo.png" alt="We Glue" width={64} height={64} priority />
      <h1 className="text-2xl font-bold text-black mt-6 mb-2 max-w-sm">{headline}</h1>
      <p className="text-sm text-[#5F5D5D] mb-8">{openingLabel}</p>
      <a
        href={storeUrl}
        className="block w-full max-w-xs h-12 rounded-full bg-[#0FA6A6] text-[#FEFCF0] font-semibold flex items-center justify-center"
      >
        {storeLabel}
      </a>
    </main>
  );
}
