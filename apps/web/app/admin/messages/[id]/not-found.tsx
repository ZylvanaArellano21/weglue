import Link from "next/link";
import { EmptyState } from "../../../../components/admin/primitives";

export default function MessageNotFound() {
  return (
    <div className="space-y-4">
      <EmptyState icon="✉️" title="Message not found" message="This message does not exist or has been removed." />
      <div className="text-center">
        <Link href="/admin/messages" className="text-sm font-medium text-teal-600 hover:underline">
          ← Back to Messages
        </Link>
      </div>
    </div>
  );
}
