"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ToastProvider, useToast } from "../shared/Toast";
import { AppHeader } from "../home/AppHeader";
import { EventDetailModal } from "../home/EventDetailModal";
import { ComposeEventModal } from "../home/ComposeEventModal";
import { ComposePostModal } from "../home/ComposePostModal";
import { ClubMediaOverlay } from "./ClubMediaOverlay";
import { ClubProfileHeader, type ClubTab } from "./ClubProfileHeader";
import { ClubRightColumn } from "./ClubRightColumn";
import { ClubHomeTab } from "./ClubHomeTab";
import { ClubCalendarTab } from "./ClubCalendarTab";
import { ClubOfficersTab } from "./ClubOfficersTab";
import { ClubMediaTab } from "./ClubMediaTab";
import { AttendanceListModal } from "../home/AttendanceListModal";
import { LeaveClubDialog } from "./LeaveClubDialog";
import { EditClubModal } from "./EditClubModal";
import { ManageClubModal } from "./ManageClubModal";
import { useUnreadSummary } from "../../lib/hooks/useUnreadSummary";
import { useRealtimeNotifications } from "../../lib/hooks/useNotifications";
import { useClubRealtime } from "../../lib/hooks/useClubRealtime";
import { useClubProfile, useToggleClubMembership, OnlyOfficerError, clubProfileKey } from "../../lib/hooks/useClubProfile";
import { useClubEventsFeed, clubEventsFeedKey } from "../../lib/hooks/useClubEventsFeed";
import { useManageClubPhoto } from "../../lib/hooks/useClubManagement";
import { useRsvpToEvent, useToggleSaveEvent } from "../../lib/hooks/useHomeEventsFeed";
import type { HomeFeedEvent } from "../../lib/hooks/useHomeEventsFeed";
import { eventRestrictionMessage } from "../../lib/permissions/eventAccess";
import { clubChannelHref, clubHubHref, personMessageHref } from "../../lib/messages/routes";
import { getMainConversationChannel, reopenClubConversation } from "../../lib/messages/service";

const TABS: ClubTab[] = ["home", "calendar", "officers", "media"];

// Local overlay state — calendar same-date cycling and the media overlay live
// OVER the current tab (no page navigation), so closing restores the exact tab,
// month, date and scroll (spec §16/§19). Media overlays carry the full photo so
// officers get moderation actions.
type Overlay =
  | { kind: "event"; list: HomeFeedEvent[]; index: number }
  | { kind: "media"; index: number }
  | null;

export function ClubProfileClient({ clubId, userId }: { clubId: string; userId: string }): JSX.Element {
  useUnreadSummary(userId);
  useRealtimeNotifications(userId);
  useClubRealtime(clubId, userId);

  return (
    <ToastProvider>
      <div className="min-h-screen bg-cream">
        <AppHeader userId={userId} />
        <Body clubId={clubId} userId={userId} />
      </div>
    </ToastProvider>
  );
}

