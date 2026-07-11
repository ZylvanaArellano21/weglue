import Image from "next/image";
import { createClient } from "../../../lib/supabase/server";

export const metadata = {
  title: "Join a chat",
  description: "You've been invited to a chat on We Glue.",
};

// ─── Public invitation fallback page ─────────────────────────────────────────
// Opened when someone taps a We Glue invite link without the app installed (or
// on desktop). It shows a safe preview and routes them to install / open the
// app. The deep link `weglue://invite/<token>` preserves the destination so the
// app resumes the exact join after install + onboarding.
//
// This page NEVER joins anyone — joining requires an authenticated app session
// (join_chat_invitation, server-authorized). It only previews + hands off.

const APP_STORE_URL = "https://apps.apple.com/app/we-glue/id0000000000";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.weglue.app";

interface InvitePreview {
  valid: boolean;
  type?: "club_group" | "group";
  club_name?: string | null;
  club_avatar?: string | null;
  group_name?: string | null;
  creator_name?: string | null;
  university?: string | null;
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

  const deepLink = `weglue://invite/${params.token}`;
  const label =
    preview.type === "club_group"
      ? `${preview.club_name ?? "a club"} · Members`
      : preview.group_name || "a group chat";

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex flex-col items-center justify-center px-6 py-12">
      <div className="flex items-center gap-2 mb-10">
        <Image src="/logo.png" alt="We Glue" width={32} height={32} />
        <span
          className="font-bold text-lg text-black"
          style={{ fontFamily: "var(--font-zain)" }}
        >
          We Glue
        </span>
      </div>

      {!preview.valid ? (
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-bold text-black mb-3">
            This invite isn&apos;t available
          </h1>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            The link may have been reset by an admin. Ask them for a new invite
            link or QR code.
          </p>
        </div>
      ) : (
        <div className="text-center max-w-sm">
          {preview.club_avatar ? (
            <Image
              src={preview.club_avatar}
              alt=""
              width={80}
              height={80}
              className="rounded-full mx-auto mb-5 object-cover"
            />
          ) : null}
          <h1 className="text-2xl font-bold text-black mb-2">
            You&apos;re invited to {label}
          </h1>
          <p className="text-sm text-[#5F5D5D] leading-relaxed mb-8">
            {preview.creator_name ? `${preview.creator_name} invited you. ` : ""}
            Open We Glue to join. The invite waits for you — it doesn&apos;t
            expire, so you can finish creating your account first.
          </p>

          <a
            href={deepLink}
            className="block w-full h-12 rounded-full bg-[#0FA6A6] text-[#FEFCF0] font-semibold flex items-center justify-center mb-3"
          >
            Open We Glue
          </a>

          <div className="flex gap-3 justify-center mt-6">
            <a
              href={APP_STORE_URL}
              className="text-sm font-semibold text-[#0FA6A6] underline"
            >
              App Store
            </a>
            <span className="text-[#5F5D5D]">·</span>
            <a
              href={PLAY_STORE_URL}
              className="text-sm font-semibold text-[#0FA6A6] underline"
            >
              Google Play
            </a>
          </div>

          {preview.university ? (
            <p className="text-xs text-[#5F5D5D] mt-8">
              Only {preview.university} students can join this chat.
            </p>
          ) : null}
        </div>
      )}
    </main>
  );
}
