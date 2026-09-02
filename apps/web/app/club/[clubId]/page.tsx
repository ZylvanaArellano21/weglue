import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import { createClient } from "../../../lib/supabase/server";
import { ClubProfileClient } from "../../../components/clubs/ClubProfileClient";

export const metadata = { title: "Club" };
export const dynamic = "force-dynamic";

// Same store links / referrer shape as apps/web/app/invite/[token]/page.tsx.
const APP_STORE_URL = "https://apps.apple.com/app/we-glue/id6786491344";
function playStoreUrl(clubId: string): string {
  const referrer = encodeURIComponent(`club_id=${clubId}`);
  return `https://play.google.com/store/apps/details?id=com.weglue.app&referrer=${referrer}`;
}

function detectPlatform(userAgent: string): "ios" | "android" | "desktop" {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "desktop";
}

// Canonical Club Profile — the SAME implementation opened from every entry point
// (Club-tab sidebar/catalog/search, Home cards, notifications). Middleware
// guarantees only verified, onboarded users reach it; RLS decides what content
// the viewer may see.
//
// The one exception middleware lets through unauthenticated is a scanned club
// QR (`?source=qr`): the installed app intercepts the link before the browser,
// so a browser that gets here has no app — send it to the store, exactly like
// the invite page. A signed-in phone-web user still gets the profile normally.
export default async function ClubProfilePage({
  params,
  searchParams,
}: {
  params: { clubId: string };
  searchParams: { source?: string };
}): Promise<JSX.Element> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return <ClubProfileClient clubId={params.clubId} userId={user.id} />;
  }

  const fromQr = searchParams.source === "qr";
  if (!fromQr) redirect("/login");

  const platform = detectPlatform(headers().get("user-agent") ?? "");
  if (platform === "desktop") {
    redirect(`/login?next=${encodeURIComponent(`/club/${params.clubId}`)}`);
  }

  const storeUrl = platform === "ios" ? APP_STORE_URL : playStoreUrl(params.clubId);
  const storeLabel =
    platform === "ios" ? "Continue to App Store" : "Continue to Google Play";

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex flex-col items-center justify-center px-6 py-12 text-center">
      {/* Fires as soon as this streams in — no client bundle to wait on. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `window.location.replace(${JSON.stringify(storeUrl)});`,
        }}
      />
      <Image src="/logo.png" alt="We Glue" width={64} height={64} priority />
      <h1 className="text-2xl font-bold text-black mt-6 mb-2 max-w-sm">
        Get We Glue to open this club
      </h1>
      <p className="text-sm text-[#5F5D5D] mb-8">
        {platform === "ios" ? "Opening the App Store…" : "Opening Google Play…"}
      </p>
      <a
        href={storeUrl}
        className="block w-full max-w-xs h-12 rounded-full bg-[#0FA6A6] text-[#FEFCF0] font-semibold flex items-center justify-center"
      >
        {storeLabel}
      </a>
    </main>
  );
}
