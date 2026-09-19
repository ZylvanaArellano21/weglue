import Link from "next/link";
import { notFound } from "next/navigation";
import { getEventDetail } from "../../../../lib/admin/contentData";
import { Avatar } from "../../../../components/shared/Avatar";
import { Badge, Field, SectionCard, EmptyState } from "../../../../components/admin/primitives";
import { DetailTabs } from "../../../../components/admin/DetailTabs";
import { EditEventDialog } from "../../../../components/admin/EventActions";
import { DisableEventExternalShareButton } from "../../../../components/admin/ExternalShareActions";
import { AddRsvpDialog } from "../../../../components/admin/RsvpActions";
import { LifecycleDetails } from "../../../../components/admin/LifecycleDetails";
import { LifecycleBadge } from "../../../../components/admin/ContentLifecycleActions";
import { getContentLifecycleDetail } from "../../../../lib/admin/lifecycleData";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function fmtDate(d: string): string {
  const [y = 1970, m = 1, day = 1] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
function hm(t: string): string {
  return t ? t.slice(0, 5) : "";
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const REPORT_TONE: Record<string, "amber" | "blue" | "green" | "gray"> = {
  pending: "amber",
  reviewing: "blue",
  resolved: "green",
  dismissed: "gray",
};
const VIS_TONE: Record<string, "green" | "amber" | "blue"> = { everyone: "green", members: "amber", specific: "blue" };

export default async function AdminEventDetailPage({ params }: { params: { id: string } }) {
  const event = await getEventDetail(params.id);
  if (!event) notFound();
  const lifecycle = await getContentLifecycleDetail("event", event.id);
  const canonicalMutable = lifecycle.available && lifecycle.record?.state === "active";

  const going = event.attendees.filter((a) => a.status === "going");
  const cant = event.attendees.filter((a) => a.status === "cant");

  const detailsTab = (
    <div className="grid gap-6 md:grid-cols-3">
      <SectionCard title="Event" className="md:col-span-2">
        <div className="space-y-4 p-4">
          {event.images.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {event.images.map((image) => (
                <figure key={image.position} className="overflow-hidden rounded-lg border border-gray-100 bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.path} alt="" className="max-h-72 w-full object-cover" />
                  <figcaption className="px-2 py-1 text-xs text-gray-400">Image {image.position + 1}</figcaption>
                </figure>
              ))}
            </div>
          ) : null}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Description</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
              {event.description || <span className="text-gray-400">No description</span>}
            </p>
          </div>
        </div>
      </SectionCard>
      <SectionCard title="Schedule & location">
        <dl className="grid gap-4 p-4">
          <Field label="Date">{fmtDate(event.event_date)}</Field>
          <Field label="Time">
            {hm(event.start_time)}–{hm(event.end_time)}
          </Field>
          <Field label="Location">{event.location}</Field>
          <Field label="Building">{event.building}</Field>
          <Field label="Room">{event.room}</Field>
          <Field label="Media">
            {event.images.length ? `${event.images.length} image${event.images.length === 1 ? "" : "s"}` : "None"}
          </Field>
          <Field label="Visibility">
            <Badge tone={VIS_TONE[event.visibility] ?? "gray"}>{event.visibility}</Badge>
            {event.visibility === "specific" ? (
              <span className="ml-2 text-xs text-gray-500">{event.specific_user_count} specific members</span>
            ) : null}
          </Field>
          <Field label="State">{event.is_past ? <Badge tone="gray">Past</Badge> : <Badge tone="teal">Upcoming</Badge>}</Field>
          <Field label="Created">{fmtDateTime(event.created_at)}</Field>
          {event.updated_at ? <Field label="Updated">{fmtDateTime(event.updated_at)}</Field> : null}
        </dl>
      </SectionCard>
    </div>
  );

  const hostTab = (
    <div className="grid gap-6 md:grid-cols-2">
      <SectionCard title="Host club">
        {event.club_id ? (
          <div className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{event.club_name}</p>
              <p className="text-xs text-gray-500">@{event.club_handle}</p>
            </div>
            <Link href={`/admin/clubs/${event.club_id}`} className="text-sm text-teal-600 hover:underline">
              View club →
            </Link>
          </div>
        ) : (
          <EmptyState icon="🏛️" title="No host club" />
        )}
      </SectionCard>
      <SectionCard title="Creator">
        <div className="flex items-center justify-between p-4">
          <Link href={`/admin/users/${event.creator_id}`} className="flex items-center gap-3 hover:opacity-80">
            <Avatar uri={event.creator_avatar} name={event.creator_name} size={40} />
            <div>
              <p className="text-sm font-medium text-gray-900">{event.creator_name || event.creator_username}</p>
              <p className="text-xs text-gray-500">@{event.creator_username}</p>
            </div>
          </Link>
          <Link href={`/admin/users/${event.creator_id}`} className="text-sm text-teal-600 hover:underline">
            View user →
          </Link>
        </div>
      </SectionCard>
    </div>
  );

  const rsvpTab = (
    <SectionCard
      title={`RSVPs — ${event.goingCount} going · ${event.cantCount} can't`}
      action={
        <div className="flex items-center gap-3">
          <AddRsvpDialog eventId={event.id} eventTitle={event.title} />
          <Link href={`/admin/rsvps?event=${event.id}`} className="text-xs text-teal-600 hover:underline">
            Manage in RSVPs →
          </Link>
        </div>
      }
    >
      {event.attendees.length === 0 ? (
        <EmptyState icon="✅" title="No RSVPs yet" />
      ) : (
        <div className="grid gap-6 p-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-700">Going ({going.length})</p>
            <ul className="space-y-1">
              {going.map((a) => (
                <li key={a.user_id}>
                  <Link href={`/admin/users/${a.user_id}`} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-gray-50">
                    <Avatar uri={a.avatar_url} name={a.full_name} size={24} />
                    <span className="text-sm text-gray-800">{a.full_name || a.username}</span>
                    <span className="text-xs text-gray-400">@{a.username}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Can&apos;t go ({cant.length})</p>
            <ul className="space-y-1">
              {cant.map((a) => (
                <li key={a.user_id}>
                  <Link href={`/admin/users/${a.user_id}`} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-gray-50">
                    <Avatar uri={a.avatar_url} name={a.full_name} size={24} />
                    <span className="text-sm text-gray-800">{a.full_name || a.username}</span>
                    <span className="text-xs text-gray-400">@{a.username}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </SectionCard>
  );

  const postsTab = (
    <SectionCard title={`Related posts (${event.relatedPosts.length})`}>
      {event.relatedPosts.length === 0 ? (
        <EmptyState icon="🖼️" title="No related posts" message="No posts are linked to this event." />
      ) : (
        <ul className="divide-y divide-gray-100">
          {event.relatedPosts.map((p) => (
            <li key={p.id}>
              <Link href={`/admin/posts/${p.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
                <span className="min-w-0 truncate text-sm text-gray-900">{p.caption || "View post"}</span>
                <span className="ml-3 shrink-0 text-xs text-gray-400">@{p.author_username}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );

  const reportsTab = (
    <SectionCard
      title={`Reports (${event.reportCount})`}
      action={
        <Link href={`/admin/reports?type=event&id=${event.id}`} className="text-xs text-teal-600 hover:underline">
          Open in Reports →
        </Link>
      }
    >
      {event.reports.length === 0 ? (
        <EmptyState icon="🚩" title="No reports" message="This event has not been reported." />
      ) : (
        <ul className="divide-y divide-gray-100">
          {event.reports.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <Badge tone={REPORT_TONE[r.status] ?? "gray"}>{r.status}</Badge>
                <span className="text-sm font-medium text-gray-900">{r.reason ?? "Reported"}</span>
                <span className="text-xs text-gray-400">{fmtDateTime(r.created_at)}</span>
              </div>
              {r.details ? <p className="mt-1 text-sm text-gray-600">{r.details}</p> : null}
              {r.reporter_username ? <p className="mt-0.5 text-xs text-gray-400">Reported by @{r.reporter_username}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );

  const externalSharing = (
    <SectionCard title="External sharing">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <Badge tone={event.externalShare.enabled ? "green" : "gray"}>
          {event.externalShare.enabled ? "Enabled" : "Disabled"}
        </Badge>
        {event.externalShare.enabled_by_name && event.externalShare.enabled_at ? (
          <span className="text-sm text-gray-600">
            Enabled by {event.externalShare.enabled_by_name} on {fmtDateTime(event.externalShare.enabled_at)}.
          </span>
        ) : (
          <span className="text-sm text-gray-500">This event has not been enabled for external sharing.</span>
        )}
        {event.externalShare.enabled ? (
          <DisableEventExternalShareButton eventId={event.id} />
        ) : null}
      </div>
    </SectionCard>
  );

  const actionsTab = (
    <div className="space-y-5">
      {externalSharing}
      <SectionCard title="Actions">
        <div className="space-y-4 p-4">
          {canonicalMutable ? (
            <>
              <EditEventDialog
                eventId={event.id}
                initial={{
                  title: event.title,
                  description: event.description,
                  event_date: event.event_date,
                  start_time: event.start_time,
                  end_time: event.end_time,
                  location: event.location,
                  building: event.building,
                  room: event.room,
                  visibility: event.visibility,
                  emoji: event.emoji,
                }}
              />
              <p className="text-xs text-gray-400">
                Editing writes to the canonical <code>events</code> row with start/end chronology + visibility
                validation, a read-back check, and audit event. Lifecycle removal and restoration are in the
                Lifecycle tab and require recent MFA.
              </p>
            </>
          ) : (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
              Canonical editing is unavailable while lifecycle state is not active. Use the Lifecycle tab to review or
              restore eligible content.
            </p>
          )}
        </div>
      </SectionCard>
    </div>
  );

  return (
    <div className="space-y-5">
      <Link href="/admin/events" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-600">
        ← Back to Events
      </Link>

      <div className="flex flex-wrap items-start gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-teal-50 text-3xl">
          {event.emoji || "📅"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900">{event.title}</h1>
            {event.is_past ? <Badge tone="gray">Past</Badge> : <Badge tone="teal">Upcoming</Badge>}
            {lifecycle.available && lifecycle.record ? (
              <LifecycleBadge status={lifecycle.record.displayStatus} />
            ) : (
              <Badge tone="amber">Lifecycle unavailable</Badge>
            )}
            <Badge tone={VIS_TONE[event.visibility] ?? "gray"}>{event.visibility}</Badge>
            {event.reportCount > 0 ? <Badge tone="red">{event.reportCount} reports</Badge> : null}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">
            {event.club_id ? (
              <Link href={`/admin/clubs/${event.club_id}`} className="text-teal-700 hover:underline">
                {event.club_name}
              </Link>
            ) : null}{" "}
            · {fmtDate(event.event_date)} · {hm(event.start_time)}–{hm(event.end_time)}
          </p>
        </div>
        <div className="flex gap-6 text-center">
          <div>
            <p className="text-lg font-semibold tabular-nums text-gray-900">{event.goingCount}</p>
            <p className="text-xs text-gray-500">Going</p>
          </div>
          <div>
            <p className="text-lg font-semibold tabular-nums text-gray-900">{event.cantCount}</p>
            <p className="text-xs text-gray-500">Can&apos;t</p>
          </div>
        </div>
      </div>

      <DetailTabs
        tabs={[
          { key: "details", label: "Details", content: detailsTab },
          { key: "host", label: "Host & creator", content: hostTab },
          { key: "rsvps", label: "RSVPs", count: event.goingCount + event.cantCount, content: rsvpTab },
          { key: "posts", label: "Related posts", count: event.relatedPosts.length, content: postsTab },
          { key: "reports", label: "Reports", count: event.reportCount, content: reportsTab },
          { key: "lifecycle", label: "Lifecycle", content: <LifecycleDetails result={lifecycle} /> },
          { key: "actions", label: "Actions", content: actionsTab },
        ]}
      />
    </div>
  );
}
