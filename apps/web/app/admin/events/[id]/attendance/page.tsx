import Link from "next/link";
import { notFound } from "next/navigation";
import { getEventDetail } from "../../../../../lib/admin/contentData";
import { getAdminEventAttendanceList, getAdminEventAttendanceSummary } from "../../../../../lib/admin/attendanceData";
import { Badge, SectionCard, EmptyState } from "../../../../../components/admin/primitives";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Read-only per repo rule: Student ID + school email ONLY — never names,
// never check-in timestamps. Mirrors the officer-facing attendance screen's
// privacy contract exactly, just reached from the admin side.
export default async function AdminEventAttendancePage({ params }: { params: { id: string } }) {
  const event = await getEventDetail(params.id);
  if (!event) notFound();

  const [rows, summary] = await Promise.all([
    getAdminEventAttendanceList(event.id),
    event.club_id ? getAdminEventAttendanceSummary(event.id, event.club_id) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-5">
      <Link href={`/admin/events/${event.id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-600">
        ← Back to {event.title}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{event.title} — Attendance</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {event.club_id ? (
              <Link href={`/admin/clubs/${event.club_id}`} className="text-teal-700 hover:underline">
                {event.club_name}
              </Link>
            ) : null}
          </p>
        </div>
        {summary && (
          <Badge tone={summary.checkin_applies ? "teal" : "gray"}>
            {summary.current_count} / {summary.total_count} checked in
          </Badge>
        )}
      </div>

      <SectionCard title={`Check-ins (${rows.length})`}>
        {rows.length === 0 ? (
          <EmptyState icon="🎫" title="No check-ins yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5">Student ID</th>
                  <th className="px-4 py-2.5">School email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{r.student_id}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.school_email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
