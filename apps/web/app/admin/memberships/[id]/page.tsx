import Link from "next/link";
import { notFound } from "next/navigation";
import { getMembershipDetail, clubOfficerCount } from "../../../../lib/admin/data2";
import { Avatar } from "../../../../components/shared/Avatar";
import { Badge, Field, SectionCard } from "../../../../components/admin/primitives";
import { MemberRowActions } from "../../../../components/admin/MembershipControls";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function MembershipDetailPage({ params }: { params: { id: string } }) {
  const m = await getMembershipDetail(params.id);
  if (!m) notFound();
  const officerCount = m.role === "officer" ? await clubOfficerCount(m.club_id) : 0;

  return (
    <div className="space-y-5">
      <Link href="/admin/memberships" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-600">
        ← Back to Memberships
      </Link>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl font-semibold text-gray-900">Membership</h1>
          {m.role === "officer" ? <Badge tone="teal">Officer{m.officer_title ? ` · ${m.officer_title}` : ""}</Badge> : <Badge>Member</Badge>}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {/* User */}
          <Link href={`/admin/users/${m.user_id}`} className="flex items-center gap-3 rounded-xl border border-gray-200 p-4 hover:border-teal-300">
            <Avatar uri={m.avatar_url} name={m.full_name} size={44} />
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-gray-400">User</p>
              <p className="truncate text-sm font-semibold text-gray-900">{m.full_name || m.username}</p>
              <p className="truncate text-xs text-gray-500">@{m.username}{m.email ? ` · ${m.email}` : ""}</p>
            </div>
            <span className="ml-auto text-teal-600">→</span>
          </Link>
          {/* Club */}
          <Link href={`/admin/clubs/${m.club_id}`} className="flex items-center gap-3 rounded-xl border border-gray-200 p-4 hover:border-teal-300">
            <Avatar uri={m.club_avatar} name={m.club_name} size={44} />
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-gray-400">Club</p>
              <p className="truncate text-sm font-semibold text-gray-900">{m.club_name}</p>
              <p className="truncate text-xs text-gray-500">@{m.club_handle}{m.university ? ` · ${m.university}` : ""}</p>
            </div>
            <span className="ml-auto text-teal-600">→</span>
          </Link>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Field label="Role">{m.role === "officer" ? "Officer" : "Member"}</Field>
          <Field label="Officer title">{m.officer_title}</Field>
          <Field label="Status"><Badge tone="green">Active</Badge></Field>
          <Field label="Joined">{fmtDate(m.joined_at)}</Field>
        </dl>
      </div>

      <SectionCard title="Actions">
        <div className="space-y-3 p-4">
          <p className="text-sm text-gray-500">
            Role and membership changes write the canonical <code className="rounded bg-gray-100 px-1 text-xs">club_members</code> row
            (officer authority) and keep the <code className="rounded bg-gray-100 px-1 text-xs">club_officers</code> display roster in sync.
          </p>
          <MemberRowActions clubId={m.club_id} userId={m.user_id} role={m.role} officerCount={officerCount} roleTitle={m.officer_title} targetLabel={`${m.full_name ?? m.username ?? m.user_id} — ${m.club_name ?? "club"}`} />
        </div>
      </SectionCard>
    </div>
  );
}
