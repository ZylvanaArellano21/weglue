import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import { createClient } from "../../../lib/supabase/server";
import { ClubProfileClient } from "../../../components/clubs/ClubProfileClient";
import {
  storeTargetFromUserAgent,
  storeUrlFor,
} from "../../../lib/deviceRouting";

export const metadata = { title: "Club" };
export const dynamic = "force-dynamic";

// Canonical Club Profile — the SAME implementation opened from every entry point
// (Club-tab sidebar/catalog/search, Home cards, notifications). Middleware
// guarantees only verified, onboarded users reach it; RLS decides what content
// the viewer may see.
//
// The one exception middleware lets through unauthenticated is a scanned club
// QR (`?source=qr`). The installed app intercepts the universal / app link
// before the browser, so a browser that reaches this page has no app — route
// it to the store exactly like /download does. It renders NOTHING about the
// club and reads NO club data, so it cannot leak protected content. A signed-in
// phone-web user falls through to the normal profile below.
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

  // Unauthenticated. Middleware only allows this for `?source=qr`; any other
  // unauthenticated /club/* request was already redirected to /login.
  if (searchParams.source !== "qr") {
    redirect(`/login?next=${encodeURIComponent(`/club/${params.clubId}`)}`);
  }

  const store = storeTargetFromUserAgent(headers().get("user-agent"));
  if (!store) {
    // Desktop / crawler / modern-iPadOS Safari — no app to install; let them
    // sign in and view the club on the web.
    redirect(`/login?next=${encodeURIComponent(`/club/${params.clubId}`)}`);
  }

  const storeUrl = storeUrlFor(store);
  const storeLabel =
    store === "app-store" ? "Continue to App Store" : "Continue to Google Play";

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
        {store === "app-store" ? "Opening the App Store…" : "Opening Google Play…"}
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
