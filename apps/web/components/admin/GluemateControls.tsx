"use client";

import { ConfirmAction } from "./ConfirmAction";
import { removeGluemate } from "../../lib/admin/actions";

/** Dissolve a mutual-follow relationship (deletes both follow directions). */
export function RemoveGluemateButton({
  userAId,
  userBId,
  nameA,
  nameB,
}: {
  userAId: string;
  userBId: string;
  nameA: string;
  nameB: string;
}) {
  return (
    <ConfirmAction
      label="Remove"
      title="Remove gluemate relationship?"
      body={
        <>
          This deletes both follow directions between <span className="font-medium">{nameA}</span> and{" "}
          <span className="font-medium">{nameB}</span>. They will no longer be gluemates. They can re-follow each other later.
        </>
      }
      confirmLabel="Remove"
      tone="danger"
      size="xs"
      requireReason
      targetSummary={`${nameA} ↔ ${nameB}`}
      run={(reason) => removeGluemate(userAId, userBId, reason)}
    />
  );
}
