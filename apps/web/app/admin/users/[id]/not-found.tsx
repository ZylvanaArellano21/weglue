import Link from "next/link";
import { EmptyState } from "../../../../components/admin/primitives";

export default function UserNotFound() {
  return (
    <div className="space-y-4">
      <EmptyState icon="👤" title="User not found" message="This user does not exist or has been removed." />
      <div className="text-center">
        <Link href="/admin/users" className="text-sm font-medium text-teal-600 hover:underline">
          ← Back to Users
        </Link>
      </div>
    </div>
  );
}
