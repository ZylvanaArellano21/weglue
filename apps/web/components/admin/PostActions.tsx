"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../shared/Modal";
import { ConfirmAction } from "./ConfirmAction";
import { editPostCaption, removePostFromClub } from "../../lib/admin/contentActions";

const CAPTION_MAX = 2000;

/** Edit the post caption (the only canonically-editable text field on posts). */
export function EditCaptionDialog({ postId, caption }: { postId: string; caption: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(caption ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setPending(true);
    setError(null);
    editPostCaption(postId, value)
      .then((res) => {
        if (res.ok) {
          setOpen(false);
          router.refresh();
        } else setError(res.error);
      })
      .catch(() => setError("Something went wrong."))
      .finally(() => setPending(false));
  }

  return (
    <>
      <button
        onClick={() => {
          setValue(caption ?? "");
          setOpen(true);
        }}
        className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Edit caption
      </button>
      {open ? (
        <Modal onClose={() => (pending ? null : setOpen(false))} maxWidth={520}>
          <div className="space-y-4 p-5">
            <h3 className="text-base font-semibold text-gray-900">Edit caption</h3>
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value.slice(0, CAPTION_MAX))}
              rows={5}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              placeholder="Caption (leave blank to clear)…"
            />
            <p className="text-right text-xs text-gray-400">
              {value.length}/{CAPTION_MAX}
            </p>
            {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                disabled={pending}
                onClick={submit}
                className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save caption"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Untag a post from a club (canonical hide-from-club; the post itself survives). */
export function RemoveFromClubButton({
  postId,
  clubId,
  clubName,
}: {
  postId: string;
  clubId: string;
  clubName: string;
}) {
  return (
    <ConfirmAction
      label="Remove from club"
      title="Remove this post from the club?"
      body={
        <>
          The post will be untagged from <span className="font-medium">{clubName}</span> and removed from
          its feed and photos. The post is <span className="font-medium">not deleted</span> — it remains on
          the author&apos;s profile. This mirrors the in-app &ldquo;remove from club&rdquo; action.
        </>
      }
      confirmLabel="Remove from club"
      tone="danger"
      requireReason
      targetSummary={`Post ${postId.slice(0, 8)} — ${clubName}`}
      run={(reason) => removePostFromClub(postId, clubId, reason)}
    />
  );
}
