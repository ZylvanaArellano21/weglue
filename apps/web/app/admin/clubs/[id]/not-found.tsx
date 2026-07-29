import Link from "next/link";
import { EmptyState } from "../../../../components/admin/primitives";

export default function ClubNotFound() {
  return (
    <div className="space-y-4">
      <EmptyState icon="🏛️" title="Club not found" message="This club does not exist or has been removed." />
      <div className="text-center">
        <Link href="/admin/clubs" className="text-sm font-medium text-teal-600 hover:underline">
          ← Back to Clubs
        </Link>
      </div>
    </div>
  );
}
