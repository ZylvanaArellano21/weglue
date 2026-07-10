import { supabase } from '../lib/supabase';

// One report pipeline for every entity in the app (club, event, post, user,
// message, chat):
//   1. Insert a row into `reports` (source of truth — must succeed).
//   2. Best-effort: ask the send-report-email edge function to notify the
//      support inbox. An email failure never fails the report.
//
// The user-facing success copy lives here so every screen shows the exact
// same confirmation.

export const REPORT_SUCCESS_MESSAGE =
  "Report sent. You'll hear from our team shortly. Thank you.";

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

export async function submitReport(input: SubmitReportInput): Promise<void> {
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

  // Email is best-effort on top of the stored report. Failures are logged
  // and swallowed — the report row already guarantees the team sees it.
  try {
    await supabase.functions.invoke('send-report-email', {
      body: { reportId: report.id },
    });
  } catch (e) {
    console.warn('[reportService] report email failed (report stored)', e);
  }
}
