import Link from "next/link";
import { notFound } from "next/navigation";
import { getClubDetail } from "../../../../lib/admin/data";
import { Avatar } from "../../../../components/shared/Avatar";
import { Badge, Field, SectionCard, EmptyState } from "../../../../components/admin/primitives";
import { DetailTabs } from "../../../../components/admin/DetailTabs";
import { Table, Th, Td, RowLink } from "../../../../components/admin/Table";
import { DisabledAction } from "../../../../components/admin/DisabledAction";
import { AddMemberDialog, AddOfficerDialog, MemberRowActions } from "../../../../components/admin/MembershipControls";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtTime(t: string | null): string | null {
  if (!t) return null;
  // Postgres TIME comes back as "HH:MM:SS"; render "H:MM AM/PM".
  const [h = "0", m = "00"] = t.split(":");
  const hour = parseInt(h, 10);
  if (Number.isNaN(hour)) return t;
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m} ${ampm}`;
}

function meetingSummary(c: Awaited<ReturnType<typeof getClubDetail>>): string | null {
  if (!c) return null;
  const parts: string[] = [];
  if (c.meeting_day) parts.push(c.meeting_day);
  const start = fmtTime(c.meeting_time_start);
  const end = fmtTime(c.meeting_time_end);
  if (start && end) parts.push(`${start}–${end}`);
  else if (start) parts.push(start);
  return parts.length ? parts.join(" · ") : null;
}

function locationSummary(c: Awaited<ReturnType<typeof getClubDetail>>): string | null {
  if (!c) return null;
  const parts = [c.meeting_location, c.meeting_building, c.meeting_room ? `Room ${c.meeting_room}` : null].filter(
    Boolean
  );
  return parts.length ? (parts.join(" · ") as string) : null;
}

export default async function AdminClubDetailPage({ params }: { params: { id: string } }) {
  const club = await getClubDetail(params.id);
  if (!club) notFound();

  const meeting = meetingSummary(club);
  const location = locationSummary(club);

  const overviewTab = (
    <div className="grid gap-6 md:grid-cols-3">
      <SectionCard title="Details" className="md:col-span-2">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-4">
          <Field label="Name">{club.name}</Field>
          <Field label="Handle">@{club.handle}</Field>
          <Field label="University">{club.university}</Field>
          <Field label="Status">
            <span className="flex items-center gap-1.5">
              {club.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}
              {club.claimed ? <Badge tone="blue">Claimed</Badge> : <Badge tone="gray">Unclaimed</Badge>}
            </span>
          </Field>
          <Field label="Meeting">{meeting}</Field>
          <Field label="Location">{location}</Field>
          <Field label="Created">{fmtDate(club.created_at)}</Field>
          <Field label="Owner / Creator">
            <span className="text-gray-400">Not tracked in schema</span>
          </Field>
          <div className="col-span-2">
            <Field label="Description">{club.description}</Field>
          </div>
        </dl>
      </SectionCard>

      <SectionCard title="At a glance">
        <div className="grid grid-cols-2 gap-3 p-4">
          <Stat label="Members" value={club.memberCount} />
          <Stat label="Officers" value={club.officerCount} />
          <Stat label="Posts" value={club.postCount} />
          <Stat label="Events" value={club.eventCount} />
          <Stat label="Conversations" value={club.conversationCount} />
          <Stat label="Reports" value={club.reportCount} danger={club.reportCount > 0} />
        </div>
      </SectionCard>
    </div>
  );

  const presetClub = { id: club.id, label: club.name };
  const membersTab = (
    <SectionCard
      className="overflow-hidden"
      title="Members"
      action={
        <div className="flex gap-2">
          <AddMemberDialog presetClub={presetClub} />
          <AddOfficerDialog presetClub={presetClub} />
        </div>
      }
    >
      {club.members.length === 0 ? (
        <EmptyState icon="👥" title="No members yet" />
      ) : (
        <Table
          head={
            <>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th>Officer title</Th>
              <Th>Joined</Th>
              <Th>Manage</Th>
            </>
          }
        >
          {club.members.map((m) => (
            <tr key={m.user_id} className="text-gray-700">
              <Td>
                <Link href={`/admin/users/${m.user_id}`} className="flex items-center gap-3 hover:text-teal-700">
                  <Avatar uri={m.avatar_url} name={m.full_name} size={28} />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{m.full_name || m.username}</p>
                    <p className="text-xs text-gray-500">@{m.username}{m.email ? ` · ${m.email}` : ""}</p>
                  </div>
                </Link>
              </Td>
              <Td>{m.role === "officer" ? <Badge tone="teal">Officer</Badge> : <Badge>Member</Badge>}</Td>
              <Td className="text-gray-600">{m.officer_title}</Td>
              <Td className="whitespace-nowrap text-gray-600">{fmtDate(m.joined_at)}</Td>
              <Td>
                <MemberRowActions
                  clubId={club.id}
                  userId={m.user_id}
                  role={m.role}
                  officerCount={club.officerCount}
                  roleTitle={m.officer_title}
                  targetLabel={`${m.full_name ?? m.username ?? m.user_id} — ${club.name}`}
                />
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </SectionCard>
  );

  const officersTab = (
    <SectionCard className="overflow-hidden">
      {club.officers.length === 0 ? (
        <EmptyState
          icon="🎖️"
          title="No officers listed"
          message="This club has no entries in its officer roster."
        />
      ) : (
        <Table
          head={
            <>
              <Th>Officer</Th>
              <Th>Title</Th>
              <Th>Email</Th>
              <Th />
            </>
          }
        >
          {club.officers.map((o, i) => {
            const inner = (
              <>
                <Td>
                  <div className="flex items-center gap-3">
                    <Avatar uri={o.avatar_url} name={o.display_name} size={28} />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{o.display_name}</p>
                      {o.username ? <p className="text-xs text-gray-500">@{o.username}</p> : null}
                    </div>
                  </div>
                </Td>
                <Td>
                  <Badge tone="teal">{o.role_title}</Badge>
                </Td>
                <Td className="text-gray-600">{o.email}</Td>
                <Td className="text-right text-xs text-teal-600">{o.user_id ? "View user →" : ""}</Td>
              </>
            );
            return o.user_id ? (
              <RowLink key={o.user_id + i} href={`/admin/users/${o.user_id}`}>
                {inner}
              </RowLink>
            ) : (
              <tr key={`roster-${i}`} className="text-gray-700">
                {inner}
              </tr>
            );
          })}
        </Table>
      )}
      <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">
        Officer authority is defined by <code>club_members.role = &apos;officer&apos;</code>; this roster
        (<code>club_officers</code>) is display-only. Manage officers from the Members tab or the Officers
        section.
      </p>
    </SectionCard>
  );

  const relatedTab = (
    <SectionCard title="Content & moderation">
      <div className="p-4 text-sm text-gray-500">
        <p>Full lists of posts, events, conversations, reports and history are scheduled for Days 2–5. Current totals:</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Posts" value={club.postCount} />
          <Stat label="Events" value={club.eventCount} />
          <Stat label="Conversations" value={club.conversationCount} />
          <Stat label="Reports" value={club.reportCount} danger={club.reportCount > 0} />
        </div>
      </div>
    </SectionCard>
  );

  const actionsTab = (
    <SectionCard title="Club actions">
      <div className="space-y-3 p-4">
        <p className="text-sm text-gray-500">
          Officer &amp; membership management is <span className="font-medium text-teal-700">live</span> — use the
          Members tab (add member, add officer, promote, demote, edit title, remove) with founder authorization and
          audit logging. Club edit/deactivate/delete remain scheduled.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <DisabledAction label="Edit club details" reason="Scheduled (club edit form)" />
          <DisabledAction label="Deactivate club" reason="Scheduled for Day 3 (restrictions)" tone="danger" />
          <DisabledAction label="Delete club" reason="Scheduled for Day 7 (destructive — needs safeguards)" tone="danger" />
        </div>
      </div>
    </SectionCard>
  );

  return (
    <div className="space-y-5">
      <Link href="/admin/clubs" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-600">
        ← Back to Clubs
      </Link>

      {/* Header with cover */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {club.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={club.cover_image_url} alt="" className="h-28 w-full object-cover" />
        ) : (
          <div className="h-20 w-full bg-gradient-to-r from-teal-400/20 to-teal-500/10" />
        )}
        <div className="flex flex-wrap items-start gap-4 p-5">
          <Avatar uri={club.avatar_url} name={club.name} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-900">{club.name}</h1>
              {club.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}
              {club.claimed ? <Badge tone="blue">Claimed</Badge> : null}
            </div>
            <p className="mt-0.5 text-sm text-gray-500">
              @{club.handle}
              {club.university ? ` · ${club.university}` : ""}
            </p>
          </div>
          <div className="flex gap-6 text-center">
            <div>
              <p className="text-lg font-semibold tabular-nums text-gray-900">{club.memberCount}</p>
              <p className="text-xs text-gray-500">Members</p>
            </div>
            <div>
              <p className="text-lg font-semibold tabular-nums text-gray-900">{club.officerCount}</p>
              <p className="text-xs text-gray-500">Officers</p>
            </div>
            <div>
              <p className="text-lg font-semibold tabular-nums text-gray-900">{club.eventCount}</p>
              <p className="text-xs text-gray-500">Events</p>
            </div>
          </div>
        </div>
      </div>

      <DetailTabs
        tabs={[
          { key: "overview", label: "Overview", content: overviewTab },
          { key: "members", label: "Members", count: club.memberCount, content: membersTab },
          { key: "officers", label: "Officers", count: club.officers.length, content: officersTab },
          { key: "related", label: "Content", content: relatedTab },
          { key: "actions", label: "Actions", content: actionsTab },
        ]}
      />
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number | null; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <p className={`text-lg font-semibold tabular-nums ${danger ? "text-red-600" : "text-gray-900"}`}>
        {value === null ? <span className="text-sm text-gray-400">N/A</span> : value.toLocaleString()}
      </p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
