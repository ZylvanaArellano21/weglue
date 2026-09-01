"use client";

import { useRef, useState } from "react";
import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { PlusIcon, CloseIcon, CloseCircleIcon, PencilIcon, TrashIcon, PersonAddIcon } from "../shared/icons";
import { useToast } from "../shared/Toast";
import {
  useUpdateClub,
  useManageClubPhoto,
  useAddOfficer,
  useRemoveOfficer,
  useUniversityUserSearch,
} from "../../lib/hooks/useClubManagement";
import type { UniversityUser } from "../../lib/clubs/clubManagement";
import { useDeleteEvent } from "../../lib/hooks/useEventDetail";
import { ClubPhotoRemovalDialog } from "./ClubPhotoRemoval";
import type { ClubPhotoRemovalPlan } from "../../lib/clubs/clubPhotoRemoval";
import { uploadToBucket } from "../../lib/imageUpload";
import { parseMeetingSchedule, WEEK_DAYS, type MeetingSlot } from "../../lib/datetime";
import type { ClubProfileData, ClubPhoto, ClubEvent, ClubOfficer } from "../../lib/clubs/clubProfileService";

const DEFAULT_START = "15:00:00";
const DEFAULT_END = "16:00:00";

function toTimeInput(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}
function fromTimeInput(t: string): string | null {
  return t ? `${t}:00` : null;
}

