import Image from "next/image";
import { Avatar } from "../shared/Avatar";
import { CalendarIcon, LocationIcon } from "../shared/icons";
import { GetWeGlueCTA } from "./GetWeGlueCTA";
import {
  parseMeetingSchedule,
  formatEventDate,
  formatEventTime,
  formatEventLocation,
  isInCurrentWeek,
} from "../../lib/datetime";
import { publicClubPhotos } from "../../lib/publicClub";
import type {
  PublicClubTwin as Twin,
  PublicClubEvent,
  PublicClubMediaItem,
} from "../../lib/publicClub";

// ─── Public club "twin" ──────────────────────────────────────────────────────
// The logged-out, app-absent club page. This is NOT a landing page — it is the
// real We Glue Club Profile, rendered read-only from migration 131's
// get_public_club_profile envelope. It reuses the exact structure, section
// order, cards, spacing, typography and colours of the authenticated profile
// (apps/web/components/clubs/ClubProfileHeader.tsx + ClubProfileClient.tsx's
// phone scroll + ClubRightColumn.tsx), which are themselves the web port of
// apps/mobile/app/club/[clubId]/index.tsx.
//
// The ONE intentional product difference is read-only: there is no viewer
// state, and every app-required action (Join, RSVP, Chat, React, Comment, open
// an event / photo) is replaced in-place by the Get We Glue CTA
// (<GetWeGlueCTA>, device-routed iPhone→App Store / Android→Play / desktop→
// weglue.app/download). Nothing private, member-level or chat-related is ever
// fetched — the migration 131 whitelist is the security boundary.
//
// Layout mirrors the real profile: a single stacked column below lg (the phone
// source of truth — About + Meeting inline in the header, then Upcoming / Past
// events, Photos that Glue, Officers), and on lg+ the same content beside the
// condensed right rail (goals, meeting, Upcoming Events!, Photos that Glue).

