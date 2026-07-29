import Link from "next/link";
import { EmptyState } from "../../../../components/admin/primitives";

export default function ChannelNotFound() {
  return (
    <div className="space-y-4">
      <EmptyState icon="📢" title="Channel not found" message="This channel does not exist or has been removed." />
      <div className="text-center">
        <Link href="/admin/channels" className="text-sm font-medium text-teal-600 hover:underline">
          ← Back to Channels
        </Link>
      </div>
    </div>
  );
}
