"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "../../../../lib/supabase-browser";
import { setPendingCheckin } from "../../../../lib/pendingCheckin";
import { ToastProvider, useToast } from "../../../../components/shared/Toast";

// ─── Check-in form (web) ─────────────────────────────────────────────────────
// Reached directly (a resolved single-active-event link, the multi-event
// picker, or a one-event club QR) or via the pendingCheckin resume in
// login/page.tsx after a signed-out visit completes auth. Collects ONLY
// Student ID + school email — never anything the event card/Going button
// already covers. Editable while the window stays open; read-only after.

interface EventSummary {
  title: string;
  club_name: string;
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

export default function CheckinFormPage({ params }: { params: { clubId: string; eventId: string } }): JSX.Element {
  return (
    <ToastProvider>
      <CheckinFormBody clubId={params.clubId} eventId={params.eventId} />
    </ToastProvider>
  );
}

function CheckinFormBody({ clubId, eventId }: { clubId: string; eventId: string }): JSX.Element {
  const router = useRouter();
  const show = useToast();
  const userId = useAuthUserId();

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [windowOpen, setWindowOpen] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);

  const [studentId, setStudentId] = useState("");
  const [schoolEmail, setSchoolEmail] = useState("");
  const [saveForFuture, setSaveForFuture] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ studentId?: string; schoolEmail?: string }>({});

  useEffect(() => {
    if (userId === undefined) return;
    if (userId === null) {
      setPendingCheckin({ clubId, eventId });
      router.replace(`/login?next=${encodeURIComponent(`/checkin/${clubId}/${eventId}`)}`);
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseBrowser();
      const [{ data: eventRow, error: eventError }, { data: activeRows }, { data: myRecord }] = await Promise.all([
        supabase.from("events").select("title, clubs!inner(name)").eq("id", eventId).maybeSingle(),
        supabase.rpc("resolve_club_active_checkins", { p_club_id: clubId }),
        supabase.from("event_attendance").select("student_id, school_email").eq("event_id", eventId).eq("user_id", userId).maybeSingle(),
      ]);
      if (cancelled) return;
      if (eventError || !eventRow) {
        setPhase("error");
        return;
      }
      setEvent({ title: (eventRow as any).title, club_name: (eventRow as any).clubs.name });

      const isActive = ((activeRows ?? []) as { event_id: string }[]).some((r) => r.event_id === eventId);
      setWindowOpen(isActive);

      if (myRecord) {
        setStudentId((myRecord as any).student_id ?? "");
        setSchoolEmail((myRecord as any).school_email ?? "");
        setAlreadySubmitted(true);
      } else {
        // The RPC derives the caller's own campus server-side; the client
        // never supplies or guesses it.
        const { data: saved } = await supabase.rpc("get_saved_attendance_info");
        const savedRow = Array.isArray(saved) ? saved[0] : saved;
        if (!cancelled && savedRow) {
          setStudentId(savedRow.student_id ?? "");
          setSchoolEmail(savedRow.school_email ?? "");
        }
      }
      setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, clubId, eventId, router]);

  function validate(): boolean {
    const errors: { studentId?: string; schoolEmail?: string } = {};
    if (!studentId.trim()) errors.studentId = "Student ID is required.";
    const email = schoolEmail.trim();
    if (!email) errors.schoolEmail = "School email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.schoolEmail = "Enter a valid email address.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !validate()) return;
    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.rpc("submit_event_checkin", {
        p_event_id: eventId,
        p_student_id: studentId.trim(),
        p_school_email: schoolEmail.trim().toLowerCase(),
        p_save_for_future: saveForFuture,
      });
      if (error) {
        if (error.message?.includes("checkin_window_closed")) {
          show("Check-in has closed for this event.", "error");
          setWindowOpen(false);
        } else if (error.message?.includes("campus_mismatch")) {
          show("This event is not available for check-in on your campus.", "error");
        } else {
          show("Could not check in. Try again.", "error");
        }
        return;
      }
      setAlreadySubmitted(true);
      show(alreadySubmitted ? "Check-in updated!" : "You're checked in! 🎉");
    } catch {
      show("Could not check in. Try again.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (userId === undefined || userId === null || phase === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-cream" />;
  }

  if (phase === "error" || !event) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-cream p-6 text-center">
        <p className="text-[15px] text-gray-500">This event is no longer available.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-md px-5 py-8">
        <h1 className="text-2xl font-extrabold text-gray-900 font-zain">{event.title}</h1>
        <p className="mt-1 text-sm text-gray-500">{event.club_name}</p>

        {!windowOpen ? (
          <div className="mt-6 rounded-2xl bg-white p-5 shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
            <p className="text-base font-bold text-gray-900">{alreadySubmitted ? "You're checked in" : "Check-in is closed"}</p>
            <p className="mt-1.5 text-sm text-gray-500">
              {alreadySubmitted
                ? "Your check-in window for this event has closed, so it can no longer be edited."
                : "This event is not currently accepting check-ins."}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-900">Student ID</label>
              <input
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                placeholder="e.g. 123456789"
                className={`w-full rounded-xl border bg-white px-3.5 py-3 text-[15px] text-gray-900 outline-none focus:border-teal ${fieldErrors.studentId ? "border-red-500" : "border-transparent"}`}
              />
              {fieldErrors.studentId && <p className="mt-1 text-xs text-red-500">{fieldErrors.studentId}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-900">School email</label>
              <input
                type="email"
                value={schoolEmail}
                onChange={(e) => setSchoolEmail(e.target.value)}
                placeholder="you@university.edu"
                className={`w-full rounded-xl border bg-white px-3.5 py-3 text-[15px] text-gray-900 outline-none focus:border-teal ${fieldErrors.schoolEmail ? "border-red-500" : "border-transparent"}`}
              />
              {fieldErrors.schoolEmail && <p className="mt-1 text-xs text-red-500">{fieldErrors.schoolEmail}</p>}
            </div>
            <label className="flex items-center justify-between gap-3 text-sm text-gray-900">
              <span className="flex-1">Save this information for future check-ins on this campus</span>
              <input
                type="checkbox"
                checked={saveForFuture}
                onChange={(e) => setSaveForFuture(e.target.checked)}
                className="h-5 w-5 accent-teal"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="mt-2 rounded-full bg-teal py-3.5 text-[16px] font-bold text-white disabled:opacity-60"
            >
              {submitting ? "Submitting…" : alreadySubmitted ? "Update check-in" : "Check in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
