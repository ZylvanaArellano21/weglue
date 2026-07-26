"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "../shared/Modal";
import { editCommentContent } from "../../lib/admin/contentActions";

const COMMENT_MAX = 2000;

/** Edit a comment's text (the only canonically-editable field on post_comments). */
export function EditCommentDialog({ commentId, content }: { commentId: string; content: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(content);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setPending(true);
    setError(null);
    editCommentContent(commentId, value)
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
          setValue(content);
          setOpen(true);
        }}
        className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Edit comment
      </button>
      {open ? (
        <Modal onClose={() => (pending ? null : setOpen(false))} maxWidth={520}>
          <div className="space-y-4 p-5">
            <h3 className="text-base font-semibold text-gray-900">Edit comment</h3>
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value.slice(0, COMMENT_MAX))}
              rows={4}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
            <p className="text-right text-xs text-gray-400">
              {value.length}/{COMMENT_MAX}
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
                disabled={pending || value.trim().length < 1}
                onClick={submit}
                className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save comment"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
