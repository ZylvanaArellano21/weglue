"use client";

import { useRef, useState } from "react";
import { Modal } from "../shared/Modal";
import { ImageIcon, CloseIcon } from "../shared/icons";
import { useToast } from "../shared/Toast";
import { useAllClubs, useCreatePost } from "../../lib/hooks/useCreatePost";

// Desktop create-post (Share a Glue → Picture). Same model as mobile: a
// required image, an optional caption, and optional multi-select club tags.
//
// Two modes, ONE create-post implementation:
//  • From Home — the full flow, including "Tag a club (optional)" search.
//  • From a Club Profile (`lockedClub`) — an officer posts INTO that club. The
//    club is permanently attached and the tag search is not rendered at all, so
//    the tag can be neither removed nor changed. Photo + caption only; there is
//    deliberately no webcam capture on web.
// Either way the result is the same single post row with the same club tag, so
// it appears in BOTH Home → Posts and the club profile — never duplicated.
export function ComposePostModal({
  userId,
  onClose,
  onCreated,
  lockedClub,
}: {
  userId: string;
  onClose: () => void;
  onCreated: () => void;
  /** Permanently attaches this club and hides the club picker entirely. */
  lockedClub?: { id: string; name: string };
}): JSX.Element {
  const show = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  // Only the Home flow renders the picker, so the locked flow never fetches it.
  const { data: clubs } = useAllClubs(!lockedClub);
  const create = useCreatePost(userId);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [clubQuery, setClubQuery] = useState("");

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      show("Please choose an image file.", "error");
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const filtered = (clubs ?? []).filter((c) => c.name.toLowerCase().includes(clubQuery.toLowerCase()));

  const submit = () => {
    if (!file) {
      show("Please select a photo.", "error");
      return;
    }
    // The locked club is the single source of truth for the tag in that mode —
    // it is never read from component state, so no UI path can drop it.
    const clubIds = lockedClub ? [lockedClub.id] : selected;
    create.mutate(
      { file, caption: caption.trim() || undefined, clubIds },
      {
        onSuccess: () => {
          show("Post shared! 📸");
          onCreated();
        },
        onError: () => show("Failed to post. Please try again.", "error"),
      }
    );
  };

  return (
    <Modal onClose={onClose} labelledBy="compose-post-title" maxWidth={520}>
      <div className="p-5 sm:p-6">
        <h2 id="compose-post-title" className="mb-4 text-center text-lg font-bold text-gray-900">
          New Post
        </h2>

        {preview ? (
          <div className="relative mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="preview" className="w-full rounded-xl object-cover" style={{ maxHeight: 360 }} />
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setPreview(null);
              }}
              aria-label="Remove photo"
              className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mb-4 flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed"
            style={{ borderColor: "#E5E7EB", color: "#9CA3AF" }}
          >
            <ImageIcon size={36} />
            <span className="text-sm">Choose a photo</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value.slice(0, 500))}
          placeholder="Write a caption…"
          rows={3}
          className="mb-4 w-full resize-none rounded-xl border bg-white px-3.5 py-2.5 text-sm outline-none focus:ring-2"
          style={{ borderColor: "#E5E7EB" }}
        />

        {lockedClub ? (
          // Posting from the club profile: the club is fixed. Shown as a static
          // read-only chip so the officer can see where the post is going, with
          // no control that could unset it.
          <div
            className="mb-5 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "#0FA6A6", background: "rgba(15,166,166,0.08)" }}
          >
            <span className="text-gray-500">Posting to</span>
            <span className="font-semibold text-gray-900">{lockedClub.name}</span>
          </div>
        ) : (
          <>
            <p className="mb-2 text-sm font-semibold text-gray-700">Tag a club (optional)</p>
            <input
              value={clubQuery}
              onChange={(e) => setClubQuery(e.target.value)}
              placeholder="Search clubs…"
              className="mb-2 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2"
              style={{ borderColor: "#E5E7EB" }}
            />
            <div className="mb-5 max-h-32 space-y-1 overflow-y-auto">
              {filtered.slice(0, 20).map((c) => {
                const on = selected.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm"
                    style={{
                      borderColor: on ? "#0FA6A6" : "#E5E7EB",
                      background: on ? "rgba(15,166,166,0.08)" : "#fff",
                    }}
                  >
                    <span className="text-gray-900">{c.name}</span>
                    {on && <span style={{ color: "#0FA6A6" }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!file || create.isPending}
          className="w-full rounded-full py-3 text-[15px] font-semibold text-white disabled:opacity-50"
          style={{ background: "#0FA6A6" }}
        >
          {create.isPending ? "Posting…" : "Post"}
        </button>
      </div>
    </Modal>
  );
}