// Officer-only Edit Club — a 1:1 port of apps/mobile/app/club/[clubId]/edit.tsx:
// same sections in the same order (Club Banner, Profile Picture, Club Name,
// About, Learning Outcomes, Meeting Schedule, Upcoming Events, Past Events,
// Photos that Glue, Officers), same copy, same confirmations, and the same
// multi-day meeting_schedule editor and inline event/officer management
// native has that this modal previously lacked entirely (both were only
// reachable elsewhere on web, if at all). Every write goes through the same
// RPCs/writes mobile uses.
export function EditClubModal({
  club,
  userId,
  onClose,
  onEditEvent,
}: {
  club: ClubProfileData;
  userId: string;
  onClose: () => void;
  /** Pencil on an upcoming event — closes this modal and opens the shared
   * event editor, mirroring mobile's navigate-away-to-edit. */
  onEditEvent: (eventId: string) => void;
}): JSX.Element {
  const show = useToast();
  const update = useUpdateClub(club.id, userId);
  const photoManage = useManageClubPhoto(club.id, userId);
  const addOfficerMutation = useAddOfficer(club.id, userId);
  const removeOfficerMutation = useRemoveOfficer(club.id, userId);
  const deleteEventMutation = useDeleteEvent(userId);

  const [removingPhoto, setRemovingPhoto] = useState<ClubPhoto | null>(null);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<string[]>([]);
  const photos = club.photos.filter((p) => !removedPhotoIds.includes(p.id));

  const [name, setName] = useState(club.name);
  const [description, setDescription] = useState(club.description ?? "");
  const [goals, setGoals] = useState<string[]>(club.goals.map((g) => g.goal_text).concat(""));
  const [schedule, setSchedule] = useState<MeetingSlot[]>(
    parseMeetingSchedule(club.meeting_schedule, club.meeting_day, club.meeting_time_start, club.meeting_time_end)
  );
  const [building, setBuilding] = useState(club.meeting_building ?? "");
  const [room, setRoom] = useState(club.meeting_room ?? "");

  const [bannerUrl, setBannerUrl] = useState(club.banner_url);
  const [avatarUrl, setAvatarUrl] = useState(club.avatar_url);
  const [uploading, setUploading] = useState<"banner" | "avatar" | null>(null);

  const [events, setEvents] = useState<ClubEvent[]>(club.upcoming_events);
  const [pastEvents, setPastEvents] = useState<ClubEvent[]>(club.past_events);
  const [deletingEvent, setDeletingEvent] = useState<ClubEvent | null>(null);

  const [officers, setOfficers] = useState<ClubOfficer[]>(club.officers);
  const [removingOfficer, setRemovingOfficer] = useState<ClubOfficer | null>(null);

  const [addOfficerOpen, setAddOfficerOpen] = useState(false);
  const [officerQuery, setOfficerQuery] = useState("");
  const [pickedOfficer, setPickedOfficer] = useState<UniversityUser | null>(null);
  const [roleTitle, setRoleTitle] = useState("");
  const [roleError, setRoleError] = useState<string | null>(null);
  const searching = officerQuery.trim().length >= 3;
  const { data: officerResults } = useUniversityUserSearch(userId, officerQuery.trim(), searching);
  const existingOfficerIds = new Set(officers.map((o) => o.user_id).filter(Boolean));

  const bannerInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  const setGoal = (i: number, val: string) => {
    const next = [...goals];
    next[i] = val;
    if (i === goals.length - 1 && val.trim() !== "") next.push("");
    setGoals(next);
  };
  const removeGoal = (i: number) => setGoals(goals.filter((_, idx) => idx !== i));
  const addOutcomeRow = () => {
    const last = goals[goals.length - 1];
    if (last?.trim()) setGoals([...goals, ""]);
  };

  const selectedDays = new Set(schedule.map((s) => s.day));
  const toggleDay = (day: string) => {
    if (selectedDays.has(day)) {
      setSchedule(schedule.filter((s) => s.day !== day));
    } else {
      const template = schedule[schedule.length - 1];
      const next = [...schedule, { day, start: template?.start ?? DEFAULT_START, end: template?.end ?? DEFAULT_END }];
      next.sort((a, b) => WEEK_DAYS.indexOf(a.day as (typeof WEEK_DAYS)[number]) - WEEK_DAYS.indexOf(b.day as (typeof WEEK_DAYS)[number]));
      setSchedule(next);
    }
  };
  const setSlotTime = (day: string, field: "start" | "end", value: string) => {
    setSchedule(schedule.map((s) => (s.day === day ? { ...s, [field]: fromTimeInput(value) } : s)));
  };

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

  const confirmPhotoRemoval = (photo: ClubPhoto, plan: ClubPhotoRemovalPlan) => {
    const done = () => {
      setRemovedPhotoIds((prev) => [...prev, photo.id]);
      setRemovingPhoto(null);
      show(plan.successMessage);
    };
    const failed = () => {
      setRemovingPhoto(null);
      show(plan.errorMessage, "error");
    };
    if (plan.kind === "remove_post_from_club") {
      photoManage.removePost.mutate(photo.post_id!, { onSuccess: done, onError: failed });
    } else if (plan.kind === "delete_club_post") {
      photoManage.deleteClubPost.mutate(photo.post_id!, { onSuccess: done, onError: failed });
    } else {
      photoManage.deleteUpload.mutate(photo.id, { onSuccess: done, onError: failed });
    }
  };

  const doDeleteEvent = (event: ClubEvent) => {
    setDeletingEvent(null);
    deleteEventMutation.mutate(event.id, {
      onSuccess: () => {
        setEvents((prev) => prev.filter((e) => e.id !== event.id));
        setPastEvents((prev) => prev.filter((e) => e.id !== event.id));
        show("Event deleted.");
      },
      onError: () => show("Could not delete the event. Try again.", "error"),
    });
  };

  const doRemoveOfficer = (officer: ClubOfficer) => {
    setRemovingOfficer(null);
    if (!officer.user_id) return;
    removeOfficerMutation.mutate(officer.user_id, {
      onSuccess: () => {
        setOfficers((prev) => prev.filter((o) => o.id !== officer.id));
        show(`${officer.display_name} removed`);
      },
      onError: () => show("Could not remove officer. Try again.", "error"),
    });
  };

  const resetAddOfficer = () => {
    setAddOfficerOpen(false);
    setOfficerQuery("");
    setPickedOfficer(null);
    setRoleTitle("");
    setRoleError(null);
  };

  const doAddOfficer = () => {
    if (!pickedOfficer) return;
    const title = roleTitle.trim();
    if (title.length < 2) {
      setRoleError("Role must be at least 2 characters.");
      return;
    }
    addOfficerMutation.mutate(
      { targetUserId: pickedOfficer.id, roleTitle: title },
      {
        onSuccess: () => {
          setOfficers((prev) => {
            if (prev.some((o) => o.user_id === pickedOfficer.id)) {
              return prev.map((o) => (o.user_id === pickedOfficer.id ? { ...o, role_title: title } : o));
            }
            return [
              ...prev,
              {
                id: `pending-${pickedOfficer.id}`,
                user_id: pickedOfficer.id,
                display_name: pickedOfficer.full_name || pickedOfficer.username,
                role_title: title,
                avatar_url: pickedOfficer.avatar_url,
              },
            ];
          });
          show(`${pickedOfficer.full_name || pickedOfficer.username} is now ${title}! 🎉`);
          resetAddOfficer();
        },
        onError: () => show("Could not add officer. Try again.", "error"),
      }
    );
  };

  const save = () => {
    if (name.trim() === "") {
      show("Club name can't be empty.", "error");
      return;
    }
    const firstSlot = schedule[0] ?? null;
    update.mutate(
      {
        profile: {
          name: name.trim(),
          description: description.trim(),
          avatar_url: avatarUrl ?? undefined,
          banner_url: bannerUrl ?? undefined,
          meeting_day: firstSlot?.day ?? null,
          meeting_time_start: firstSlot?.start ?? null,
          meeting_time_end: firstSlot?.end ?? null,
          meeting_building: building.trim() || null,
          meeting_room: room.trim() || null,
          meeting_schedule: schedule.length > 0 ? schedule : null,
        },
        goals,
      },
      {
        onSuccess: () => {
          show("Club saved!");
          onClose();
        },
        onError: () => show("Could not save changes. Try again.", "error"),
      }
    );
  };

  return (
    <Modal onClose={onClose} labelledBy="edit-club-title" maxWidth={620}>
      <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-6">
        {/* Header — matches native's exactly: back/close (Modal's own X),
            "Edit Club" title, a compact teal Save pill, no separate
            Cancel/Save row at the bottom the way this modal used to have. */}
        <div className="mb-5 flex items-center justify-between">
          <h2 id="edit-club-title" className="text-xl font-bold text-gray-900">Edit Club</h2>
          <button
            type="button"
            onClick={save}
            disabled={update.isPending || uploading !== null}
            className="rounded-full bg-teal px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {update.isPending ? "Saving…" : "Save"}
          </button>
        </div>

        {/* Club Banner */}
        <SectionLabel>Club Banner</SectionLabel>
        <div className="relative mb-4 h-36 w-full overflow-hidden rounded-xl bg-gray-200">
          {bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bannerUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
          <button
            type="button"
            onClick={() => bannerInput.current?.click()}
            aria-label="Change club banner"
            className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white"
          >
            {uploading === "banner" ? "…" : <CameraGlyph />}
          </button>
          <input ref={bannerInput} type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload("banner", e.target.files?.[0])} />
        </div>

        {/* Profile Picture */}
        <SectionLabel>Profile Picture</SectionLabel>
        <div className="mb-4">
          <button type="button" onClick={() => avatarInput.current?.click()} className="relative block">
            <Avatar uri={avatarUrl} size={80} name={name} />
            <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border-2 text-white" style={{ background: "#0FA6A6", borderColor: "#FEFCF0" }}>
              {uploading === "avatar" ? "…" : <PencilIcon size={12} />}
            </span>
          </button>
          <input ref={avatarInput} type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload("avatar", e.target.files?.[0])} />
        </div>

        {/* Club Name */}
        <SectionLabel>Club Name</SectionLabel>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Club name…" maxLength={80} className={`${inputClass} mb-4`} />

        {/* About */}
        <SectionLabel>About</SectionLabel>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe your club…"
          rows={4}
          maxLength={1000}
          className={`${inputClass} mb-4`}
        />

        {/* Learning Outcomes */}
        <SectionLabel>Learning Outcomes</SectionLabel>
        <div className="mb-2">
          {goals.map((goal, i) => {
            const isAddRow = i === goals.length - 1 && !goal.trim();
            const hasValue = goal.trim().length > 0;
            return (
              <div key={i} className="mb-2 flex items-center gap-2">
                <span
                  aria-hidden
                  className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px]"
                  style={hasValue ? { background: "#0FA6A6" } : { border: "1.5px solid #0FA6A6" }}
                >
                  {hasValue && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FEFCF0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  )}
                </span>
                <input
                  value={goal}
                  onChange={(e) => setGoal(i, e.target.value)}
                  placeholder={isAddRow ? "Add another outcome…" : `Outcome ${i + 1}…`}
                  maxLength={200}
                  className={`${inputClass} flex-1 py-2.5`}
                />
                {!isAddRow ? (
                  <button type="button" onClick={() => removeGoal(i)} aria-label="Remove outcome" className="shrink-0 text-gray-400 hover:text-gray-700">
                    <CloseCircleIcon size={22} />
                  </button>
                ) : (
                  <span className="w-[22px]" />
                )}
              </div>
            );
          })}
        </div>
        <button type="button" onClick={addOutcomeRow} className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-teal">
          <PlusIcon size={16} /> Add another outcome
        </button>

        {/* Meeting Schedule — multiple days, each with its own start/end */}
        <SectionLabel>Meeting Schedule</SectionLabel>
        <p className="mb-1.5 text-[13px] font-medium text-gray-700">Days</p>
        <div className="mb-3.5 flex flex-wrap gap-2">
          {WEEK_DAYS.map((day) => {
            const selected = selectedDays.has(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className="rounded-full border-[1.5px] px-3.5 py-2 text-[13px] font-semibold transition"
                style={selected ? { borderColor: "#0FA6A6", background: "rgba(15,166,166,0.1)", color: "#0FA6A6" } : { borderColor: "#E5E7EB", background: "#fff", color: "#374151", fontWeight: 400 }}
              >
                {day.slice(0, 3)}
              </button>
            );
          })}
        </div>
        {schedule.length === 0 ? (
          <p className="mb-3.5 text-[13px] text-gray-400">Select the days your club meets.</p>
        ) : (
          <div className="mb-3.5 space-y-2.5">
            {schedule.map((slot) => (
              <div key={slot.day} className="flex items-center gap-2.5">
                <span className="w-[86px] shrink-0 text-sm font-semibold text-gray-900">{slot.day}</span>
                <input type="time" value={toTimeInput(slot.start)} onChange={(e) => setSlotTime(slot.day, "start", e.target.value)} className={`${inputClass} flex-1 py-2.5 text-center`} />
                <span className="text-sm text-gray-400">-</span>
                <input type="time" value={toTimeInput(slot.end)} onChange={(e) => setSlotTime(slot.day, "end", e.target.value)} className={`${inputClass} flex-1 py-2.5 text-center`} />
              </div>
            ))}
          </div>
        )}
        <Field label="Building">
          <input value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="e.g. Building F" className={inputClass} />
        </Field>
        <Field label="Room">
          <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. Room 219" className={inputClass} />
        </Field>

        {/* Upcoming Events — edit + delete */}
        {events.length > 0 && (
          <>
            <SectionLabel>Upcoming Events</SectionLabel>
            <div className="mb-4 space-y-2">
              {events.map((event) => (
                <EventRow key={event.id} event={event} onEdit={() => onEditEvent(event.id)} onDelete={() => setDeletingEvent(event)} />
              ))}
            </div>
          </>
        )}

        {/* Past Events — delete only */}
        {pastEvents.length > 0 && (
          <>
            <SectionLabel>Past Events</SectionLabel>
            <div className="mb-4 space-y-2">
              {pastEvents.map((event) => (
                <EventRow key={event.id} event={event} onDelete={() => setDeletingEvent(event)} />
              ))}
            </div>
          </>
        )}

        {/* Photos that Glue */}
        {photos.length > 0 && (
          <>
            <SectionLabel>Photos that Glue</SectionLabel>
            <div className="mb-4 grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-6">
              {photos.map((photo) => (
                <div key={photo.id} className="relative aspect-square overflow-hidden rounded-lg bg-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt={photo.caption ?? ""} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setRemovingPhoto(photo)}
                    aria-label={photo.source === "tagged_post" && photo.post_id ? `Remove this post from ${club.name}` : "Remove this photo"}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white"
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Officers */}
        <SectionLabel>Officers</SectionLabel>
        <div className="mb-1 space-y-2">
          {officers.map((officer) => (
            <div key={officer.id} className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm">
              <Avatar uri={officer.avatar_url} size={40} name={officer.display_name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{officer.display_name}</p>
                <p className="truncate text-xs text-teal">{officer.role_title}</p>
              </div>
              {officer.user_id !== userId && (
                <button
                  type="button"
                  onClick={() => setRemovingOfficer(officer)}
                  className="shrink-0 rounded-full border-[1.5px] px-3 py-1.5 text-[13px] font-medium"
                  style={{ borderColor: "#F02719", color: "#F02719" }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        {addOfficerOpen ? (
          <div className="mb-5 mt-3 rounded-xl border border-gray-200 p-3">
            {!pickedOfficer ? (
              <>
                <input
                  autoFocus
                  value={officerQuery}
                  onChange={(e) => setOfficerQuery(e.target.value)}
                  placeholder="Search people at your school…"
                  className={`${inputClass} mb-2`}
                />
                {searching && (
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {(officerResults ?? []).map((u) => {
                      const already = existingOfficerIds.has(u.id);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          disabled={already}
                          onClick={() => { setPickedOfficer(u); setRoleTitle(""); setRoleError(null); }}
                          className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-black/[0.03] disabled:opacity-50"
                        >
                          <Avatar uri={u.avatar_url} size={32} name={u.full_name || u.username} />
                          <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{u.full_name || u.username}</span>
                          {already && <span className="text-xs text-gray-400">Already an officer</span>}
                        </button>
                      );
                    })}
                    {(officerResults ?? []).length === 0 && <p className="p-2 text-sm text-gray-400">No matches</p>}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-2.5">
                  <Avatar uri={pickedOfficer.avatar_url} size={36} name={pickedOfficer.full_name || pickedOfficer.username} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{pickedOfficer.full_name}</p>
                    <p className="truncate text-xs text-gray-400">@{pickedOfficer.username}</p>
                  </div>
                  <button type="button" onClick={() => setPickedOfficer(null)} className="shrink-0 text-sm font-semibold text-teal">Change</button>
                </div>
                <p className="mb-1.5 text-[13px] font-medium text-gray-700">Role</p>
                <input
                  autoFocus
                  value={roleTitle}
                  onChange={(e) => { setRoleTitle(e.target.value); setRoleError(null); }}
                  placeholder="President, Vice President, Treasurer…"
                  className={inputClass}
                />
                {roleError && <p className="mt-1 text-xs" style={{ color: "#F02719" }}>{roleError}</p>}
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={doAddOfficer} disabled={addOfficerMutation.isPending} className="rounded-full bg-teal px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
                    {addOfficerMutation.isPending ? "…" : "Add"}
                  </button>
                  <button type="button" onClick={resetAddOfficer} className="text-sm text-gray-500 hover:underline">Cancel</button>
                </div>
              </>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddOfficerOpen(true)}
            className="mb-2 mt-1 flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] p-3"
            style={{ borderColor: "#0FA6A6" }}
          >
            <PersonAddIcon size={18} />
            <span className="text-sm font-semibold text-teal">Add Officer</span>
          </button>
        )}
      </div>

      {removingPhoto && (
        <ClubPhotoRemovalDialog
          photo={removingPhoto}
          clubName={club.name}
          pending={photoManage.removePost.isPending || photoManage.deleteUpload.isPending}
          onConfirm={(plan) => confirmPhotoRemoval(removingPhoto, plan)}
          onCancel={() => setRemovingPhoto(null)}
        />
      )}
      {deletingEvent && (
        <ConfirmDialog
          title="Delete this event?"
          message={`"${deletingEvent.title}" will be permanently removed for everyone — club profile, Home, Calendar, Weekly Events, and all RSVPs. Chats where it was shared will show "This event is no longer available."`}
          confirmLabel="Delete"
          destructive
          loading={deleteEventMutation.isPending}
          onConfirm={() => doDeleteEvent(deletingEvent)}
          onCancel={() => setDeletingEvent(null)}
        />
      )}
      {removingOfficer && (
        <ConfirmDialog
          title={`Remove ${removingOfficer.display_name}?`}
          message="They will be downgraded to a regular member."
          confirmLabel="Remove"
          destructive
          loading={removeOfficerMutation.isPending}
          onConfirm={() => doRemoveOfficer(removingOfficer)}
          onCancel={() => setRemovingOfficer(null)}
        />
      )}
    </Modal>
  );
}

const inputClass =
  "w-full rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-[15px] text-gray-900 outline-none focus:ring-2 focus:ring-teal placeholder:text-gray-400";

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="mb-2.5 mt-7 text-[13px] font-bold uppercase tracking-wide text-gray-400 first:mt-0">{children}</p>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-3.5">
      <p className="mb-1.5 text-[13px] font-medium text-gray-700">{label}</p>
      {children}
    </div>
  );
}

function EventRow({ event, onEdit, onDelete }: { event: ClubEvent; onEdit?: () => void; onDelete: () => void }): JSX.Element {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-white p-3 shadow-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900">{event.emoji ? `${event.emoji} ` : ""}{event.title}</p>
        <p className="mt-0.5 text-xs text-gray-400">{event.event_date}</p>
      </div>
      {onEdit && (
        <button type="button" onClick={onEdit} aria-label={`Edit ${event.title}`} className="shrink-0 p-1.5 text-gray-500 hover:text-gray-700">
          <PencilIcon size={18} />
        </button>
      )}
      <button type="button" onClick={onDelete} aria-label={`Delete ${event.title}`} className="shrink-0 p-1.5" style={{ color: "#F02719" }}>
        <TrashIcon size={18} />
      </button>
    </div>
  );
}

function CameraGlyph(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
