"use client";

import { useMutation } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";

// Web port of apps/mobile/services/reportService.submitReport — the canonical
// report path. Inserts into the SAME `reports` table the team reviews, then
// best-effort invokes the send-report-email function. Rapid repeat taps on the
// same target dedupe while a submission is in flight.

export const REPORT_RECEIVED_MESSAGE = "Report received. Our team will review it shortly. Thank you.";

export type ReportEntityType = "club" | "event" | "post" | "user" | "message" | "chat";

export interface SubmitReportInput {
  entityType: ReportEntityType;
  entityId: string;
  entityName?: string | null;
  clubId?: string | null;
  reason?: string | null;
  details?: string | null;
}

const inFlight = new Map<string, Promise<{ saved: true; emailed: boolean }>>();

async function doSubmitReport(input: SubmitReportInput) {
  const supabase = getSupabaseBrowser();
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session;
  if (!session) throw new Error("Not authenticated");

  const { data: profile } = await supabase.from("profiles").select("username").eq("id", session.user.id).maybeSingle();

  const { data: report, error } = await supabase
    .from("reports")
    .insert({
      reporter_id: session.user.id,
      reporter_username: (profile as { username?: string } | null)?.username ?? null,
      reporter_email: session.user.email ?? null,
      entity_type: input.entityType,
      entity_id: input.entityId,
      entity_name: input.entityName ?? null,
      club_id: input.clubId ?? null,
      reason: input.reason ?? null,
      details: input.details ?? null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !report) throw error ?? new Error("Failed to submit report");

  try {
    const { data, error: fnError } = await supabase.functions.invoke("send-report-email", {
      body: { reportId: (report as any).id },
    });
    if (fnError) throw fnError;
    return { saved: true as const, emailed: (data as { sent?: boolean } | null)?.sent === true };
  } catch {
    return { saved: true as const, emailed: false };
  }
}

export async function submitReport(input: SubmitReportInput) {
  const key = `${input.entityType}:${input.entityId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const run = doSubmitReport(input).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

export function useReport() {
  return useMutation({ mutationFn: (input: SubmitReportInput) => submitReport(input) });
}
