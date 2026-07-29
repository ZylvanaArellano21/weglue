import Link from "next/link";
import { EmptyState } from "../../../../components/admin/primitives";

export default function PostNotFound() {
  return (
    <div className="space-y-4">
      <EmptyState icon="🖼️" title="Post not found" message="This post does not exist or has been removed." />
      <div className="text-center">
        <Link href="/admin/posts" className="text-sm font-medium text-teal-600 hover:underline">
          ← Back to Posts
        </Link>
      </div>
    </div>
  );
}
