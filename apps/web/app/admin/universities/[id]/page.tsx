import Link from "next/link";
import { notFound } from "next/navigation";
import {
  describeCampusEmailPolicy,
  getUniversityDetail,
} from "../../../../lib/admin/data2";
import { Avatar } from "../../../../components/shared/Avatar";
import { Badge, Field, SectionCard, EmptyState } from "../../../../components/admin/primitives";
import { EditUniversityDialog, UniversityActiveToggle } from "../../../../components/admin/UniversityControls";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function UniversityDetailPage({ params }: { params: { id: string } }) {
  const uni = await getUniversityDetail(params.id);
  if (!uni) notFound();

  return (
    <div className="space-y-5">
      <Link href="/admin/universities" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-600">
        ← Back to Universities
      </Link>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-900">{uni.name}</h1>
              {uni.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}
            </div>
            <p className="mt-0.5 font-mono text-sm text-gray-500">@{uni.slug}</p>
          </div>
          <div className="flex items-center gap-2">
            <EditUniversityDialog
              id={uni.id}
              name={uni.name}
              slug={uni.slug}
              policy={{
                emailMode: uni.email_mode,
                emailDomains: uni.email_domains ?? [],
                emailDeniedMessage: uni.email_denied_message ?? "",
              }}
            />
            <UniversityActiveToggle id={uni.id} isActive={uni.is_active} name={uni.name} />
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Field label="Users">{uni.userCount.toLocaleString()}</Field>
          <Field label="Clubs">{uni.clubCount.toLocaleString()}</Field>
          <Field label="Events">{uni.eventCount === null ? "—" : uni.eventCount.toLocaleString()}</Field>
          <Field label="Created">{fmtDate(uni.created_at)}</Field>
        </dl>
      </div>

      {/* Who may join this campus. The database decides with
          campus_email_allowed(); this is the same rule, shown. */}
      <SectionCard title="Email rule">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 p-4 sm:grid-cols-3">
          <Field label="Mode">
            <Badge tone={uni.email_mode === "allowlist" ? "blue" : "gray"}>
              {uni.email_mode === "allowlist" ? "Allowlist" : "Block school email"}
            </Badge>
          </Field>
          <Field label="Accepted domains">
            {uni.email_domains && uni.email_domains.length > 0 ? (
              <span className="font-mono text-sm">
                {uni.email_domains.map((d) => `@${d}`).join(", ")}
              </span>
            ) : (
              "Any address that is not school-issued"
            )}
          </Field>
          <Field label="Rejection message">
            {uni.email_denied_message ?? (
              <span className="text-gray-400">Shared default</span>
            )}
          </Field>
        </dl>
        <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
          {describeCampusEmailPolicy(uni)} — applied identically at signup, at
          Account Center email changes, and to any client that bypasses the apps.
          Allowlist domains match exactly; subdomains are not accepted.
        </p>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title={`Users (${uni.userCount})`}
          action={
            <Link href={`/admin/users?university=${uni.id}`} className="text-xs font-medium text-teal-600 hover:underline">
              View all
            </Link>
          }
        >
          {uni.users.length === 0 ? (
            <EmptyState icon="👤" title="No users" />
          ) : (
            <ul className="divide-y divide-gray-100">
              {uni.users.map((u) => (
                <li key={u.id}>
                  <Link href={`/admin/users/${u.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                    <Avatar uri={u.avatar_url} name={u.full_name} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-900">{u.full_name || u.username}</span>
                      <span className="block truncate text-xs text-gray-500">@{u.username}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title={`Clubs (${uni.clubCount})`}
          action={
            <Link href={`/admin/clubs?university=${uni.id}`} className="text-xs font-medium text-teal-600 hover:underline">
              View all
            </Link>
          }
        >
          {uni.clubs.length === 0 ? (
            <EmptyState icon="🏛️" title="No clubs" />
          ) : (
            <ul className="divide-y divide-gray-100">
              {uni.clubs.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/clubs/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                    <Avatar uri={c.avatar_url} name={c.name} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-900">{c.name}</span>
                      <span className="block truncate text-xs text-gray-500">@{c.handle}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
