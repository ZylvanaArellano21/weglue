"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { suspendUser, unsuspendUser, platformBlockUser, unblockUser, adjustSuspensionExpiry } from "../../lib/admin/restrictionActions";
import { MIN_INTERNAL_REASON, MIN_PUBLIC_REASON, MAX_REASON, VIOLATION_CATEGORIES, type RestrictionReasonInput, type RestrictionResult } from "../../lib/admin/restrictionTypes";

type Kind = "suspend" | "unsuspend" | "block" | "unblock" | "adjust";
interface Props { userId: string; targetSummary: string; accessState: "active" | "suspended" | "platform_blocked" | "deletion_pending"; writesEnabled: boolean; }

const LABEL: Record<Kind, string> = { suspend: "Suspend user", unsuspend: "Unsuspend user", block: "Block from We Glue", unblock: "Unblock user", adjust: "Adjust suspension expiry" };
const needsPublicReason = (kind: Kind) => kind === "suspend" || kind === "block";
const needsDate = (kind: Kind) => kind === "suspend" || kind === "adjust";

export function RestrictionControls({ userId, targetSummary, accessState, writesEnabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState<Kind | null>(null);
  const [category, setCategory] = useState<RestrictionReasonInput["violationCategory"]>("targeted_harassment");
  const [publicReason, setPublicReason] = useState("");
  const [internalReason, setInternalReason] = useState("");
  const [until, setUntil] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RestrictionResult | null>(null);
  const inFlight = useRef(false);
  const choices: Kind[] = accessState === "active" ? ["suspend", "block"] : accessState === "suspended" ? ["unsuspend", "adjust", "block"] : accessState === "platform_blocked" ? ["unblock"] : [];

  const publicValid = publicReason.trim().length >= MIN_PUBLIC_REASON && publicReason.trim().length <= MAX_REASON;
  const internalValid = internalReason.trim().length >= MIN_INTERNAL_REASON && internalReason.trim().length <= MAX_REASON;
  const valid = !!open && internalValid && (!needsPublicReason(open) || publicValid);

  function close() { if (!pending) { setOpen(null); setPublicReason(""); setInternalReason(""); setUntil(""); setResult(null); } }
  async function submit() {
    if (!open || !valid || inFlight.current) return;
    inFlight.current = true; setPending(true); setResult(null);
    const expiry = until ? new Date(until).toISOString() : null;
    try {
      const input = { violationCategory: category, publicReason: publicReason.trim(), internalReason: internalReason.trim() };
      const response = open === "suspend" ? await suspendUser(userId, input, expiry)
        : open === "block" ? await platformBlockUser(userId, input)
        : open === "unsuspend" ? await unsuspendUser(userId, internalReason.trim())
        : open === "unblock" ? await unblockUser(userId, internalReason.trim())
        : await adjustSuspensionExpiry(userId, internalReason.trim(), expiry);
      setResult(response); if (response.ok) router.refresh();
    } catch { setResult({ ok: false, status: "notApplied", message: "The action was not applied. Please retry.", correlationId: "", restrictionCommitted: false, accessInvalidated: false, clientRefreshPending: false, reconciliationRequired: false }); }
    finally { setPending(false); inFlight.current = false; }
  }

  return <div className="flex flex-wrap gap-2">
    {choices.map((kind) => <button key={kind} type="button" disabled={!writesEnabled} onClick={() => { setOpen(kind); setResult(null); }} className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${kind === "suspend" || kind === "block" ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-700"}`}>{LABEL[kind]}</button>)}
    {accessState === "deletion_pending" && <p className="text-xs text-amber-700">A pending administrator deletion must be cancelled before access changes.</p>}
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
      <h3 className="text-base font-semibold text-gray-900">{LABEL[open]}</h3>
      <p className="mt-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">Target: {targetSummary}</p>
      {needsPublicReason(open) && <>
        <label className="mt-4 block text-xs font-medium text-gray-700">Violation category<select value={category} onChange={(event) => setCategory(event.target.value as RestrictionReasonInput["violationCategory"])} disabled={pending} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm">{VIOLATION_CATEGORIES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="mt-3 block text-xs font-medium text-gray-700">Explanation shown to the student ({MIN_PUBLIC_REASON}–{MAX_REASON} characters)<textarea value={publicReason} onChange={(event) => setPublicReason(event.target.value)} disabled={pending} rows={4} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" /></label>
      </>}
      {needsDate(open) && <label className="mt-3 block text-xs font-medium text-gray-700">Suspension end (optional)<input type="datetime-local" value={until} onChange={(event) => setUntil(event.target.value)} disabled={pending} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" /></label>}
      <label className="mt-3 block text-xs font-medium text-gray-700">Internal administrator note ({MIN_INTERNAL_REASON}–{MAX_REASON} characters; never shown to the student)<textarea value={internalReason} onChange={(event) => setInternalReason(event.target.value)} disabled={pending} rows={3} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" /></label>
      {result && <p role="status" className={`mt-3 text-sm ${result.ok ? "text-emerald-700" : "text-red-700"}`}>{result.message}</p>}
      {result?.ok && <p className="mt-1 text-xs text-gray-500">Database enforcement: active. Application access: blocked. Existing Auth tokens expire naturally and can reach only the restricted shell.</p>}
      <div className="mt-5 flex gap-2"><button type="button" onClick={close} disabled={pending} className="flex-1 rounded-lg border px-3 py-2 text-sm">Cancel</button><button type="button" onClick={() => void submit()} disabled={!valid || pending} className="flex-1 rounded-lg bg-[#F02719] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Applying…" : LABEL[open]}</button></div>
    </div></div>}
  </div>;
}
