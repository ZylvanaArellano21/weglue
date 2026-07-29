import Link from "next/link";
import { EmptyState } from "../../../../components/admin/primitives";

export default function EventNotFound() {
  return (
    <div className="space-y-4">
      <EmptyState icon="📅" title="Event not found" message="This event does not exist or has been removed." />
      <div className="text-center">
        <Link href="/admin/events" className="text-sm font-medium text-teal-600 hover:underline">
          ← Back to Events
        </Link>
      </div>
    </div>
  );
}
