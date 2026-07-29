"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setNotificationRead } from "../../lib/admin/messagingActions";

/** Mark a notification read/unread. The only canonical, safe notification write. */
export function NotificationReadToggle({ notificationId, read }: { notificationId: string; read: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setPending(true);
    setError(null);
    setNotificationRead(notificationId, !read)
      .then((res) => {
        if (res.ok) router.refresh();
        else setError(res.error);
      })
      .catch(() => setError("Something went wrong."))
      .finally(() => setPending(false));
  }

  return (
    <div className="space-y-2">
      <button
        onClick={toggle}
        disabled={pending}
        className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? "Saving…" : read ? "Mark as unread" : "Mark as read"}
      </button>
      {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
    </div>
  );
}
