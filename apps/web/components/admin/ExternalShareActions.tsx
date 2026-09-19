"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { disableExternalShare } from "../../lib/admin/contentActions";

// Same pattern as PostActions.tsx's EditCaptionDialog: a plain client-side
// onClick calling the Server Action directly, then router.refresh() to pull
// the updated row. Deliberately not a <form action={fn}> — this project pins
// React 18 types, whose DOM typings have no overload for a function-valued
// form `action`; that only type-checks under the Next.js editor plugin, never
// under the project's own `tsc --noEmit` (its actual type-check script).
//
// Admins can only ever disable external sharing here, never enable it on an
// owner's behalf — enabling stays an owner-only action via enable_external_share.

function DisableExternalShareButton({ entityType, entityId }: { entityType: "post" | "event"; entityId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function disable() {
    setPending(true);
    setError(null);
    disableExternalShare(entityType, entityId)
      .then((res) => {
        if (res.ok) router.refresh();
        else setError(res.error);
      })
      .catch(() => setError("Something went wrong."))
      .finally(() => setPending(false));
  }

  return (
    <div className="ml-auto flex flex-col items-end gap-1">
      <button
        onClick={disable}
        disabled={pending}
        className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "Disabling…" : "Disable external sharing"}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

export function DisablePostExternalShareButton({ postId }: { postId: string }) {
  return <DisableExternalShareButton entityType="post" entityId={postId} />;
}

export function DisableEventExternalShareButton({ eventId }: { eventId: string }) {
  return <DisableExternalShareButton entityType="event" entityId={eventId} />;
}
