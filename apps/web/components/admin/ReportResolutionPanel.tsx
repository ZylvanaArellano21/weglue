"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveReport, setReportStatus } from "../../lib/admin/reportsActions";
import { ConfirmAction } from "./ConfirmAction";

const CATEGORIES = [
  ["targeted_harassment", "Targeted harassment"],
  ["threats_or_violence", "Threats or violence"],
  ["hate_speech", "Hate speech"],
  ["sexual_harassment", "Sexual harassment"],
  ["privacy_violation", "Privacy violation"],
  ["spam_or_scams", "Spam or scams"],
  ["inappropriate_content", "Inappropriate content"],
  ["other", "Other"],
] as const;

export function ReportResolutionPanel({ reportId, status, entityType }: { reportId: string; status: string; entityType: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<"resolved" | "dismissed" | null>(null);
  const [outcome, setOutcome] = useState(entityType === "user" ? "account_violation" : "content_violation");
  const [enforcement, setEnforcement] = useState("none");
  const [category, setCategory] = useState("inappropriate_content");
  const [publicExplanation, setPublicExplanation] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [internalReason, setInternalReason] = useState("");
  const [suspendedUntil, setSuspendedUntil] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const inFlight = useRef(false);

  const available = entityType === "post" ? [["post_remove", "Remove reported post"]] : entityType === "event" ? [["event_remove", "Remove reported event"]] : entityType === "user" ? [["suspend", "Suspend account"], ["block", "Restrict account"], ["schedule_deletion", "Schedule pending account deletion"]] : [];
  const canSubmit = !!open && confirmation.trim().toUpperCase() === (open === "dismissed" ? "DISMISS REPORT" : "RESOLVE REPORT") && internalReason.trim().length >= 3 && internalNote.trim().length >= 3 && (open === "dismissed" || enforcement === "none" || (publicExplanation.trim().length >= 10 && category));

  function begin(next: "resolved" | "dismissed") {
    setOpen(next);
    setResult(null);
    setConfirmation("");
  }

  async function submit() {
    if (!open || !canSubmit || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setResult(null);
    try {
      const response = await resolveReport({
        reportId,
        status: open,
        resolutionOutcome: open === "dismissed" ? "duplicate_or_invalid" : outcome,
        internalReason,
        internalDecisionNote: internalNote,
        publicCategory: enforcement === "none" ? undefined : category,
        publicExplanation: enforcement === "none" ? undefined : publicExplanation,
        enforcementAction: open === "dismissed" ? "none" : enforcement,
        suspendedUntil: suspendedUntil ? new Date(suspendedUntil).toISOString() : null,
      });
      setResult(response.ok ? { ok: true } : { ok: false, error: response.error });
      if (response.ok) {
        setOpen(null);
        router.refresh();
      }
    } finally {
      setPending(false);
      inFlight.current = false;
    }
  }

  return (
    <div className="space-y-4">
      {status === "pending" ? <ConfirmAction label="Mark under review" title="Mark this report under review?" body="This records that the founder has started reviewing the report." confirmLabel="Mark under review" requireReason reasonLabel="Internal reason" run={(reason) => setReportStatus(reportId, "reviewing", reason)} /> : null}
      {status === "pending" || status === "reviewing" ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => begin("resolved")} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800">Resolve report</button>
          <button type="button" onClick={() => begin("dismissed")} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Dismiss report</button>
        </div>
      ) : <p className="text-sm text-gray-500">This decision is terminal. Corrections require a new explicit superseding record.</p>}

      {result && <p role="status" className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-700"}`}>{result.ok ? "Decision recorded and the Dashboard refreshed." : result.error}</p>}

      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby="report-resolution-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <h2 id="report-resolution-title" className="text-lg font-semibold text-gray-900">{open === "dismissed" ? "Dismiss report" : "Resolve report"}</h2>
            <p className="mt-1 text-sm text-gray-500">The decision is permanent. Internal notes stay private to the Admin Dashboard.</p>
            {open === "resolved" && <>
              <label className="mt-4 block text-sm font-medium">Resolution outcome<select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="mt-1 w-full rounded-lg border p-2"><option value="no_violation">No violation found</option><option value="content_violation">Content violation</option><option value="account_violation">Account violation</option><option value="other">Other reviewed outcome</option></select></label>
              <label className="mt-3 block text-sm font-medium">Enforcement<select value={enforcement} onChange={(e) => setEnforcement(e.target.value)} className="mt-1 w-full rounded-lg border p-2"><option value="none">Take no automated action</option>{available.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              {available.length === 0 && <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">No automated enforcement is available for {entityType} reports in Day 10D.</p>}
              {enforcement !== "none" && <>
                <label className="mt-3 block text-sm font-medium">Public category<select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border p-2">{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="mt-3 block text-sm font-medium">Public explanation (10–500 characters)<textarea value={publicExplanation} onChange={(e) => setPublicExplanation(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border p-2" placeholder="Explain the action clearly without identifying the reporter." /></label>
                {enforcement === "suspend" && <label className="mt-3 block text-sm font-medium">Suspension ends (optional)<input type="datetime-local" value={suspendedUntil} onChange={(e) => setSuspendedUntil(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>}
              </>}
            </>}
            <label className="mt-3 block text-sm font-medium">Internal decision note (3–2,000 characters)<textarea value={internalNote} onChange={(e) => setInternalNote(e.target.value)} rows={4} className="mt-1 w-full rounded-lg border p-2" /></label>
            <label className="mt-3 block text-sm font-medium">Internal reason (3–500 characters)<textarea value={internalReason} onChange={(e) => setInternalReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border p-2" /></label>
            <label className="mt-3 block text-sm font-medium">Type {open === "dismissed" ? "DISMISS REPORT" : "RESOLVE REPORT"} to confirm<input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>
            <div className="mt-5 flex gap-2"><button type="button" onClick={() => setOpen(null)} disabled={pending} className="flex-1 rounded-lg border px-3 py-2 text-sm">Cancel</button><button type="button" onClick={() => void submit()} disabled={!canSubmit || pending} className="flex-1 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Saving…" : "Save decision"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
