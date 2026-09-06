import Image from "next/image";
import { formatEventDate, formatEventTime, formatEventLocation } from "../../lib/datetime";
import { APP_STORE_URL, PLAY_STORE_URL } from "../../lib/deviceRouting";
import type {
  PublicClubTwin as Twin,
  PublicClubEvent,
  PublicClubMediaItem,
  PublicClubPost,
} from "../../lib/publicClub";

// The logged-out, app-absent public club page. Server-rendered, read-only, no
// viewer state. Every "join / RSVP / message / follow" affordance is a single
// "Get the We Glue app" call to action — participation always requires the app.
// Data is exactly migration 131's get_public_club_profile envelope; nothing
// private, member-level, or chat-related is ever fetched.

function GetTheApp({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <div className={compact ? "flex flex-wrap gap-2" : "flex flex-col gap-2 sm:flex-row"}>
      <a
        href={APP_STORE_URL}
        className="inline-flex h-11 items-center justify-center rounded-full bg-[#0FA6A6] px-5 text-sm font-semibold text-[#FEFCF0]"
      >
        Get We Glue — iPhone
      </a>
      <a
        href={PLAY_STORE_URL}
        className="inline-flex h-11 items-center justify-center rounded-full border border-[#0FA6A6] px-5 text-sm font-semibold text-[#0B7C7C]"
      >
        Get We Glue — Android
      </a>
    </div>
  );
}

function EventRow({ event }: { event: PublicClubEvent }): JSX.Element {
  const time = event.start_time
    ? formatEventTime(event.start_time) +
      (event.end_time ? ` – ${formatEventTime(event.end_time)}` : "")
    : null;
  const where = formatEventLocation(event.building, event.room, null);
  return (
    <li className="flex gap-3 rounded-xl border border-black/10 bg-white p-3">
      {event.cover_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={event.cover_image_url} alt="" className="h-16 w-24 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg bg-[#0FA6A6]/10 text-lg">
          {event.emoji ?? "📅"}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-gray-900">
          {event.emoji ? `${event.emoji} ` : ""}
          {event.title}
        </p>
        <p className="text-xs text-gray-500">
          {formatEventDate(event.event_date)}
          {time ? ` · ${time}` : ""}
        </p>
        {where ? <p className="truncate text-xs text-gray-500">{where}</p> : null}
        {event.description ? (
          <p className="mt-1 line-clamp-2 text-xs text-gray-600">{event.description}</p>
        ) : null}
      </div>
    </li>
  );
}

function MediaTile({ item }: { item: PublicClubMediaItem }): JSX.Element {
  return (
    <div className="relative aspect-square overflow-hidden rounded-lg bg-black/5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.url} alt={item.caption ?? ""} className="h-full w-full object-cover" />
      {item.image_count > 1 ? (
        <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] font-semibold text-white">
          {item.image_count}
        </span>
      ) : null}
    </div>
  );
}

function PostCard({ post }: { post: PublicClubPost }): JSX.Element {
  const cover = post.image_url ?? post.images[0]?.path ?? null;
  return (
    <li className="overflow-hidden rounded-xl border border-black/10 bg-white">
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" className="aspect-[4/3] w-full object-cover" />
      ) : null}
      {post.caption ? <p className="px-3 py-2 text-sm text-gray-700">{post.caption}</p> : null}
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-bold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

export function PublicClubTwin({ club }: { club: Twin }): JSX.Element {
  const meetingWhen = [
    club.meeting_day,
    club.meeting_schedule,
    club.meeting_time_start
      ? formatEventTime(club.meeting_time_start) +
        (club.meeting_time_end ? ` – ${formatEventTime(club.meeting_time_end)}` : "")
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const meetingWhere = formatEventLocation(
    club.meeting_building,
    club.meeting_room,
    club.meeting_location
  );

  return (
    <main className="min-h-screen bg-[#FEFCF0] pb-16">
      {/* Banner + identity */}
      <div className="relative h-40 w-full bg-[#0FA6A6]/15 sm:h-56">
        {club.banner_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={club.banner_url} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="mx-auto max-w-2xl px-4">
        <div className="-mt-10 flex items-end gap-4">
          <span className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-4 border-[#FEFCF0] bg-white">
            {club.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={club.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-2xl">🎓</span>
            )}
          </span>
          <div className="min-w-0 pb-1">
            <h1 className="truncate text-2xl font-bold text-gray-950">{club.name}</h1>
            {club.handle ? <p className="text-sm text-gray-500">@{club.handle}</p> : null}
          </div>
        </div>

        <p className="mt-2 text-xs text-gray-500">
          {club.member_count} {club.member_count === 1 ? "member" : "members"} · Read-only preview
        </p>

        <div className="mt-4 rounded-2xl border border-[#0FA6A6]/30 bg-white p-4">
          <p className="text-sm font-semibold text-gray-900">See more on We Glue</p>
          <p className="mb-3 mt-0.5 text-xs text-gray-500">
            Joining, RSVPs, posts and messages happen in the app.
          </p>
          <GetTheApp />
          <a href={`/login?next=${encodeURIComponent(`/club/${club.id}`)}`} className="mt-3 block text-xs font-semibold text-[#0B7C7C]">
            Already have an account? Sign in
          </a>
        </div>

        {club.description ? (
          <Section title="About">
            <p className="whitespace-pre-wrap text-sm text-gray-700">{club.description}</p>
          </Section>
        ) : null}

        {club.goals.length > 0 ? (
          <Section title="What we do">
            <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
              {club.goals.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        {(meetingWhen || meetingWhere) ? (
          <Section title="Meetings">
            {meetingWhen ? <p className="text-sm text-gray-700">{meetingWhen}</p> : null}
            {meetingWhere ? <p className="text-sm text-gray-500">{meetingWhere}</p> : null}
          </Section>
        ) : null}

        {club.officers.length > 0 ? (
          <Section title="Officer roles">
            <ul className="flex flex-wrap gap-2">
              {club.officers.map((o, i) => (
                <li
                  key={i}
                  className="rounded-full bg-[#0FA6A6]/10 px-3 py-1 text-xs font-semibold text-[#0B7C7C]"
                >
                  {o.role_title}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {club.upcoming_events.items.length > 0 ? (
          <Section title="Upcoming events">
            <ul className="space-y-2">
              {club.upcoming_events.items.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ul>
            {club.upcoming_events.has_more ? (
              <p className="mt-2 text-xs text-gray-500">Get the app to see all upcoming events.</p>
            ) : null}
          </Section>
        ) : null}

        {club.past_events.items.length > 0 ? (
          <Section title="Past events">
            <ul className="space-y-2">
              {club.past_events.items.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ul>
          </Section>
        ) : null}

        {club.media.items.length > 0 ? (
          <Section title="Photos">
            <div className="grid grid-cols-3 gap-1.5">
              {club.media.items.map((m) => (
                <MediaTile key={m.id} item={m} />
              ))}
            </div>
          </Section>
        ) : null}

        {club.posts.items.length > 0 ? (
          <Section title="Club posts">
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {club.posts.items.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </ul>
          </Section>
        ) : null}

        <div className="mt-10 rounded-2xl bg-[#0FA6A6]/10 p-5 text-center">
          <p className="text-sm font-semibold text-gray-900">Want in?</p>
          <p className="mb-3 mt-0.5 text-xs text-gray-500">Get We Glue to join {club.name}.</p>
          <div className="flex justify-center">
            <GetTheApp compact />
          </div>
        </div>
      </div>
    </main>
  );
}
