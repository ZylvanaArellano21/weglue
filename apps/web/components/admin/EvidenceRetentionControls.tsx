"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyReportEvidenceHold,
  releaseReportEvidenceHold,
  setReportEvidenceAppeal,
} from "../../lib/admin/reportsActions";

type Hold = { id: string; hold_type: "legal" | "safety"; applied_at: string } | null;

/**
 * Founder-only report-evidence retention controls. The Dashboard receives only
 * hold type/time and appeal status; reasons never leave their private write
 * request or the protected audit record.
 */
export function EvidenceRetentionControls({
  reportId,
  activeHold,
  appealStatus,
}: {
  reportId: string;
  activeHold: Hold;
  appealStatus: "active" | "resolved" | null;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [holdType, setHoldType] = useState<"legal" | "safety">("legal");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const validReason = reason.trim().length >= 3 && reason.trim().length <= 500;
  async function run(kind: "apply" | "release" | "appeal-active" | "appeal-resolved") {
    if (!validReason || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setResult(null);
    try {
      const response = kind === "apply"
        ? await applyReportEvidenceHold({ reportId, holdType, internalReason: reason })
        : kind === "release"
          ? await releaseReportEvidenceHold({ reportId, holdId: activeHold!.id, internalReason: reason })
          : await setReportEvidenceAppeal({ reportId, status: kind === "appeal-active" ? "active" : "resolved", internalReason: reason });
      setResult(response.ok ? "Retention state recorded and audited." : response.error);
      if (response.ok) {
        setReason("");
        router.refresh();
      }
    } finally {
      setPending(false);
      inFlight.current = false;
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
      <h3 className="text-sm font-semibold text-amber-950">Private evidence retention</h3>
      <p className="mt-1 text-xs text-amber-900">Legal/safety holds and appeals prevent automatic purge. Reasons are private and audited.</p>
      <p className="mt-2 text-xs text-amber-900">
        Hold: {activeHold ? `${activeHold.hold_type} (active)` : "none"} · Appeal: {appealStatus ?? "none"}
      </p>
      <label className="mt-3 block text-xs font-medium text-amber-950">Internal reason (3–500 characters)
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded border border-amber-300 bg-white p-2 text-sm" />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        {activeHold ? (
          <button type="button" disabled={!validReason || pending} onClick={() => void run("release")} className="rounded border border-amber-400 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-950 disabled:opacity-50">Release hold</button>
        ) : (
          <>
            <select value={holdType} onChange={(e) => setHoldType(e.target.value as "legal" | "safety")} className="rounded border border-amber-300 bg-white px-2 text-xs">
              <option value="legal">Legal hold</option><option value="safety">Safety hold</option>
            </select>
            <button type="button" disabled={!validReason || pending} onClick={() => void run("apply")} className="rounded border border-amber-400 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-950 disabled:opacity-50">Apply hold</button>
          </>
        )}
        {appealStatus === "active" ? (
          <button type="button" disabled={!validReason || pending} onClick={() => void run("appeal-resolved")} className="rounded border border-amber-400 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-950 disabled:opacity-50">Resolve appeal</button>
        ) : (
          <button type="button" disabled={!validReason || pending} onClick={() => void run("appeal-active")} className="rounded border border-amber-400 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-950 disabled:opacity-50">Record active appeal</button>
        )}
      </div>
      {result ? <p role="status" className="mt-2 text-xs text-amber-950">{result}</p> : null}
    </div>
  );
}
