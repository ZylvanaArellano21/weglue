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
  createClub,
  updateClub,
  type CreateClubInput,
  type ClubPatch,
} from "../../lib/admin/actions";
import type { UniversityOption } from "../../lib/admin/data";

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

// ── Create / edit club ───────────────────────────────────────────────────────
//
// Officer add/promote/demote/remove is handled entirely by the dialogs above
// (already live). This section is the piece that was actually missing: club
// creation and editing club information. `handle` is intentionally never a
// form field — the database derives it from the name (see createClub's own
// doc comment) and always wins, so showing an editable handle box would be
// misleading.

interface ClubFormState {
  name: string;
  description: string;
  university_id: string;
  meeting_day: string;
  meeting_time_start: string;
  meeting_time_end: string;
  meeting_location: string;
  meeting_building: string;
  meeting_room: string;
}

const EMPTY_CLUB_FORM: ClubFormState = {
  name: "",
  description: "",
  university_id: "",
  meeting_day: "",
  meeting_time_start: "",
  meeting_time_end: "",
  meeting_location: "",
  meeting_building: "",
  meeting_room: "",
};

const MEETING_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const inputClass =
  "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100";
const labelClass = "mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500";

function clubDetailToForm(club: {
  name: string;
  description: string | null;
  university_id: string | null;
  meeting_day: string | null;
  meeting_time_start: string | null;
  meeting_time_end: string | null;
  meeting_location: string | null;
  meeting_building: string | null;
  meeting_room: string | null;
}): ClubFormState {
  return {
    name: club.name,
    description: club.description ?? "",
    university_id: club.university_id ?? "",
    meeting_day: club.meeting_day ?? "",
    // Postgres TIME comes back as "HH:MM:SS"; <input type="time"> wants "HH:MM".
    meeting_time_start: (club.meeting_time_start ?? "").slice(0, 5),
    meeting_time_end: (club.meeting_time_end ?? "").slice(0, 5),
    meeting_location: club.meeting_location ?? "",
    meeting_building: club.meeting_building ?? "",
    meeting_room: club.meeting_room ?? "",
  };
}

function formToClubInput(form: ClubFormState): CreateClubInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    university_id: form.university_id || null,
    meeting_day: form.meeting_day || null,
    meeting_time_start: form.meeting_time_start || null,
    meeting_time_end: form.meeting_time_end || null,
    meeting_location: form.meeting_location.trim() || null,
    meeting_building: form.meeting_building.trim() || null,
    meeting_room: form.meeting_room.trim() || null,
  };
}

function ClubFormFields({
  form,
  onChange,
  universities,
}: {
  form: ClubFormState;
  onChange: <K extends keyof ClubFormState>(key: K, value: ClubFormState[K]) => void;
  universities: UniversityOption[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>Name</label>
        <input value={form.name} onChange={(e) => onChange("name", e.target.value)} maxLength={120} autoFocus className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Description</label>
        <textarea
          value={form.description}
          onChange={(e) => onChange("description", e.target.value)}
          maxLength={5000}
          rows={3}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>University</label>
        <select value={form.university_id} onChange={(e) => onChange("university_id", e.target.value)} className={`${inputClass} bg-white`}>
          <option value="">— None —</option>
          {universities.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Meeting day</label>
          <select value={form.meeting_day} onChange={(e) => onChange("meeting_day", e.target.value)} className={`${inputClass} bg-white`}>
            <option value="">—</option>
            {MEETING_DAYS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Start</label>
          <input type="time" value={form.meeting_time_start} onChange={(e) => onChange("meeting_time_start", e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>End</label>
          <input type="time" value={form.meeting_time_end} onChange={(e) => onChange("meeting_time_end", e.target.value)} className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Location</label>
          <input value={form.meeting_location} onChange={(e) => onChange("meeting_location", e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Building</label>
          <input value={form.meeting_building} onChange={(e) => onChange("meeting_building", e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Room</label>
          <input value={form.meeting_room} onChange={(e) => onChange("meeting_room", e.target.value)} className={inputClass} />
        </div>
      </div>
    </div>
  );
}

/** Create a new club. Redirects to the new club's detail page on success. */
export function CreateClubDialog({ universities }: { universities: UniversityOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ClubFormState>(EMPTY_CLUB_FORM);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setForm(EMPTY_CLUB_FORM);
    setError(null);
  }

  function setField<K extends keyof ClubFormState>(key: K, value: ClubFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await createClub(formToClubInput(form));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      reset();
      const created = res.data as { id?: string } | undefined;
      if (created?.id) router.push(`/admin/clubs/${created.id}`);
      else router.refresh();
    } catch {
      setError("Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  const canSubmit = form.name.trim().length >= 2 && form.description.trim().length >= 1;

  return (
    <>
      <DialogButton label="＋ Create club" onClick={() => setOpen(true)} primary />
      {open ? (
        <Modal onClose={() => (pending ? null : (setOpen(false), reset()))} maxWidth={520}>
          <div className="space-y-4 p-5">
            <h3 className="text-base font-semibold text-gray-900">Create club</h3>
            <ClubFormFields form={form} onChange={setField} universities={universities} />
            {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <div className="flex justify-end gap-2">
              <DialogButton label="Cancel" onClick={() => (setOpen(false), reset())} />
              <button
                disabled={!canSubmit || pending}
                onClick={submit}
                className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
              >
                {pending ? "Creating…" : "Create club"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Edit an existing club's information. */
export function EditClubDialog({
  clubId,
  club,
  universities,
}: {
  clubId: string;
  club: {
    name: string;
    description: string | null;
    university_id: string | null;
    meeting_day: string | null;
    meeting_time_start: string | null;
    meeting_time_end: string | null;
    meeting_location: string | null;
    meeting_building: string | null;
    meeting_room: string | null;
  };
  universities: UniversityOption[];
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ClubFormState>(() => clubDetailToForm(club));
  const { pending, error, setError, run } = useRunner();

  function openDialog() {
    setForm(clubDetailToForm(club));
    setError(null);
    setOpen(true);
  }

  function setField<K extends keyof ClubFormState>(key: K, value: ClubFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function submit() {
    const patch: ClubPatch = formToClubInput(form);
    run(() => updateClub(clubId, patch), () => setOpen(false));
  }

  const canSubmit = form.name.trim().length >= 2 && form.description.trim().length >= 1;

  return (
    <>
      <DialogButton label="Edit club details" onClick={openDialog} />
      {open ? (
        <Modal onClose={() => (pending ? null : setOpen(false))} maxWidth={520}>
          <div className="space-y-4 p-5">
            <h3 className="text-base font-semibold text-gray-900">Edit club details</h3>
            <ClubFormFields form={form} onChange={setField} universities={universities} />
            {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <div className="flex justify-end gap-2">
              <DialogButton label="Cancel" onClick={() => setOpen(false)} />
              <button
                disabled={!canSubmit || pending}
                onClick={submit}
                className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
