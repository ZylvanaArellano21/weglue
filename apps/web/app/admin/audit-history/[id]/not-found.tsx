import Link from "next/link";
import { EmptyState } from "../../../../components/admin/primitives";

export default function AuditEventNotFound() {
  return (
    <div className="space-y-4">
      <EmptyState
        icon="🕵️"
        title="Audit event not found"
        message="No audit event has this ID. Audit events are never deleted, so an ID that once existed still resolves — check the ID for a typo."
      />
      <div className="text-center">
        <Link href="/admin/audit-history" className="text-sm font-medium text-teal-600 hover:underline">
          ← Back to Audit History
        </Link>
      </div>
    </div>
  );
}
