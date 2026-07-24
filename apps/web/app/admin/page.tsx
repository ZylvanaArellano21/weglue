import Link from "next/link";
import { getOverviewStats } from "../../lib/admin/data";
import { StatCard, SectionCard, IdentityCell, EmptyState } from "../../components/admin/primitives";

export const dynamic = "force-dynamic";

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

const QUICK_LINKS = [
  { label: "View Users", href: "/admin/users", icon: "👤" },
  { label: "View Clubs", href: "/admin/clubs", icon: "🏛️" },
  { label: "View Reports", href: "/admin/reports", icon: "🚩" },
  { label: "Manage Memberships", href: "/admin/memberships", icon: "🎟️" },
];

export default async function AdminOverviewPage() {
  const stats = await getOverviewStats();

  const primary = [
    { label: "Total Users", value: stats.users, href: "/admin/users" },
    { label: "Total Clubs", value: stats.clubs, href: "/admin/clubs" },
    { label: "Total Posts", value: stats.posts },
    { label: "Total Events", value: stats.events },
  ];
  const secondary = [
    { label: "Open Reports", value: stats.openReports, hint: "pending + reviewing", href: "/admin/reports" },
    { label: "Total Reports", value: stats.reports, href: "/admin/reports" },
    { label: "Memberships", value: stats.memberships, href: "/admin/memberships" },
    { label: "Officers", value: stats.officers },
    { label: "Universities", value: stats.universities, href: "/admin/universities" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Overview</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Live, read-only aggregate health from canonical production sources.
        </p>
      </div>

      {/* Primary stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {primary.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} href={s.href} />
        ))}
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {secondary.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} hint={s.hint} href={s.href} />
        ))}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {QUICK_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition hover:border-teal-300 hover:text-teal-700 hover:shadow-sm"
          >
            <span className="text-lg">{l.icon}</span>
            {l.label}
          </Link>
        ))}
      </div>

      {/* Recent activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Recent Users"
          action={
            <Link href="/admin/users" className="text-xs font-medium text-teal-600 hover:underline">
              View all
            </Link>
          }
        >
          {stats.recentUsers.length === 0 ? (
            <EmptyState icon="👤" title="No users yet" />
          ) : (
            <ul className="divide-y divide-gray-100">
              {stats.recentUsers.map((u) => (
                <li key={u.id} className="flex items-center justify-between px-4 py-2.5">
                  <IdentityCell
                    name={u.full_name || u.username}
                    sub={`@${u.username}`}
                    avatarUrl={u.avatar_url}
                    href={`/admin/users/${u.id}`}
                  />
                  <span className="shrink-0 text-xs text-gray-400">{timeAgo(u.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Recent Clubs"
          action={
            <Link href="/admin/clubs" className="text-xs font-medium text-teal-600 hover:underline">
              View all
            </Link>
          }
        >
          {stats.recentClubs.length === 0 ? (
            <EmptyState icon="🏛️" title="No clubs yet" />
          ) : (
            <ul className="divide-y divide-gray-100">
              {stats.recentClubs.map((c) => (
                <li key={c.id} className="flex items-center justify-between px-4 py-2.5">
                  <IdentityCell
                    name={c.name}
                    sub={`@${c.handle}`}
                    avatarUrl={c.avatar_url}
                    href={`/admin/clubs/${c.id}`}
                  />
                  <span className="shrink-0 text-xs text-gray-400">{timeAgo(c.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <p className="text-xs text-gray-400">
        Counts are computed live from canonical tables. A card shows{" "}
        <span className="font-medium">Unavailable</span> rather than inventing data if its query cannot
        run safely. Message content and deleted evidence are never exposed here.
      </p>
    </div>
  );
}
