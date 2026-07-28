import Link from "next/link";
import { EmptyState } from "../../../../components/admin/primitives";

export default function ReportNotFound() {
  return (
    <div className="space-y-5">
      <Link href="/admin/reports" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-teal-600">
        ← Back to Reports
      </Link>
      <div className="rounded-xl border border-gray-200 bg-white">
        <EmptyState icon="🚩" title="Report not found" message="This report may have been removed, or the id is invalid." />
      </div>
    </div>
  );
}
