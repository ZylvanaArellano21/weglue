"use client";

import { useRef, useState } from "react";
import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { PlusIcon, CloseIcon } from "../shared/icons";
import { useToast } from "../shared/Toast";
import { useUpdateClub } from "../../lib/hooks/useClubManagement";
import { uploadToBucket } from "../../lib/imageUpload";
import type { ClubProfileData } from "../../lib/clubs/clubProfileService";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function toTimeInput(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}
function fromTimeInput(t: string): string | null {
  return t ? `${t}:00` : null;
}

// Officer-only Edit Club (spec §14/§20): banner, avatar, name, description,
// learning outcomes and a single meeting slot. Saves through the same
// updateClubProfile / updateClubGoals writes as mobile (RLS-guarded). Editing the
// legacy day/time fields clears any multi-day meeting_schedule JSONB so the
// simple slot is what renders (multi-day editing remains a mobile-only feature).
export function EditClubModal({
  club,
  userId,
  onClose,
}: {
  club: ClubProfileData;
  userId: string;
  onClose: () => void;
}): JSX.Element {
  const show = useToast();
  const update = useUpdateClub(club.id, userId);

  const [name, setName] = useState(club.name);
  const [description, setDescription] = useState(club.description ?? "");
  const [goals, setGoals] = useState<string[]>(club.goals.map((g) => g.goal_text).concat(""));
  const [day, setDay] = useState(club.meeting_day ?? "");
  const [start, setStart] = useState(toTimeInput(club.meeting_time_start));
  const [end, setEnd] = useState(toTimeInput(club.meeting_time_end));
  const [building, setBuilding] = useState(club.meeting_building ?? "");
  const [room, setRoom] = useState(club.meeting_room ?? "");

  const [bannerUrl, setBannerUrl] = useState(club.banner_url);
  const [avatarUrl, setAvatarUrl] = useState(club.avatar_url);
  const [uploading, setUploading] = useState<"banner" | "avatar" | null>(null);

  const bannerInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  const setGoal = (i: number, val: string) => {
    const next = [...goals];
    next[i] = val;
    // keep exactly one trailing empty row to add more
    if (i === goals.length - 1 && val.trim() !== "") next.push("");
    setGoals(next);
  };
  const removeGoal = (i: number) => setGoals(goals.filter((_, idx) => idx !== i));

  const handleUpload = async (kind: "banner" | "avatar", file: File | undefined) => {
    if (!file) return;
    setUploading(kind);
    try {
      const bucket = kind === "banner" ? "club-covers" : "club-avatars";
      const url = await uploadToBucket(bucket, `${club.id}/${Date.now()}.jpg`, file, kind === "banner" ? 1600 : 800);
      if (kind === "banner") setBannerUrl(url);
      else setAvatarUrl(url);
    } catch {
      show(`Could not upload ${kind}. Try again.`, "error");
    } finally {
      setUploading(null);
    }
  };

  const save = () => {
    if (name.trim() === "") {
      show("Club name can't be empty.", "error");
      return;
    }
    update.mutate(
      {
        profile: {
          name: name.trim(),
          description: description.trim(),
          avatar_url: avatarUrl ?? undefined,
          banner_url: bannerUrl ?? undefined,
          meeting_day: day || null,
          meeting_time_start: fromTimeInput(start),
          meeting_time_end: fromTimeInput(end),
          meeting_building: building.trim() || null,
          meeting_room: room.trim() || null,
          meeting_schedule: null,
        },
        goals,
      },
      {
        onSuccess: () => {
          show("Club updated ✓");
          onClose();
        },
        onError: () => show("Could not save changes. Try again.", "error"),
      }
    );
  };

  return (
    <Modal onClose={onClose} labelledBy="edit-club-title" maxWidth={620}>
      <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-6">
        <h2 id="edit-club-title" className="mb-4 text-xl font-bold text-gray-900">Edit Club</h2>

        {/* Banner */}
        <div className="relative mb-14 h-36 w-full overflow-hidden rounded-xl bg-gray-200">
          {bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bannerUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full" style={{ background: "linear-gradient(135deg,#0FA6A6,#0b7d7d)" }} />
          )}
          <button
            type="button"
            onClick={() => bannerInput.current?.click()}
            className="absolute bottom-2 right-2 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white"
          >
            {uploading === "banner" ? "Uploading…" : "Change banner"}
          </button>
          <input
            ref={bannerInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleUpload("banner", e.target.files?.[0])}
          />

          {/* Avatar overlaps */}
          <div className="absolute -bottom-11 left-4">
            <button type="button" onClick={() => avatarInput.current?.click()} className="relative block rounded-full border-4 border-white">
              <Avatar uri={avatarUrl} size={80} name={name} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/35 text-[11px] font-semibold text-white opacity-0 transition hover:opacity-100">
                {uploading === "avatar" ? "…" : "Change"}
              </span>
            </button>
            <input
              ref={avatarInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleUpload("avatar", e.target.files?.[0])}
            />
          </div>
        </div>

        <Field label="Club name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} maxLength={80} />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={inputClass}
            maxLength={300}
          />
        </Field>

        <Field label="Learning outcomes">
          <div className="space-y-2">
            {goals.map((goal, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={goal}
                  onChange={(e) => setGoal(i, e.target.value)}
                  placeholder={i === goals.length - 1 ? "Add another outcome…" : `Outcome ${i + 1}`}
                  className={inputClass}
                />
                {goals.length > 1 && i < goals.length - 1 && (
                  <button type="button" onClick={() => removeGoal(i)} aria-label="Remove outcome" className="shrink-0 text-gray-400 hover:text-gray-700">
                    <CloseIcon size={18} />
                  </button>
                )}
                {i === goals.length - 1 && (
                  <span className="shrink-0 text-teal" aria-hidden><PlusIcon size={18} /></span>
                )}
              </div>
            ))}
          </div>
        </Field>

        <Field label="Meeting schedule">
          <div className="grid grid-cols-2 gap-2">
            <select value={day} onChange={(e) => setDay(e.target.value)} className={`${inputClass} col-span-2`}>
              <option value="">No set day</option>
              {DAYS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <label className="text-xs text-gray-500">
              Start
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
            </label>
            <label className="text-xs text-gray-500">
              End
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
            </label>
            <input value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="Building" className={inputClass} />
            <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room" className={inputClass} />
          </div>
        </Field>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-full px-5 py-2 text-sm font-semibold text-gray-600 hover:bg-black/5">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={update.isPending || uploading !== null}
            className="rounded-full bg-teal px-6 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2";

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-4">
      <label className="text-sm font-semibold text-gray-800">{label}</label>
      {children}
    </div>
  );
}
