"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "../../../lib/supabase-browser";
import { setPendingCheckin } from "../../../lib/pendingCheckin";

// ─── Scanned-QR landing (club-level, before an event is known) ─────────────
// Resolves the club's currently active check-in window(s) server-side
// (resolve_club_active_checkins — the single source of truth for the
// 15-min-before/after rule, no timezone math client-side):
//   0 active  → "no check-in right now" + View [Club] (the exact club profile)
//   1 active  → straight to that event's check-in screen
//   2+ active → let the student pick which event
// Auth is checked here client-side (not the usual server redirect) so a
// signed-out visit can persist pendingCheckin before bouncing to /login.

interface ActiveCheckin {
  event_id: string;
  title: string;
}

/** undefined = still resolving, null = signed out, string = signed in. */
function useAuthUserId(): string | null | undefined {
  const [id, setId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => setId(data.session?.user.id ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => setId(session?.user.id ?? null),
    );
    return () => subscription.unsubscribe();
  }, []);
  return id;
}

export default function CheckinResolverPage({ params }: { params: { clubId: string } }): JSX.Element {
  const { clubId } = params;
  const router = useRouter();
  const userId = useAuthUserId();
  const [state, setState] = useState<"loading" | "none" | "many" | "error">("loading");
  const [events, setEvents] = useState<ActiveCheckin[]>([]);

  useEffect(() => {
    if (userId === undefined) return;
    if (userId === null) {
      setPendingCheckin({ clubId });
      router.replace(`/login?next=${encodeURIComponent(`/checkin/${clubId}`)}`);
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseBrowser();
      const { data, error } = await supabase.rpc("resolve_club_active_checkins", { p_club_id: clubId });
      if (cancelled) return;
      if (error) {
        setState("error");
        return;
      }
      const active = (data ?? []) as ActiveCheckin[];
      if (active.length === 0) {
        setState("none");
      } else if (active.length === 1) {
        // length check above guarantees this element exists.
        router.replace(`/checkin/${clubId}/${active[0]!.event_id}`);
      } else {
        setEvents(active);
        setState("many");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, clubId, router]);

  if (userId === undefined || userId === null || state === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-cream" />;
  }

  if (state === "none" || state === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-cream p-6 text-center">
        <h1 className="text-lg font-bold text-gray-900 font-zain">
          {state === "error" ? "Couldn't check for active events" : "No check-in is open right now"}
        </h1>
        <p className="text-sm text-gray-500">
          {state === "error" ? "Please try opening the link again." : "Check-in opens 15 minutes before an event starts."}
        </p>
        <button
          type="button"
          onClick={() => router.push(`/club/${clubId}`)}
          className="mt-3 rounded-full bg-teal px-6 py-2.5 text-[15px] font-semibold text-white"
        >
          View Club
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-md px-5 py-8">
        <h1 className="text-xl font-bold text-gray-900 font-zain">Which event are you checking into?</h1>
        <p className="mt-1 text-sm text-gray-500">More than one event is open right now.</p>
        <div className="mt-5 flex flex-col gap-2.5">
          {events.map((e) => (
            <button
              key={e.event_id}
              type="button"
              onClick={() => router.replace(`/checkin/${clubId}/${e.event_id}`)}
              className="flex items-center justify-between rounded-2xl bg-white px-4 py-4 text-left shadow-[0_1px_6px_rgba(0,0,0,0.05)]"
            >
              <span className="text-[15px] font-semibold text-gray-900">{e.title}</span>
              <span className="text-gray-400">›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
