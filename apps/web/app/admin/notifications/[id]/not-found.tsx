import Link from "next/link";
import { EmptyState } from "../../../../components/admin/primitives";

export default function NotificationNotFound() {
  return (
    <div className="space-y-4">
      <EmptyState icon="🔔" title="Notification not found" message="This notification does not exist or has been removed." />
      <div className="text-center">
        <Link href="/admin/notifications" className="text-sm font-medium text-teal-600 hover:underline">
          ← Back to Notifications
        </Link>
      </div>
    </div>
  );
}
