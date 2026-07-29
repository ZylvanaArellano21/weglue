"use client";

import { ConfirmAction } from "./ConfirmAction";
import { reactivateClub } from "../../lib/admin/deletedContentActions";

/** Restore (reactivate) a deactivated club — the only canonical safe restore. */
export function RestoreClubButton({ clubId, name }: { clubId: string; name: string }) {
  return (
    <ConfirmAction
      label="Restore"
      size="xs"
      title="Reactivate this club?"
      body={
        <>
          <span className="font-medium">{name}</span> will be set active again and reappear in discovery. This is the
          canonical, reversible reactivation (<code>is_active = true</code>) — no private data is re-exposed.
        </>
      }
      confirmLabel="Reactivate club"
      run={() => reactivateClub(clubId)}
    />
  );
}
