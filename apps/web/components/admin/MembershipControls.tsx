"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../shared/Modal";
import { EntityPicker, type PickedEntity } from "./EntityPicker";
import { ConfirmAction } from "./ConfirmAction";
import {
  addMembership,
  addOfficer,
  setMembershipRole,
  editOfficerTitle,
  removeMembership,
} from "../../lib/admin/actions";

function useRunner() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function run(fn: () => Promise<{ ok: boolean; error?: string }>, onOk: () => void) {
    setError(null);
    setPending(true);
    fn()
      .then((res) => {
        if (res.ok) {
          onOk();
          router.refresh();
        } else {
          setError(res.error ?? "Something went wrong.");
        }
      })
      .catch(() => setError("Something went wrong."))
      .finally(() => setPending(false));
  }
  return { pending, error, setError, run };
}

function DialogButton({ label, onClick, primary }: { label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1.5 text-sm font-medium ${
        primary ? "border-teal-500 bg-teal-500 text-white hover:bg-teal-600" : "border-gray-200 text-gray-700 hover:bg-gray-50"
      }`}
    >
      {label}
    </button>
  );
}

// ── Add member ───────────────────────────────────────────────────────────────

export function AddMemberDialog({ presetClub }: { presetClub?: PickedEntity }) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<PickedEntity | null>(null);
  const [club, setClub] = useState<PickedEntity | null>(presetClub ?? null);
  const { pending, error, setError, run } = useRunner();

  function reset() {
    setUser(null);
    setClub(presetClub ?? null);
    setError(null);
  }

  return (
    <>
      <DialogButton label="＋ Add member" onClick={() => setOpen(true)} primary />
      {open ? (
        <Modal onClose={() => (pending ? null : (setOpen(false), reset()))} maxWidth={480}>
          <div className="space-y-4 p-5">
            <h3 className="text-base font-semibold text-gray-900">Add member to a club</h3>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">User</label>
              <EntityPicker kind="user" value={user} onPick={setUser} placeholder="Search users by name / username…" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Club</label>
              {presetClub ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">{presetClub.label}</div>
              ) : (
                <EntityPicker kind="club" value={club} onPick={setClub} placeholder="Search clubs by name / handle…" />
              )}
            </div>
            {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <div className="flex justify-end gap-2">
              <DialogButton label="Cancel" onClick={() => (setOpen(false), reset())} />
              <button
                disabled={!user || !club || pending}
                onClick={() => run(() => addMembership(club!.id, user!.id), () => (setOpen(false), reset()))}
                className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
              >
                {pending ? "Adding…" : "Add member"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ── Add officer ──────────────────────────────────────────────────────────────

export function AddOfficerDialog({ presetClub }: { presetClub?: PickedEntity }) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<PickedEntity | null>(null);
  const [club, setClub] = useState<PickedEntity | null>(presetClub ?? null);
  const [title, setTitle] = useState("Officer");
  const { pending, error, setError, run } = useRunner();

  function reset() {
    setUser(null);
    setClub(presetClub ?? null);
    setTitle("Officer");
    setError(null);
  }

  return (
    <>
      <DialogButton label="＋ Add officer" onClick={() => setOpen(true)} primary />
      {open ? (
        <Modal onClose={() => (pending ? null : (setOpen(false), reset()))} maxWidth={480}>
          <div className="space-y-4 p-5">
            <h3 className="text-base font-semibold text-gray-900">Add officer</h3>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">User</label>
              <EntityPicker kind="user" value={user} onPick={setUser} placeholder="Search users…" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Club</label>
              {presetClub ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">{presetClub.label}</div>
              ) : (
                <EntityPicker kind="club" value={club} onPick={setClub} placeholder="Search clubs…" />
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Officer title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={40}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              />
            </div>
            {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <div className="flex justify-end gap-2">
              <DialogButton label="Cancel" onClick={() => (setOpen(false), reset())} />
              <button
                disabled={!user || !club || pending}
                onClick={() => run(() => addOfficer(club!.id, user!.id, title), () => (setOpen(false), reset()))}
                className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Add officer"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ── Title dialog (promote member / edit officer title) ──────────────────────

function TitleDialog({
  triggerLabel,
  heading,
  clubId,
  userId,
  initialTitle,
  mode,
}: {
  triggerLabel: string;
  heading: string;
  clubId: string;
  userId: string;
  initialTitle: string;
  mode: "promote" | "edit";
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const { pending, error, run } = useRunner();

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
        {triggerLabel}
      </button>
      {open ? (
        <Modal onClose={() => (pending ? null : setOpen(false))} maxWidth={400}>
          <div className="space-y-4 p-5">
            <h3 className="text-base font-semibold text-gray-900">{heading}</h3>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={40}
              autoFocus
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
            {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <div className="flex justify-end gap-2">
              <DialogButton label="Cancel" onClick={() => setOpen(false)} />
              <button
                disabled={pending || title.trim().length < 2}
                onClick={() =>
                  run(
                    () => (mode === "promote" ? setMembershipRole(clubId, userId, "officer", title) : editOfficerTitle(clubId, userId, title)),
                    () => setOpen(false)
                  )
                }
                className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ── Row actions (member vs officer) ──────────────────────────────────────────

export function MemberRowActions({
  clubId,
  userId,
  role,
  officerCount,
  roleTitle,
  targetLabel,
}: {
  clubId: string;
  userId: string;
  role: string;
  officerCount: number;
  roleTitle: string | null;
  /** Human identification of exactly who/what is affected, shown in the dialog. */
  targetLabel: string;
}) {
  const isOfficer = role === "officer";
  const lastOfficer = isOfficer && officerCount <= 1;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isOfficer ? (
        <>
          <TitleDialog triggerLabel="Edit title" heading="Edit officer title" clubId={clubId} userId={userId} initialTitle={roleTitle ?? "Officer"} mode="edit" />
          <ConfirmAction
            label="Demote"
            title="Demote officer to member?"
            body="They keep their membership but lose officer authority and officer-chat access."
            confirmLabel="Demote"
            tone="danger"
            disabled={lastOfficer}
            disabledReason={lastOfficer ? "Cannot demote the club's only officer." : undefined}
            requireReason
            targetSummary={targetLabel}
            run={(reason) => setMembershipRole(clubId, userId, "member", undefined, reason)}
          />
          <ConfirmAction
            label="Remove"
            title="Remove from club"
            body="Officers must be demoted before removal."
            disabled
            disabledReason="Demote this officer to member first."
            run={(reason) => removeMembership(clubId, userId, reason)}
          />
        </>
      ) : (
        <>
          <TitleDialog triggerLabel="Promote" heading="Promote to officer" clubId={clubId} userId={userId} initialTitle="Officer" mode="promote" />
          <ConfirmAction
            label="Remove"
            title="Remove member from club?"
            body="This removes their membership and Members-chat access. They can be re-added later."
            confirmLabel="Remove"
            tone="danger"
            requireReason
            targetSummary={targetLabel}
            run={(reason) => removeMembership(clubId, userId, reason)}
          />
        </>
      )}
    </div>
  );
}
