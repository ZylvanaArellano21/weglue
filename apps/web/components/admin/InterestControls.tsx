"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../shared/Modal";
import { ConfirmAction } from "./ConfirmAction";
import {
  createInterest,
  renameInterest,
  setInterestActive,
} from "../../lib/admin/interestsActions";
import type { AdminInterestRow } from "../../lib/admin/interestsData";

const teal = "#0f766e";

function fieldClass(invalid: boolean) {
  return `w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500/40 ${
    invalid ? "border-red-400" : "border-gray-300"
  }`;
}

// ── Add interest ────────────────────────────────────────────────────────────

export function AddInterestButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = label.trim().length >= 2 && label.trim().length <= 40;

  async function submit() {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    const res = await createInterest(label.trim());
    setPending(false);
    if (res.ok) {
      setOpen(false);
      setLabel("");
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
        style={{ background: teal }}
      >
        Add interest
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} maxWidth={420}>
          <div className="p-5">
            <h2 className="mb-1 text-base font-semibold text-gray-900">Add interest</h2>
            <p className="mb-4 text-xs text-gray-500">
              Appears in both interest surveys immediately — no app or web deploy.
            </p>
            <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
            <input
              autoFocus
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className={fieldClass(!!label && !valid)}
              placeholder="e.g. Entrepreneurship"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              A stable slug is generated automatically (e.g. “entrepreneurship”).
            </p>
            {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!valid || pending}
                onClick={submit}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: teal }}
              >
                {pending ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Per-row actions: rename + activate/deactivate ───────────────────────────

export function InterestRowActions({ interest }: { interest: AdminInterestRow }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState(interest.label);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    label.trim().length >= 2 && label.trim().length <= 40 && label.trim() !== interest.label;
  const inUse = interest.primary_clubs + interest.secondary_clubs;

  async function submitRename() {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    const res = await renameInterest(interest.id, label.trim());
    setPending(false);
    if (res.ok) {
      setRenaming(false);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={() => {
          setLabel(interest.label);
          setError(null);
          setRenaming(true);
        }}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        Rename
      </button>

      {interest.is_active ? (
        <ConfirmAction
          label="Deactivate"
          size="xs"
          tone="danger"
          title="Deactivate interest"
          requireReason
          targetSummary={`${interest.label}${inUse ? ` — used by ${inUse} club${inUse === 1 ? "" : "s"}` : ""}`}
          body={
            <>
              It disappears from both interest surveys right away. Existing student
              selections and club assignments are <strong>kept</strong> — reactivate
              any time to restore it. Nothing is deleted.
            </>
          }
          confirmLabel="Deactivate"
          run={(reason) => setInterestActive(interest.id, false, reason)}
        />
      ) : (
        <ConfirmAction
          label="Reactivate"
          size="xs"
          title="Reactivate interest"
          requireReason
          targetSummary={interest.label}
          body="It becomes selectable again in both interest surveys."
          confirmLabel="Reactivate"
          run={(reason) => setInterestActive(interest.id, true, reason)}
        />
      )}

      {renaming && (
        <Modal onClose={() => setRenaming(false)} maxWidth={420}>
          <div className="p-5">
            <h2 className="mb-1 text-base font-semibold text-gray-900">Rename interest</h2>
            <p className="mb-4 text-xs text-gray-500">
              The slug stays “{interest.slug}”, so club assignments and student
              selections follow the rename automatically.
            </p>
            <input
              autoFocus
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitRename()}
              className={fieldClass(!!label && (label.trim().length < 2 || label.trim().length > 40))}
            />
            {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!valid || pending}
                onClick={submitRename}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: teal }}
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
