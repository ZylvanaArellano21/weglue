import Link from "next/link";
import { EmptyState } from "../../../../components/admin/primitives";

export default function CommentNotFound() {
  return (
    <div className="space-y-4">
      <EmptyState icon="💬" title="Comment not found" message="This comment does not exist or has been removed." />
      <div className="text-center">
        <Link href="/admin/comments" className="text-sm font-medium text-teal-600 hover:underline">
          ← Back to Comments
        </Link>
      </div>
    </div>
  );
}
