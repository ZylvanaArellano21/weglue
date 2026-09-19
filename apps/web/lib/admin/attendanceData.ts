// Same contract as every other admin loader: requireSecureAdmin() FIRST. The
// three RPCs here (migration 143) are SECURITY DEFINER and re-check
// private.current_is_platform_admin() themselves against the CALLER's own
// auth.uid() — so, unlike the service-role admin.rpc() calls elsewhere in
// this folder, these must be invoked through the admin's own per-request
// session client (createClient()), not createAdminClient(). Calling them via
// the service-role client would leave auth.uid() null inside the function and
// they would reject with not_authenticated.
import { createClient } from "../supabase/server";
import { requireSecureAdmin } from "./secureAdmin";

export interface AdminAttendanceRow {
  student_id: string;
  school_email: string;
}

export interface AdminEventAttendanceSummary {
  club_id: string;
  event_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  checkin_applies: boolean;
  window_starts_at: string;
  window_ends_at: string;
  current_count: number;
  total_count: number;
}

export interface AdminClubAttendanceSummary {
  club_id: string;
  checkin_applies: boolean;
  event_count: number;
  current_count: number;
  total_count: number;
}

/** `p_clubId` narrows the summary RPC to one club's events first (cheaper
 * than scanning every club), then this picks out the one event requested. */
export async function getAdminEventAttendanceSummary(
  eventId: string,
  clubId: string,
): Promise<AdminEventAttendanceSummary | null> {
  await requireSecureAdmin();
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_event_attendance_summary", { p_club_id: clubId });
  if (error) throw error;
  const rows = (data ?? []) as AdminEventAttendanceSummary[];
  return rows.find((r) => r.event_id === eventId) ?? null;
}

export async function getAdminClubAttendanceSummary(clubId: string): Promise<AdminClubAttendanceSummary | null> {
  await requireSecureAdmin();
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_club_attendance_summary", { p_club_id: clubId });
  if (error) throw error;
  const rows = (data ?? []) as AdminClubAttendanceSummary[];
  return rows[0] ?? null;
}

export async function getAdminEventAttendanceList(eventId: string): Promise<AdminAttendanceRow[]> {
  await requireSecureAdmin();
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_event_attendance", { p_event_id: eventId });
  if (error) throw error;
  return (data ?? []) as AdminAttendanceRow[];
}