function EventRow({ event }: { event: PublicClubEvent }): JSX.Element {
  // Native's compact Club Profile event card (ClubEventCard): fixed-width image
  // filling the card height on the left, title + date + location on the right.
  // Read-only here, so no trailing chevron and no RSVP — the card is
  // informational; participation lives in the header CTA.
  const location = formatEventLocation(event.building, event.room, event.location);
  return (
    <div
      className="mb-3.5 flex w-full items-center overflow-hidden rounded-2xl bg-[#FEFCF0] text-left shadow-card"
      style={{ minHeight: 96 }}
    >
      <div className="relative w-32 shrink-0 self-stretch bg-gray-200">
        {event.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.cover_image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-500">
            <CalendarIcon size={30} />
          </div>
        )}
      </div>
      <div className="flex-1 px-3.5 py-3">
        <p className="mb-1.5 truncate text-[15px] font-bold text-gray-900">
          {event.emoji ? `${event.emoji} ${event.title}` : event.title}
        </p>
        <div className="mb-1 flex items-start gap-1.5 text-gray-500">
          <span className="mt-0.5">
            <CalendarIcon size={15} strokeWidth={1.6} />
          </span>
          <span className="text-xs font-medium leading-[17px]">
            {formatEventDate(event.event_date)}
            {event.start_time ? (
              <>
                <br />
                {formatEventTime(event.start_time)}
                {event.end_time ? ` - ${formatEventTime(event.end_time)}` : ""}
              </>
            ) : null}
          </span>
        </div>
        {location && (
          <div className="flex items-center gap-1.5 text-gray-500">
            <LocationIcon size={15} strokeWidth={1.6} />
            <span className="truncate text-xs font-medium">{location}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PhotoGrid({ items, className = "" }: { items: PublicClubMediaItem[]; className?: string }): JSX.Element {
  return (
    <div className={`grid grid-cols-3 gap-1 ${className}`.trim()}>
      {items.map((photo) => (
        <div key={photo.id} className="relative aspect-square overflow-hidden rounded-lg bg-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt={photo.caption ?? ""} className="h-full w-full object-cover" />
          {photo.image_count > 1 ? (
            <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <rect x="8" y="8" width="12" height="12" rx="2" />
                <path d="M4 16V6a2 2 0 0 1 2-2h10" />
              </svg>
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return <h2 className="mb-3 text-xl font-bold text-gray-900">{children}</h2>;
}

// Right-rail schedule lines — matches ClubRightColumn.buildScheduleLines
// exactly ("Wednesday 1:00 pm - 2:00 pm", one line per day, no comma).
function railScheduleLines(club: Twin): string[] {
  return parseMeetingSchedule(
    club.meeting_schedule,
    club.meeting_day,
    club.meeting_time_start,
    club.meeting_time_end
  ).map((s) => {
    const start = s.start ? formatEventTime(s.start) : "";
    const end = s.end ? ` - ${formatEventTime(s.end)}` : "";
    return `${s.day}${start ? ` ${start}${end}` : ""}`;
  });
}

// ─── Right rail (lg+) — ClubRightColumn markup, read-only ────────────────────
function RightRail({ club, photos }: { club: Twin; photos: PublicClubMediaItem[] }): JSX.Element {
  const scheduleLines = railScheduleLines(club);
  const location = formatEventLocation(club.meeting_building, club.meeting_room, club.meeting_location);
  const railEvents = club.upcoming_events.items.slice(0, 3);
  const railPhotos = photos.slice(0, 6);

  return (
    <div className="space-y-6">
      {club.goals.length > 0 && (
        <div className="rounded-2xl bg-white p-5 shadow-[0_0_0_1px_rgba(15,166,166,0.25),0_2px_14px_rgba(15,166,166,0.12)]">
          <ul className="space-y-3.5">
            {club.goals.map((goal) => (
              <li key={goal.id} className="flex items-start gap-3">
                <span className="mt-0.5 text-teal" aria-hidden>
                  💡
                </span>
                <span className="text-[15px] font-medium text-gray-900">{goal.goal_text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(scheduleLines.length > 0 || location) && (
        <div className="flex items-start gap-3 rounded-2xl bg-white p-5 shadow-[0_0_0_1px_rgba(15,166,166,0.25),0_2px_14px_rgba(15,166,166,0.12)]">
          <span className="mt-0.5 text-teal">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="text-[15px] font-semibold text-gray-900">
            {scheduleLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {location && <p>{location}</p>}
          </div>
        </div>
      )}

      {railEvents.length > 0 && (
        <div>
          <h2 className="mb-3 text-2xl font-bold text-gray-900">Upcoming Events!</h2>
          <div className="space-y-3">
            {railEvents.map((e) => {
              const loc = formatEventLocation(e.building, e.room, e.location);
              const thisWeek = isInCurrentWeek(e.event_date);
              const detail = thisWeek
                ? "text-[12px] font-medium text-[#F02719]"
                : "text-[12px] font-normal text-gray-900";
              return (
                <div key={e.id} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-[0_2px_10px_rgba(0,0,0,0.07)]">
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[14px] font-bold ${thisWeek ? "text-[#F02719]" : "text-gray-900"}`}>
                      {e.emoji ? `${e.emoji} ${e.title}` : e.title}
                    </p>
                    <p className={`mt-0.5 ${detail}`}>{formatEventDate(e.event_date)}</p>
                    {e.start_time && (
                      <p className={detail}>
                        {formatEventTime(e.start_time)}
                        {e.end_time ? ` - ${formatEventTime(e.end_time)}` : ""}
                      </p>
                    )}
                    {loc && <p className={detail}>{loc}</p>}
                  </div>
                  <GetWeGlueCTA variant="chip" label="RSVP" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {railPhotos.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">Photos that Glue</h2>
            <GetWeGlueCTA variant="link" label="See all" />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {railPhotos.map((photo) => (
              <div key={photo.id} className="relative aspect-square overflow-hidden rounded-md bg-gray-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={photo.caption ?? ""} className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PublicClubTwin({ club }: { club: Twin }): JSX.Element {
  const photos = publicClubPhotos(club);
  const meetingSlots = parseMeetingSchedule(
    club.meeting_schedule,
    club.meeting_day,
    club.meeting_time_start,
    club.meeting_time_end
  );
  const meetingLocation = formatEventLocation(club.meeting_building, club.meeting_room, club.meeting_location);
  const signInHref = `/login?next=${encodeURIComponent(`/club/${club.id}`)}`;

  return (
    <div className="min-h-screen bg-cream">
      {/* Slim public bar — no authenticated nav, just the mark + one CTA. */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-black/[0.06] bg-cream/95 px-4 backdrop-blur sm:px-6">
        <a href="https://weglue.app" className="flex items-center gap-2" aria-label="We Glue">
          <Image src="/logo.png" alt="We Glue" width={30} height={30} priority />
          <span className="text-[15px] font-bold text-gray-900">We Glue</span>
        </a>
        <GetWeGlueCTA variant="outline" label="Get We Glue" />
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* ── Left: header + stacked profile (the phone source of truth) ── */}
          <div className="min-w-0">
            <section className="-mx-4 overflow-hidden rounded-none bg-white shadow-none sm:-mx-6 lg:mx-0 lg:rounded-2xl lg:shadow-[0_2px_10px_rgba(0,0,0,0.08)]">
              {/* Banner + overlapping avatar */}
              <div className="relative h-40 w-full bg-gray-200 sm:h-48">
                {club.banner_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={club.banner_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full" style={{ background: "linear-gradient(135deg,#0FA6A6,#0b7d7d)" }} />
                )}
              </div>

              <div className="relative px-5 pb-2 pt-3 sm:px-7">
                <div className="absolute -top-14 left-5 sm:left-7">
                  <div className="rounded-full border-4 border-white bg-white">
                    <Avatar uri={club.avatar_url} size={104} name={club.name} />
                  </div>
                </div>

                {/* Desktop: member count + read-only marker, top-right (mirrors
                    the real header's Stats cluster position). */}
                <div className="hidden min-h-[56px] flex-wrap items-start justify-end gap-x-8 gap-y-3 pt-1 lg:flex">
                  <div className="px-2 py-1 text-center">
                    <p className="text-xl font-bold text-gray-900">{club.member_count}</p>
                    <p className="text-[13px] text-gray-600">Members</p>
                  </div>
                </div>

                {/* Name + one-line description on desktop, exactly like the real
                    header (ClubProfileHeader). @handle lives in the summary card
                    below on desktop and is not repeated here. */}
                <h1 className="mt-12 text-[26px] font-bold text-gray-900 lg:mt-1">{club.name}</h1>
                {club.description && (
                  <p className="mt-1 hidden max-w-2xl text-[15px] text-gray-800 lg:block">{club.description}</p>
                )}

                {/* Phone: member count line (real header shows this below md). */}
                <p className="mt-1 block text-[13px] text-gray-500 lg:hidden">
                  {club.member_count} Member{club.member_count === 1 ? "" : "s"} · Read-only preview
                </p>

                {/* Get We Glue — occupies the exact place the real header puts
                    Join / Chat. This is the club-profile's single participation
                    affordance for a logged-out visitor. */}
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <GetWeGlueCTA
                    variant="primary"
                    label={`Get We Glue to join ${club.name}`}
                    className="!px-6 text-center sm:!px-8"
                  />
                  <a
                    href={signInHref}
                    className="inline-flex items-center justify-center rounded-full border-[1.5px] border-teal bg-transparent px-5 py-2.5 text-[14px] font-semibold text-teal transition hover:bg-teal/5"
                  >
                    Already a member? Sign in
                  </a>
                </div>

                <p
                  className="mt-3 rounded-[10px] border px-3 py-3 text-center text-[13px] font-medium lg:hidden"
                  style={{ background: "rgba(15,166,166,0.08)", borderColor: "rgba(15,166,166,0.2)", color: "#0FA6A6" }}
                >
                  Get We Glue to join {club.name}, RSVP to events and chat with members
                </p>

                {/* About (description + goals) — phone/tablet only, exactly like
                    the real header (desktop shows the one-line description above
                    and the goals in the right rail). */}
                {(club.description || club.goals.length > 0) && (
                  <div className="mt-4 lg:hidden">
                    <h2 className="mb-1.5 text-base font-bold text-gray-900">About</h2>
                    {club.description && (
                      <p className="mb-2 text-[13px] leading-relaxed text-gray-800">{club.description}</p>
                    )}
                    {club.goals.map((goal) => (
                      <div key={goal.id} className="mb-1 flex items-start gap-2">
                        <span
                          className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] text-white"
                          style={{ background: "#0FA6A6" }}
                          aria-hidden
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        </span>
                        <span className="text-[13px] leading-relaxed text-gray-800">{goal.goal_text}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Meeting Schedule — phone/tablet only (right rail on desktop). */}
                {(meetingSlots.length > 0 || meetingLocation) && (
                  <div className="mt-4 lg:hidden">
                    <h2 className="mb-1.5 text-base font-bold text-gray-900">Meeting Schedule</h2>
                    <div className="rounded-[10px] bg-white p-3.5" style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
                      {meetingSlots.map((slot, i) => (
                        <div key={`${slot.day}-${i}`} className="mb-1.5 flex items-start gap-2 last:mb-0">
                          <span className="mt-0.5 text-teal" aria-hidden>
                            <CalendarIcon size={16} />
                          </span>
                          <span className="text-[13px] font-bold text-gray-900">
                            {slot.day}
                            {slot.start && slot.end ? ` ${formatEventTime(slot.start)} - ${formatEventTime(slot.end)}` : ""}
                          </span>
                        </div>
                      ))}
                      {meetingLocation && (
                        <div className="flex items-center gap-2">
                          <span className="text-teal" aria-hidden>
                            <LocationIcon size={16} />
                          </span>
                          <span className="text-[13px] font-bold text-gray-900">{meetingLocation}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Native's continuous scroll order. On lg the real Home tab lays
                a small @handle summary card beside the events
                (ClubHomeTab's grid-cols-[190px_minmax(0,1fr)]); below lg it is
                one column, exactly like the phone. */}
            <div className="mt-6 lg:grid lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-6">
              <div className="mb-6 hidden self-start rounded-2xl bg-white p-5 text-center shadow-[0_2px_10px_rgba(0,0,0,0.08)] lg:block">
                <div className="flex justify-center">
                  <Avatar uri={club.avatar_url} size={56} name={club.name} />
                </div>
                {club.handle && <p className="mt-2 text-[15px] font-bold text-gray-900">@{club.handle}</p>}
                <p className="mt-2 text-[13px] text-gray-600">
                  {club.member_count} Member{club.member_count === 1 ? "" : "s"}
                </p>
                <p className="text-[13px] text-gray-500">Read-only preview</p>
              </div>

              <div className="min-w-0">
              <SectionTitle>Upcoming Events</SectionTitle>
              {club.upcoming_events.items.length > 0 ? (
                <div>
                  {club.upcoming_events.items.map((e) => (
                    <EventRow key={e.id} event={e} />
                  ))}
                  {club.upcoming_events.has_more && (
                    <p className="mb-2 text-xs text-gray-500">Get We Glue to see every upcoming event.</p>
                  )}
                </div>
              ) : (
                <p className="rounded-xl bg-white/60 py-8 text-center text-sm text-gray-500">No upcoming events yet</p>
              )}

              <h2 className="mb-3 mt-8 text-xl font-bold text-gray-900">Past Events</h2>
              {club.past_events.items.length > 0 ? (
                <div>
                  {club.past_events.items.map((e) => (
                    <EventRow key={e.id} event={e} />
                  ))}
                </div>
              ) : (
                <p className="rounded-xl bg-white/60 py-8 text-center text-sm text-gray-500">No past events yet</p>
              )}

              {/* Photos — the real profile shows this in the phone scroll and,
                  on desktop, in the right rail (+ a Media tab). The twin keeps
                  it in the left scroll below lg and defers to the rail on lg+,
                  matching that split. Grid density tracks ClubMediaTab. */}
              <div className="lg:hidden">
                <h2 className="mb-3 mt-8 text-xl font-bold text-gray-900">Photos that Glue</h2>
                {photos.length > 0 ? (
                  <PhotoGrid items={photos.slice(0, 9)} />
                ) : (
                  <p className="rounded-xl bg-white/60 py-8 text-center text-sm text-gray-500">No photos yet</p>
                )}
              </div>

              {club.officers.length > 0 && (
                <>
                  <h2 className="mb-3 mt-8 text-xl font-bold text-gray-900">Officers</h2>
                  <div className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2">
                    {club.officers.map((officer, i) => (
                      <div key={`${officer.role_title}-${i}`} className="flex items-center gap-3">
                        <span
                          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full text-teal"
                          style={{ background: "rgba(15,166,166,0.12)" }}
                          aria-hidden
                        >
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <circle cx="12" cy="8" r="4" />
                            <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round" />
                          </svg>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-bold text-gray-900">{officer.role_title}</p>
                          <p className="text-[13px] font-medium text-teal">Club officer</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              </div>
            </div>
          </div>

          {/* ── Right rail — lg+ only (condensed, like the real profile). ── */}
          <div className="hidden min-w-0 lg:block">
            <RightRail club={club} photos={photos} />
          </div>
        </div>

        {/* Footer conversion — mirrors native's bottom "join" nudge. */}
        <div className="mx-auto mt-10 max-w-md rounded-2xl bg-teal/10 p-5 text-center">
          <p className="text-sm font-semibold text-gray-900">Want in on {club.name}?</p>
          <p className="mb-3 mt-0.5 text-xs text-gray-600">
            Joining, RSVPs, posts and messages all happen in the We Glue app.
          </p>
          <div className="flex justify-center">
            <GetWeGlueCTA variant="primary" label="Get We Glue" />
          </div>
        </div>
      </main>
    </div>
  );
}
