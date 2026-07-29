"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../shared/Modal";
import { editEvent, type EditEventFields } from "../../lib/admin/contentActions";

export interface EventEditInitial {
  title: string;
  description: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string | null;
  building: string | null;
  room: string | null;
  visibility: string;
  emoji: string | null;
}

const VISIBILITIES = [
  { value: "everyone", label: "Everyone" },
  { value: "members", label: "Members only" },
  { value: "specific", label: "Specific members" },
];

/** Strip an ISO/DB time to HH:MM for the <input type="time"> control. */
function toHm(t: string | null | undefined): string {
  if (!t) return "";
  return t.length >= 5 ? t.slice(0, 5) : t;
}

export function EditEventDialog({ eventId, initial }: { eventId: string; initial: EventEditInitial }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(initial.title);
  const [emoji, setEmoji] = useState(initial.emoji ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [eventDate, setEventDate] = useState(initial.event_date);
  const [startTime, setStartTime] = useState(toHm(initial.start_time));
  const [endTime, setEndTime] = useState(toHm(initial.end_time));
  const [location, setLocation] = useState(initial.location ?? "");
  const [building, setBuilding] = useState(initial.building ?? "");
  const [room, setRoom] = useState(initial.room ?? "");
  const [visibility, setVisibility] = useState(initial.visibility);

  function reset() {
    setTitle(initial.title);
    setEmoji(initial.emoji ?? "");
    setDescription(initial.description ?? "");
    setEventDate(initial.event_date);
    setStartTime(toHm(initial.start_time));
    setEndTime(toHm(initial.end_time));
    setLocation(initial.location ?? "");
    setBuilding(initial.building ?? "");
    setRoom(initial.room ?? "");
    setVisibility(initial.visibility);
    setError(null);
  }

  function submit() {
    setPending(true);
    setError(null);
    const fields: EditEventFields = {
      title,
      emoji,
      description,
      event_date: eventDate,
      start_time: startTime,
      end_time: endTime,
      location,
      building,
      room,
      visibility,
    };
    editEvent(eventId, fields)
      .then((res) => {
        if (res.ok) {
          setOpen(false);
          router.refresh();
        } else setError(res.error);
      })
      .catch(() => setError("Something went wrong."))
      .finally(() => setPending(false));
  }

  const timeInvalid = startTime !== "" && endTime !== "" && startTime >= endTime;

  return (
    <>
      <button
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Edit event
      </button>
      {open ? (
        <Modal onClose={() => (pending ? null : setOpen(false))} maxWidth={560}>
          <div className="max-h-[80vh] space-y-4 overflow-y-auto p-5">
            <h3 className="text-base font-semibold text-gray-900">Edit event</h3>

            <div className="flex gap-3">
              <div className="w-16">
                <Label>Emoji</Label>
                <input value={emoji} onChange={(e) => setEmoji(e.target.value.slice(0, 8))} className={inputCls} />
              </div>
              <div className="flex-1">
                <Label>Title</Label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div>
              <Label>Description</Label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputCls} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Date</Label>
                <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <Label>Start</Label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
              </div>
              <div>
                <Label>End</Label>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
              </div>
            </div>
            {timeInvalid ? <p className="text-xs text-red-600">Start time must be before end time.</p> : null}

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Location</Label>
                <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} />
              </div>
              <div>
                <Label>Building</Label>
                <input value={building} onChange={(e) => setBuilding(e.target.value)} className={inputCls} />
              </div>
              <div>
                <Label>Room</Label>
                <input value={room} onChange={(e) => setRoom(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div>
              <Label>Visibility</Label>
              <select value={visibility} onChange={(e) => setVisibility(e.target.value)} className={inputCls}>
                {VISIBILITIES.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
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
                disabled={pending || title.trim().length < 2 || timeInvalid}
                onClick={submit}
                className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save event"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

const inputCls =
  "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100";

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">{children}</label>;
}
