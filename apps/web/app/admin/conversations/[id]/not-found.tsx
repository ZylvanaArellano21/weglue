import Link from "next/link";
import { EmptyState } from "../../../../components/admin/primitives";

export default function ConversationNotFound() {
  return (
    <div className="space-y-4">
      <EmptyState icon="🗨️" title="Conversation not found" message="This conversation does not exist or has been removed." />
      <div className="text-center">
        <Link href="/admin/conversations" className="text-sm font-medium text-teal-600 hover:underline">
          ← Back to Conversations
        </Link>
      </div>
    </div>
  );
}
