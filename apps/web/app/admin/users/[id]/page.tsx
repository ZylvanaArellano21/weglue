import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserDetail } from "../../../../lib/admin/data";
import { getUserGluemates } from "../../../../lib/admin/data2";
import { Avatar } from "../../../../components/shared/Avatar";
import { Badge, Field, SectionCard, EmptyState } from "../../../../components/admin/primitives";
import { DetailTabs } from "../../../../components/admin/DetailTabs";
import { Table, Th, Td, RowLink } from "../../../../components/admin/Table";
import { DisabledAction } from "../../../../components/admin/DisabledAction";
import { RestrictionControls } from "../../../../components/admin/RestrictionControls";
import { restrictionSummary } from "../../../../lib/admin/restrictionData";
import { isWritesEnabled } from "../../../../lib/admin/secureAdmin";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminUserDetailPage({ params }: { params: { id: string } }) {
  const user = await getUserDetail(params.id);
  if (!user) notFound();
  const gluemates = await getUserGluemates(params.id);
  const restriction = await restrictionSummary(params.id);
  const writesEnabled = isWritesEnabled();

  const stateLabel =
    restriction.accessState === "active"
      ? "Active"
      : restriction.accessState === "suspended"
      ? "Suspended"
      : "Blocked from We Glue";
  const stateTone =
    restriction.accessState === "active"
      ? "green"
      : restriction.accessState === "suspended"
      ? "amber"
      : "red";

  const profileTab = (
    <div className="grid gap-6 md:grid-cols-3">
      <SectionCard title="Identity" className="md:col-span-2">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-4">
          <Field label="Full name">{user.full_name}</Field>
          <Field label="Username">@{user.username}</Field>
          <Field label="Email">{user.email}</Field>
          <Field label="University">
            {user.university_id && user.university ? (
              <Link href={`/admin/universities/${user.university_id}`} className="text-teal-700 hover:underline">
                {user.university}
              </Link>
            ) : (
              user.university
            )}
          </Field>
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

  const gluematesTab = (
    <SectionCard className="overflow-hidden" title={`Gluemates (${gluemates.mutual.length})`}>
      <div className="flex gap-4 border-b border-gray-100 px-4 py-3 text-xs text-gray-500">
        <span><span className="font-semibold text-gray-900">{gluemates.mutual.length}</span> mutual</span>
        <span><span className="font-semibold text-gray-900">{gluemates.followingOnly}</span> following only</span>
        <span><span className="font-semibold text-gray-900">{gluemates.followerOnly}</span> followers only</span>
      </div>
      {gluemates.mutual.length === 0 ? (
        <EmptyState icon="🔗" title="No gluemates" message="This user has no mutual-follow relationships." />
      ) : (
        <ul className="divide-y divide-gray-100">
          {gluemates.mutual.map((g) => (
            <li key={g.id}>
              <Link href={`/admin/users/${g.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                <Avatar uri={g.avatar_url} name={g.full_name} size={28} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-900">{g.full_name || g.username}</span>
                  <span className="block truncate text-xs text-gray-500">@{g.username}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );

  const actionsTab = (
    <div className="space-y-5">
      {/* Access (Day 10B2) */}
      <SectionCard title="Access">
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={stateTone as never}>{stateLabel}</Badge>
            {restriction.active?.suspended_until ? (
              <span className="text-sm text-gray-500">
                Expires {new Date(restriction.active.suspended_until).toLocaleString()}
              </span>
            ) : restriction.active ? (
              <span className="text-sm text-gray-500">No expiry &mdash; until lifted</span>
            ) : null}
          </div>

          {restriction.active && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg bg-gray-50 p-3 text-sm">
              <Field label="Applied">{new Date(restriction.active.created_at).toLocaleString()}</Field>
              <Field label="By">
                <span className="font-mono text-xs">{restriction.active.created_by}</span>
              </Field>
              <div className="col-span-2">
                <dt className="text-xs uppercase tracking-wide text-gray-400">
                  Internal reason &mdash; administrators only, never shown to the student
                </dt>
                <dd className="mt-1 text-sm text-gray-900">{restriction.active.internal_reason}</dd>
              </div>
              <Field label="Correlation ID">
                <span className="font-mono text-xs">{restriction.active.correlation_id}</span>
              </Field>
              <Field label="Session revocation">
                {restriction.sessionRevocation.reconciliationRequired
                  ? "Reconciliation required"
                  : restriction.sessionRevocation.succeeded
                  ? "Revoked"
                  : restriction.sessionRevocation.failed
                  ? "FAILED \u2014 access still denied by the database"
                  : restriction.sessionRevocation.attempted
                  ? "Attempted, outcome unknown"
                  : "Not recorded"}
              </Field>
            </dl>
          )}

          <RestrictionControls
            userId={params.id}
            targetSummary={`${user.full_name ?? user.username} (@${user.username})`}
            accessState={restriction.accessState}
            writesEnabled={writesEnabled}
          />

          <p className="text-xs text-gray-400">
            A restriction never deletes content, and never blocks the student&apos;s own account
            deletion. Blocking is not deletion.{" "}
            <Link href={`/admin/audit-history?target=${params.id}`} className="text-teal-600 hover:underline">
              View audit history &rarr;
            </Link>
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Restriction history">
        {restriction.history.length === 0 ? (
          <EmptyState title="No restrictions" message="This account has never been suspended or blocked." />
        ) : (
          <Table
            head={
              <>
                <Th>When</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Expiry</Th>
                <Th>Internal reason</Th>
                <Th>Lifted</Th>
              </>
            }
          >
            {restriction.history.map((r) => (
              <tr key={r.id} className="border-t border-gray-50">
                <Td>{new Date(r.created_at).toLocaleString()}</Td>
                <Td>{r.restriction_type === "suspended" ? "Suspension" : "Platform block"}</Td>
                <Td>{r.status}</Td>
                <Td>{r.suspended_until ? new Date(r.suspended_until).toLocaleString() : "\u2014"}</Td>
                <Td>{r.internal_reason}</Td>
                <Td>
                  {r.lifted_at
                    ? `${new Date(r.lifted_at).toLocaleString()}${r.lift_reason ? ` \u2014 ${r.lift_reason}` : ""}`
                    : "\u2014"}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      <SectionCard title="Other account actions">
        <div className="space-y-3 p-4">
          <p className="text-sm text-gray-500">
            These remain intentionally disabled. Account <strong>deletion</strong> is deliberately not
            an administrator control here &mdash; it is not the same thing as a platform block, and the
            student&apos;s own deletion flow remains the canonical path.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <DisabledAction label="Change authenticated email" reason="Not yet reviewed" />
            <DisabledAction label="Reset account" reason="Destructive &mdash; not yet reviewed" tone="danger" />
            <DisabledAction label="Delete account" reason="Not an administrator action; students delete their own accounts" tone="danger" />
            <DisabledAction label="View deleted content" reason="Privacy-gated" />
          </div>
        </div>
      </SectionCard>
    </div>
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
          { key: "gluemates", label: "Gluemates", count: gluemates.mutual.length, content: gluematesTab },
          { key: "activity", label: "Activity", content: activityTab },
          { key: "actions", label: "Actions", content: actionsTab },
        ]}
      />
    </div>
  );
}
