"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { ImageIcon, CloseIcon } from "../shared/icons";
import { useToast } from "../shared/Toast";
import { uploadToBucket } from "../../lib/imageUpload";
import {
  useOfficerClubs,
  useMemberSearch,
  useCreateEvent,
  useEventForEdit,
  useUpdateEvent,
  type Visibility,
} from "../../lib/hooks/useCreateEvent";

const VIS: { value: Visibility; label: string; desc: string }[] = [
  { value: "everyone", label: "Everyone", desc: "Anyone on campus can see it" },
  { value: "members", label: "Members", desc: "Only members of the club" },
  { value: "specific", label: "Selected members", desc: "Only people you pick" },
];

// Desktop create-event (Share a Glue → Event, officer-only). Fields mirror
// mobile's New Event: host club, image, title, description, date, start/end
// time, building, room, visibility (+ a member picker for "Selected members").
export function ComposeEventModal({
  userId,
  onClose,
  onCreated,
  presetClubId,
  editEventId,
}: {
  userId: string;
  onClose: () => void;
  onCreated: () => void;
  /** Locks the host club (e.g. creating from a Club Profile). */
  presetClubId?: string;
  /** When set, the modal edits this existing event instead of creating one. */
  editEventId?: string;
}): JSX.Element {
  const show = useToast();
  const isEdit = !!editEventId;
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: officerClubs } = useOfficerClubs(userId);
  const create = useCreateEvent(userId);
  const update = useUpdateEvent(userId);
  const { data: editing } = useEventForEdit(editEventId);

  const [clubId, setClubId] = useState(presetClubId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [existingCover, setExistingCover] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [about, setAbout] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [building, setBuilding] = useState("");
  const [room, setRoom] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("everyone");
  const [memberQuery, setMemberQuery] = useState("");
  const [members, setMembers] = useState<{ id: string; username: string; full_name: string; avatar_url: string | null }[]>([]);
  const [seeded, setSeeded] = useState(false);

  const { data: results, isLoading: isSearchingMembers, isError: memberSearchError } = useMemberSearch(userId, clubId || undefined, memberQuery);

  // Prefill once from the existing event (edit mode); never clobber officer edits
  // on a refetch, and never reset fields the officer hasn't touched.
  useEffect(() => {
    if (!isEdit || seeded || !editing) return;
    setClubId(editing.club_id);
    setTitle(editing.title);
    setAbout(editing.description ?? "");
    setDate(editing.event_date);
    setStart(editing.start_time.slice(0, 5));
    setEnd(editing.end_time.slice(0, 5));
    setBuilding(editing.building ?? "");
    setRoom(editing.room ?? "");
    setVisibility(editing.visibility);
    setMembers(editing.specific_members);
    setExistingCover(editing.cover_image_url);
    setSeeded(true);
  }, [isEdit, seeded, editing]);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      show("Please choose an image file.", "error");
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  // In edit mode the cover already exists, so a new file isn't required.
  const valid =
    !!clubId &&
    (isEdit ? !!existingCover || !!file : !!file) &&
    title.trim() &&
    about.trim() &&
    date &&
    start &&
    end &&
    building.trim() &&
    room.trim() &&
    (visibility !== "specific" || members.length > 0);

  const pending = create.isPending || update.isPending;

  const submit = async () => {
    if (!valid) return;
    const specific = visibility === "specific" ? members.map((m) => m.id) : [];

    if (isEdit && editEventId) {
      try {
        // Only upload a new cover if the officer picked one; otherwise keep it.
        const coverUrl = file ? await uploadToBucket("posts", `${userId}/events/${Date.now()}.jpg`, file) : undefined;
        update.mutate(
          {
            eventId: editEventId,
            updates: {
              title: title.trim(),
              description: about.trim(),
              event_date: date,
              start_time: `${start}:00`,
              end_time: `${end}:00`,
              building: building.trim() || null,
              room: room.trim() || null,
              visibility,
              specific_user_ids: visibility === "specific" && specific.length ? specific : null,
              ...(coverUrl ? { cover_image_url: coverUrl } : {}),
            },
          },
          {
            onSuccess: () => {
              show("Event updated ✓");
              onCreated();
            },
            onError: (e: any) =>
              show(e?.message === "Only club officers can edit events" ? "Only club officers can edit events." : "Could not update event.", "error"),
          }
        );
      } catch {
        show("Could not upload the new cover image.", "error");
      }
      return;
    }

    if (!file) return;
    create.mutate(
      {
        file,
        club_id: clubId,
        title: title.trim(),
        description: about.trim(),
        event_date: date,
        start_time: start,
        end_time: end,
        building: building.trim(),
        room: room.trim(),
        visibility,
        specific_user_ids: specific,
      },
      {
        onSuccess: () => {
          show("Event posted! 🎉");
          onCreated();
        },
        onError: (e: any) =>
          show(e?.message === "Only club officers can create events" ? "Only club officers can create events." : "Failed to create event.", "error"),
      }
    );
  };

  const inputCls = "w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2";
  const inputStyle = { borderColor: "#E5E7EB" };

  return (
    <Modal onClose={onClose} labelledBy="compose-event-title" maxWidth={560}>
      <div className="max-h-[80vh] overflow-y-auto p-5 sm:p-6">
        <h2 id="compose-event-title" className="mb-4 text-center text-lg font-bold text-gray-900">
          {isEdit ? "Edit event" : "New Glue"}
        </h2>

        <label className="mb-1 block text-sm font-semibold text-gray-700">Hosting as</label>
        <select
          value={clubId}
          onChange={(e) => {
            const nextClubId = e.target.value;
            setClubId(nextClubId);
            // A recipient is valid only for the currently selected host club.
            setMembers([]);
            setMemberQuery("");
          }}
          disabled={!!presetClubId}
          className={`${inputCls} mb-4 disabled:opacity-70`}
          style={inputStyle}
        >
          <option value="">Select a club…</option>
          {(officerClubs ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {!presetClubId && (officerClubs ?? []).length === 0 && (
          <p className="mb-4 -mt-2 text-xs text-gray-400">You must be a club officer to create an event.</p>
        )}

        {preview || (isEdit && existingCover) ? (
          <div className="relative mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={(preview ?? existingCover) as string} alt="preview" className="w-full rounded-xl object-cover" style={{ maxHeight: 240 }} />
            {preview ? (
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setPreview(null);
                }}
                aria-label="Remove image"
                className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white"
              >
                <CloseIcon size={16} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="absolute bottom-2 right-2 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white"
              >
                Change image
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mb-4 flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed"
            style={{ borderColor: "#E5E7EB", color: "#9CA3AF" }}
          >
            <ImageIcon size={32} />
            <span className="text-sm">Add an event image</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

        <label className="mb-1 block text-sm font-semibold text-gray-700">Event name</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputCls} mb-4`} style={inputStyle} placeholder="Name your event" />

        <label className="mb-1 block text-sm font-semibold text-gray-700">Description</label>
        <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} className={`${inputCls} mb-4 resize-none`} style={inputStyle} placeholder="What's it about?" />

        <div className="mb-4 grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} style={inputStyle} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Start</label>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} style={inputStyle} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">End</label>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} style={inputStyle} />
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Building</label>
            <input value={building} onChange={(e) => setBuilding(e.target.value)} className={inputCls} style={inputStyle} placeholder="F" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Room</label>
            <input value={room} onChange={(e) => setRoom(e.target.value)} className={inputCls} style={inputStyle} placeholder="313" />
          </div>
        </div>

        <label className="mb-1 block text-sm font-semibold text-gray-700">Who can see it</label>
        <div className="mb-4 space-y-2">
          {VIS.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => setVisibility(v.value)}
              className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left"
              style={{ borderColor: visibility === v.value ? "#0FA6A6" : "#E5E7EB" }}
            >
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2"
                style={{ borderColor: visibility === v.value ? "#0FA6A6" : "#9CA3AF" }}
              >
                {visibility === v.value && <span className="h-2 w-2 rounded-full" style={{ background: "#0FA6A6" }} />}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium text-gray-900">{v.label}</span>
                <span className="block text-xs text-gray-400">{v.desc}</span>
              </span>
            </button>
          ))}
        </div>

        {visibility === "specific" && (
          <div className="mb-4">
            {members.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {members.map((m) => (
                  <span key={m.id} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-white" style={{ background: "#0FA6A6" }}>
                    @{m.username}
                    <button type="button" onClick={() => setMembers((prev) => prev.filter((x) => x.id !== m.id))} aria-label={`Remove ${m.username}`}>
                      <CloseIcon size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              placeholder={clubId ? "Search current club members…" : "Choose a host club first"}
              disabled={!clubId}
              aria-controls="selected-event-member-results"
              aria-autocomplete="list"
              className={inputCls}
              style={inputStyle}
            />
            {!clubId ? (
              <p className="mt-1 text-xs text-gray-500">Choose a host club to search its current members.</p>
            ) : isSearchingMembers ? (
              <p className="mt-1 text-xs text-gray-500" role="status">Searching current club members…</p>
            ) : memberSearchError ? (
              <p className="mt-1 text-xs text-red-600" role="alert">We couldn&apos;t search club members. Try again.</p>
            ) : (results ?? []).filter((r) => !members.some((m) => m.id === r.id)).length === 0 ? (
              <p className="mt-1 text-xs text-gray-500">No eligible current club members match that search.</p>
            ) : (
              <div id="selected-event-member-results" role="listbox" aria-label="Matching current club members" className="mt-1 max-h-40 space-y-1 overflow-y-auto">
                {(results ?? []).filter((r) => !members.some((m) => m.id === r.id)).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      if (!members.some((m) => m.id === r.id)) setMembers((prev) => [...prev, r]);
                      setMemberQuery("");
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-gray-50"
                  >
                    <Avatar uri={r.avatar_url} size={28} name={r.username} />
                    <span className="min-w-0 text-left">
                      <span className="block truncate text-sm text-gray-900">{r.full_name || r.username}</span>
                      <span className="block truncate text-xs text-gray-500">@{r.username}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!valid || pending}
          className="w-full rounded-full py-3 text-[15px] font-semibold text-white disabled:opacity-50"
          style={{ background: "#0FA6A6" }}
        >
          {pending ? (isEdit ? "Saving…" : "Posting…") : isEdit ? "Save changes" : "Post event"}
        </button>
      </div>
    </Modal>
  );
}
