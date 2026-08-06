import { supabase } from '../lib/supabase';

// One report pipeline for every entity in the app (club, event, post, user,
// message, chat):
//   1. Insert a row into `reports` (source of truth — must succeed).
//   2. Ask the send-report-email edge function to notify the support inbox.
//      The function is idempotent per report (email_sent_at), so retries and
//      duplicate invocations can never produce duplicate emails.
//
// The result is structured and truthful: callers can distinguish
// "saved + emailed" from "saved but email pending" and never show a false
// success. An email failure never fails the report — the row (with
// email_error recorded server-side) is the retry queue.
//
// The user-facing success copy lives here so every screen shows the exact
// same confirmation.

export const REPORT_SUCCESS_MESSAGE =
  "Report sent. You'll hear from our team shortly. Thank you.";

// Truthful copy for "saved, email delivery pending": the report IS received
// (it's in the reports table the team reviews) — only the courtesy email is
// delayed.
export const REPORT_RECEIVED_MESSAGE =
  "Report received. Our team will review it shortly. Thank you.";

export type ReportEntityType = 'club' | 'event' | 'post' | 'user' | 'message' | 'chat';

export interface SubmitReportInput {
  entityType: ReportEntityType;
  entityId: string;
  /** Display name/title of what is being reported, when available. */
  entityName?: string | null;
  /** Owning club, when the entity belongs to one. */
  clubId?: string | null;
  reason?: string | null;
  details?: string | null;
}

export interface SubmitReportResult {
  /** The report row exists in Supabase. */
  saved: true;
  /** Resend accepted the support email. */
  emailed: boolean;
}

// Rapid repeated taps on the same target must not create duplicate report
// rows: while a submission for an entity is in flight, further calls await
// the same promise instead of inserting again.
const inFlight = new Map<string, Promise<SubmitReportResult>>();

export async function submitReport(input: SubmitReportInput): Promise<SubmitReportResult> {
  const key = `${input.entityType}:${input.entityId}`;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const run = doSubmitReport(input).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, run);
  return run;
}

async function doSubmitReport(input: SubmitReportInput): Promise<SubmitReportResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session;
  if (!session) throw new Error('Not authenticated');

  const userId = session.user.id;

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .maybeSingle();

  const { data: report, error } = await supabase
    .from('reports')
    .insert({
      reporter_id: userId,
      reporter_username: (profile as { username?: string } | null)?.username ?? null,
      reporter_email: session.user.email ?? null,
      entity_type: input.entityType,
      entity_id: input.entityId,
      entity_name: input.entityName ?? null,
      club_id: input.clubId ?? null,
      reason: input.reason ?? null,
      details: input.details ?? null,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error || !report) throw error ?? new Error('Failed to submit report');

  // Email is on top of the stored report. Failures are recorded server-side
  // (reports.email_error) and reported truthfully to the caller.
  try {
    const { data, error: fnError } = await supabase.functions.invoke('send-report-email', {
      body: { reportId: report.id },
    });
    if (fnError) throw fnError;
    const emailed = (data as { sent?: boolean } | null)?.sent === true;
    return { saved: true, emailed };
  } catch {
    // The durable report is canonical; never write a response object (which
    // could include submitted details) to a device log.
    console.warn('[reportService] report email delivery deferred (report stored)');
    return { saved: true, emailed: false };
  }
}
