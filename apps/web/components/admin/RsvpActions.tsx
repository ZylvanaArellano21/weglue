"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../shared/Modal";
import { ConfirmAction } from "./ConfirmAction";
import { EntityPicker, type PickedEntity } from "./EntityPicker";
import { upsertRsvp, removeRsvp } from "../../lib/admin/contentActions";

const STATUSES = [
  { value: "going", label: "Going" },
  { value: "cant", label: "Can't go" },
];

/** Add or update an RSVP for a known event — pick any user + a valid status. */
export function AddRsvpDialog({ eventId, eventTitle }: { eventId: string; eventTitle: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<PickedEntity | null>(null);
  const [status, setStatus] = useState("going");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!user) return;
    setPending(true);
    setError(null);
    upsertRsvp(eventId, user.id, status)
      .then((res) => {
        if (res.ok) {
          setOpen(false);
          setUser(null);
          router.refresh();
        } else setError(res.error);
      })
      .catch(() => setError("Something went wrong."))
      .finally(() => setPending(false));
  }

  return (
    <>
      <button
        onClick={() => {
          setUser(null);
          setStatus("going");
          setError(null);
          setOpen(true);
        }}
        className="rounded-md border border-teal-500 bg-teal-500 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-teal-600"
      >
        ＋ Add / update RSVP
      </button>
      {open ? (
        <Modal onClose={() => (pending ? null : setOpen(false))} maxWidth={440}>
          <div className="space-y-4 p-5">
            <h3 className="text-base font-semibold text-gray-900">Add or update an RSVP</h3>
            <p className="text-xs text-gray-500">Event: {eventTitle}</p>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Attendee</label>
              <EntityPicker kind="user" value={user} onPick={setUser} placeholder="Search a user by name, username, email…" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button
                disabled={pending || !user}
                onClick={submit}
                className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save RSVP"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Per-row RSVP controls on the RSVPs list: flip status + remove. */
export function RsvpRowActions({ eventId, userId, status }: { eventId: string; userId: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const other = status === "going" ? "cant" : "going";
  const otherLabel = other === "going" ? "Set going" : "Set can't";

  function flip() {
    setPending(true);
    upsertRsvp(eventId, userId, other)
      .then((res) => {
        if (res.ok) router.refresh();
      })
      .finally(() => setPending(false));
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={flip}
        disabled={pending}
        className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {otherLabel}
      </button>
      <ConfirmAction
        label="Remove"
        title="Remove this RSVP?"
        body="The attendee's RSVP for this event will be removed. Event counts update automatically."
        confirmLabel="Remove RSVP"
        tone="danger"
        size="xs"
        requireReason
        targetSummary={`Attendee ${userId.slice(0, 8)} — event ${eventId.slice(0, 8)}`}
        run={(reason) => removeRsvp(eventId, userId, reason)}
      />
    </div>
  );
}
