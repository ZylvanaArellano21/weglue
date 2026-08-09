"use client";

import { ConfirmDialog } from "../shared/ConfirmDialog";
import {
  planClubPhotoRemoval,
  type ClubPhotoRemovalPlan,
  type ClubPhotoSource,
} from "../../lib/clubs/clubPhotoRemoval";

export interface RemovableClubPhoto {
  id: string;
  source: ClubPhotoSource;
  post_id: string | null;
}

/**
 * The one confirmation web shows before anything leaves a club's Photos that
 * Glue, wherever it is triggered from. It renders mobile's exact wording, and
 * hands the caller the decided plan so a tagged post is only ever DETACHED from
 * the club and an officer upload is only ever deleted.
 *
 * Destructive styling gives the red confirm button, matching mobile's
 * `style: 'destructive'` alert action.
 */
export function ClubPhotoRemovalDialog({
  photo,
  clubName,
  pending,
  onConfirm,
  onCancel,
}: {
  photo: RemovableClubPhoto;
  clubName: string;
  pending: boolean;
  /** Called with the decided operation — switch on `plan.kind`. */
  onConfirm: (plan: ClubPhotoRemovalPlan) => void;
  onCancel: () => void;
}): JSX.Element {
  const plan = planClubPhotoRemoval(photo, clubName);

  return (
    <ConfirmDialog
      title={plan.title}
      message={plan.message}
      confirmLabel={plan.confirmLabel}
      cancelLabel="Cancel"
      destructive
      loading={pending}
      onConfirm={() => onConfirm(plan)}
      onCancel={onCancel}
    />
  );
}