function Body({ clubId, userId }: { clubId: string; userId: string }): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const show = useToast();

  const queryClient = useQueryClient();
  const { data: club, isLoading } = useClubProfile(clubId, userId);
  const { data: feed } = useClubEventsFeed(clubId, userId);
  const membership = useToggleClubMembership(clubId, userId);
  const { mutate: rsvp } = useRsvpToEvent();
  const { mutate: toggleSave } = useToggleSaveEvent();
  const photoManage = useManageClubPhoto(clubId, userId);

  const tabParam = searchParams.get("tab");
  const activeTab: ClubTab = (TABS as string[]).includes(tabParam ?? "") ? (tabParam as ClubTab) : "home";

  const [overlay, setOverlay] = useState<Overlay>(null);
  const [editing, setEditing] = useState(false);
  const [managing, setManaging] = useState(false);
  const [compose, setCompose] = useState<"event" | "post" | null>(null);
  const [editEventId, setEditEventId] = useState<string | null>(null);
  const [attendanceEventId, setAttendanceEventId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const invalidateClubContent = () => {
    void queryClient.invalidateQueries({ queryKey: clubProfileKey(clubId, userId) });
    void queryClient.invalidateQueries({ queryKey: clubEventsFeedKey(clubId, userId) });
    void queryClient.invalidateQueries({ queryKey: ["clubPhotoFeed", clubId] });
  };

  const upcoming = feed?.upcoming ?? [];
  const past = feed?.past ?? [];
  const allEvents = useMemo(() => [...upcoming, ...past], [upcoming, past]);

  const setTab = (tab: ClubTab) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (tab === "home") sp.delete("tab");
    else sp.set("tab", tab);
    const qs = sp.toString();
    router.push(qs ? `/club/${clubId}?${qs}` : `/club/${clubId}`, { scroll: false });
  };

  const openSingleEvent = (eventId: string) => {
    const ev = allEvents.find((e) => e.id === eventId);
    if (ev) setOverlay({ kind: "event", list: [ev], index: 0 });
  };

  const handleRsvp = (eventId: string, previousStatus: "going" | "cant" | null) =>
    rsvp(
      { userId, eventId, status: "going", previousStatus },
      {
        onSuccess: () => show("RSVP updated 🎉"),
        onError: () => show("Failed to RSVP. Try again.", "error"),
      }
    );

  const handleSave = (eventId: string, isSaved: boolean) =>
    toggleSave(
      { userId, eventId, isSaved },
      {
        onSuccess: (saved) => show(saved ? "Event saved!" : "Removed from saved"),
        onError: () => show("Failed to save event.", "error"),
      }
    );

  const handleToggleMembership = () => {
    if (!club) return;
    if (club.is_member) { setLeaveOpen(true); return; }
    membership.mutate(
      { join: !club.is_member },
      {
        onSuccess: () => show(club.is_member ? "You left the club." : "Joined club! 🎉"),
        onError: (err) =>
          show(err instanceof OnlyOfficerError ? err.message : "Something went wrong. Try again.", "error"),
      }
    );
  };

  const openPhoto = (index: number) => {
    if (!club || !club.photos[index]) return;
    setOverlay({ kind: "media", index });
  };

  const openClubChat = async (type: "club_group" | "officer_chat") => {
    try {
      const conversationId = await reopenClubConversation(clubId, type);
      if (type === "club_group") {
        // The member-chat control represents the whole club chat; preserve the
        // channel navigator rather than silently choosing a recent thread.
        router.push(clubHubHref(conversationId));
        return;
      }
      const mainChannelId = await getMainConversationChannel(conversationId);
      router.push(mainChannelId ? clubChannelHref(conversationId, mainChannelId) : clubHubHref(conversationId));
    } catch {
      show("That chat isn’t available right now.", "error");
    }
  };

  if (isLoading) {
    return (
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="h-64 animate-pulse rounded-2xl bg-black/5" />
      </main>
    );
  }
  if (!club) {
    return (
      <main className="mx-auto max-w-[1400px] px-4 py-16 text-center sm:px-6">
        <p className="text-gray-500">This club is no longer available.</p>
        <button type="button" onClick={() => router.push("/clubs")} className="mt-4 text-sm font-semibold text-teal hover:underline">
          Back to Clubs
        </button>
      </main>
    );
  }

  const eventOverlay = overlay?.kind === "event" ? overlay.list[overlay.index] : null;

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left: header + tab content */}
        <div className="min-w-0">
          <ClubProfileHeader
            club={club}
            activeTab={activeTab}
            onSelectTab={setTab}
            onToggleMembership={handleToggleMembership}
            membershipPending={membership.isPending}
            onEdit={() => setEditing(true)}
            onOfficerChat={() => void openClubChat("officer_chat")}
            onGroupChat={() => void openClubChat("club_group")}
          />

          {activeTab === "home" && (
            <ClubHomeTab
              club={club}
              upcoming={upcoming}
              past={past}
              onRsvp={handleRsvp}
              onToggleSave={handleSave}
              onToggleClub={() => handleToggleMembership()}
              onOpenEvent={openSingleEvent}
              onOpenClub={() => {}}
              onOpenAttendees={setAttendanceEventId}
              onRestricted={() => show(eventRestrictionMessage("members_only", club.name) ?? "", "error")}
              onCreateEvent={club.is_officer ? () => setCompose("event") : undefined}
              onCreatePost={club.is_member ? () => setCompose("post") : undefined}
            />
          )}
          {activeTab === "calendar" && (
            <ClubCalendarTab
              events={allEvents}
              onOpenDate={(dateEvents) => setOverlay({ kind: "event", list: dateEvents, index: 0 })}
            />
          )}
          {activeTab === "officers" && (
            <ClubOfficersTab
              officers={club.officers}
              currentUserId={userId}
              canManage={club.is_officer}
              onManage={() => setManaging(true)}
              onOpenProfile={(id) => router.push(`/u/${id}`)}
              onMessage={(id) => router.push(personMessageHref(id))}
            />
          )}
          {activeTab === "media" && <ClubMediaTab photos={club.photos} onOpenPhoto={openPhoto} />}
        </div>

        {/* Right column — persistent across tabs */}
        <div className="min-w-0">
          <ClubRightColumn
            club={club}
            upcomingEvents={upcoming}
            onRsvp={handleRsvp}
            onOpenEvent={openSingleEvent}
            onOpenPhoto={(i) => {
              setTab("media");
              openPhoto(i);
            }}
            onSeeAllPhotos={() => setTab("media")}
            onRestricted={() => show(eventRestrictionMessage("members_only", club.name) ?? "", "error")}
          />
        </div>
      </div>

      {/* Overlays */}
      {eventOverlay && overlay?.kind === "event" && (
        <EventDetailModal
          key={`event-${eventOverlay.id}`}
          eventId={eventOverlay.id}
          userId={userId}
          onClose={() => setOverlay(null)}
          onOpenClub={(cid) => router.push(`/club/${cid}`)}
          onOpenAttendees={setAttendanceEventId}
          onPrev={overlay.list.length > 1 ? () => setOverlay({ ...overlay, index: (overlay.index - 1 + overlay.list.length) % overlay.list.length }) : undefined}
          onNext={overlay.list.length > 1 ? () => setOverlay({ ...overlay, index: (overlay.index + 1) % overlay.list.length }) : undefined}
          indicator={overlay.list.length > 1 ? `${overlay.index + 1} of ${overlay.list.length}` : undefined}
          onDeleted={() => setOverlay(null)}
          onEdit={(id) => {
            setOverlay(null);
            setEditEventId(id);
          }}
        />
      )}

      {attendanceEventId && <AttendanceListModal eventId={attendanceEventId} onClose={() => setAttendanceEventId(null)} />}
      {leaveOpen && <LeaveClubDialog clubId={clubId} clubName={club.name} userId={userId} onClose={() => setLeaveOpen(false)} onLeft={() => show("You left the club.")} onError={(message) => show(message, "error")} />}

      {overlay?.kind === "media" && (
        <ClubMediaOverlay
          photos={club.photos}
          initialIndex={overlay.index}
          userId={userId}
          clubId={clubId}
          isOfficer={club.is_officer}
          onClose={() => setOverlay(null)}
          onOpenAuthor={(id) => router.push(`/u/${id}`)}
          onHide={(photoId) =>
            photoManage.hide.mutate(photoId, {
              onSuccess: () => {
                show("Photo hidden from this club");
                setOverlay(null);
              },
              onError: () => show("Could not hide photo.", "error"),
            })
          }
          onRemovePost={(postId) =>
            photoManage.removePost.mutate(postId, {
              onSuccess: () => {
                show("Post removed from this club");
                setOverlay(null);
              },
              onError: () => show("Could not remove post.", "error"),
            })
          }
          onDeleteUpload={(photoId) =>
            photoManage.deleteUpload.mutate(photoId, {
              onSuccess: () => {
                show("Photo deleted");
                setOverlay(null);
              },
              onError: () => show("Could not delete photo.", "error"),
            })
          }
        />
      )}

      {editing && club.is_officer && (
        <EditClubModal club={club} userId={userId} onClose={() => setEditing(false)} />
      )}
      {managing && club.is_officer && (
        <ManageClubModal clubId={clubId} userId={userId} onClose={() => setManaging(false)} />
      )}

      {compose === "event" && club.is_officer && (
        <ComposeEventModal
          userId={userId}
          presetClubId={clubId}
          onClose={() => setCompose(null)}
          onCreated={() => {
            setCompose(null);
            invalidateClubContent();
          }}
        />
      )}
      {compose === "post" && club.is_member && (
        <ComposePostModal
          userId={userId}
          presetClubId={clubId}
          onClose={() => setCompose(null)}
          onCreated={() => {
            setCompose(null);
            invalidateClubContent();
          }}
        />
      )}
      {editEventId && (
        <ComposeEventModal
          key={`edit-${editEventId}`}
          userId={userId}
          editEventId={editEventId}
          onClose={() => setEditEventId(null)}
          onCreated={() => {
            setEditEventId(null);
            invalidateClubContent();
          }}
        />
      )}
    </main>
  );
}
