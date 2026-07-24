import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserDetail } from "../../../../lib/admin/data";
import { Avatar } from "../../../../components/shared/Avatar";
import { Badge, Field, SectionCard, EmptyState } from "../../../../components/admin/primitives";
import { DetailTabs } from "../../../../components/admin/DetailTabs";
import { Table, Th, Td, RowLink } from "../../../../components/admin/Table";
import { DisabledAction } from "../../../../components/admin/DisabledAction";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminUserDetailPage({ params }: { params: { id: string } }) {
  const user = await getUserDetail(params.id);
  if (!user) notFound();

  const profileTab = (
    <div className="grid gap-6 md:grid-cols-3">
      <SectionCard title="Identity" className="md:col-span-2">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-4">
          <Field label="Full name">{user.full_name}</Field>
          <Field label="Username">@{user.username}</Field>
          <Field label="Email">{user.email}</Field>
          <Field label="University">{user.university}</Field>
          <Field label="Major">{user.major}</Field>
          <Field label="Year">{user.year}</Field>
          <Field label="Onboarding">
            {user.onboarding_completed ? <Badge tone="green">Completed</Badge> : <Badge tone="amber">Pending</Badge>}
          </Field>
          <Field label="Joined">{fmtDate(user.created_at)}</Field>
          <div className="col-span-2">
            <Field label="Bio">{user.bio}</Field>
          </div>
        </dl>
      </SectionCard>

      <div className="space-y-6">
        <SectionCard title="Interests">
          <div className="flex flex-wrap gap-1.5 p-4">
            {user.interests.length ? (
              user.interests.map((i) => <Badge key={i} tone="teal">{i}</Badge>)
            ) : (
              <span className="text-sm text-gray-400">None selected</span>
            )}
          </div>
        </SectionCard>
        <SectionCard title="Activities">
          <div className="flex flex-wrap gap-1.5 p-4">
            {user.activities.length ? (
              user.activities.map((a) => <Badge key={a} tone="blue">{a}</Badge>)
            ) : (
              <span className="text-sm text-gray-400">None selected</span>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );

  const clubsTab = (
    <SectionCard className="overflow-hidden">
      {user.memberships.length === 0 ? (
        <EmptyState icon="🏛️" title="Not a member of any club" />
      ) : (
        <Table
          head={
            <>
              <Th>Club</Th>
              <Th>Role</Th>
              <Th>Officer title</Th>
              <Th>Joined</Th>
            </>
          }
        >
          {user.memberships.map((m) => (
            <RowLink key={m.club_id} href={`/admin/clubs/${m.club_id}`}>
              <Td>
                <div className="flex items-center gap-3">
                  <Avatar uri={m.avatar_url} name={m.club_name} size={28} />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{m.club_name}</p>
                    <p className="text-xs text-gray-500">@{m.club_handle}</p>
                  </div>
                </div>
              </Td>
              <Td>{m.role === "officer" ? <Badge tone="teal">Officer</Badge> : <Badge>Member</Badge>}</Td>
              <Td className="text-gray-600">{m.officer_title}</Td>
              <Td className="whitespace-nowrap text-gray-600">{fmtDate(m.joined_at)}</Td>
            </RowLink>
          ))}
        </Table>
      )}
    </SectionCard>
  );

  const officerTab = (
    <SectionCard className="overflow-hidden">
      {user.officerRoles.length === 0 ? (
        <EmptyState icon="🎖️" title="No officer roles" message="This user does not hold an officer position in any club." />
      ) : (
        <Table
          head={
            <>
              <Th>Club</Th>
              <Th>Title</Th>
              <Th />
            </>
          }
        >
          {user.officerRoles.map((o) => (
            <RowLink key={o.club_id} href={`/admin/clubs/${o.club_id}`}>
              <Td className="font-medium text-gray-900">{o.club_name}</Td>
              <Td>
                <Badge tone="teal">{o.role_title}</Badge>
              </Td>
              <Td className="text-right text-xs text-teal-600">View club →</Td>
            </RowLink>
          ))}
        </Table>
      )}
    </SectionCard>
  );

  const activityTab = (
    <SectionCard title="Activity">
      <div className="p-4 text-sm text-gray-500">
        <p>
          Posts, events, RSVPs, comments and a full activity timeline for this user are scheduled for
          Days 3–4. Current totals:
        </p>
        <div className="mt-3 flex gap-6">
          <span><span className="font-semibold text-gray-900">{user.postCount}</span> posts</span>
          <span><span className="font-semibold text-gray-900">{user.eventCount}</span> events created</span>
          <span><span className="font-semibold text-gray-900">{user.reportCount}</span> reports</span>
        </div>
      </div>
    </SectionCard>
  );

  const actionsTab = (
    <SectionCard title="Account actions">
      <div className="space-y-3 p-4">
        <p className="text-sm text-gray-500">
          Destructive and account-mutating actions are intentionally disabled on Day 1. They will be
          implemented with full audit logging and canonical platform-admin authorization in later phases.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <DisabledAction label="Change authenticated email" reason="Scheduled for Day 7 (needs audit log)" />
          <DisabledAction label="Suspend account" reason="Scheduled for Day 3 (needs restrictions table)" />
          <DisabledAction label="Reset account" reason="Scheduled for Day 7 (destructive — needs safeguards)" tone="danger" />
          <DisabledAction label="Delete account" reason="Scheduled for Day 7 (destructive — needs safeguards)" tone="danger" />
          <DisabledAction label="View deleted content" reason="Scheduled for Day 5 (privacy-gated)" />
        </div>
      </div>
    </SectionCard>
  );

  return (
    <div className="space-y-5">
      <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-600">
        ← Back to Users
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <Avatar uri={user.avatar_url} name={user.full_name} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900">{user.full_name || user.username}</h1>
            {user.onboarding_completed ? <Badge tone="green">Onboarded</Badge> : <Badge tone="amber">Pending</Badge>}
            {user.officerRoles.length > 0 ? <Badge tone="teal">Officer ×{user.officerRoles.length}</Badge> : null}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">@{user.username}{user.email ? ` · ${user.email}` : ""}</p>
        </div>
        <div className="flex gap-6 text-center">
          <div>
            <p className="text-lg font-semibold tabular-nums text-gray-900">{user.memberships.length}</p>
            <p className="text-xs text-gray-500">Clubs</p>
          </div>
          <div>
            <p className="text-lg font-semibold tabular-nums text-gray-900">{user.postCount}</p>
            <p className="text-xs text-gray-500">Posts</p>
          </div>
          <div>
            <p className="text-lg font-semibold tabular-nums text-gray-900">{user.eventCount}</p>
            <p className="text-xs text-gray-500">Events</p>
          </div>
          <div>
            <p className="text-lg font-semibold tabular-nums text-gray-900">{user.reportCount}</p>
            <p className="text-xs text-gray-500">Reports</p>
          </div>
        </div>
      </div>

      <DetailTabs
        tabs={[
          { key: "profile", label: "Profile", content: profileTab },
          { key: "clubs", label: "Clubs", count: user.memberships.length, content: clubsTab },
          { key: "officer", label: "Officer Roles", count: user.officerRoles.length, content: officerTab },
          { key: "activity", label: "Activity", content: activityTab },
          { key: "actions", label: "Actions", content: actionsTab },
        ]}
      />
    </div>
  );
}
