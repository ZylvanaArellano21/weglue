"use client";

import { useRef, useState } from "react";
import { Modal } from "../shared/Modal";
import { ImageIcon, CloseIcon } from "../shared/icons";
import { useToast } from "../shared/Toast";
import { useAllClubs, useCreatePost } from "../../lib/hooks/useCreatePost";
import { PhotoCarousel } from "../shared/PhotoCarousel";

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

  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [clubQuery, setClubQuery] = useState("");

  const previews = files.map((f) => ({ f, url: URL.createObjectURL(f) }));

  const onFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const picked = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (picked.length === 0) {
      show("Please choose image files.", "error");
      return;
    }
    setFiles((prev) => {
      const next = [...prev, ...picked].slice(0, 5);
      if (prev.length + picked.length > 5) show("You can add up to 5 photos.", "error");
      return next;
    });
  };
  const removeAt = (i: number) => setFiles((prev) => prev.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) =>
    setFiles((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const filtered = (clubs ?? []).filter((c) => c.name.toLowerCase().includes(clubQuery.toLowerCase()));

  const submit = () => {
    if (files.length === 0) {
      show("Please select at least one photo.", "error");
      return;
    }
    // Locked = posting from a Club Profile: the post is authored BY the club
    // (author_kind='club'), not tagged. Home posts stay student-authored + tag.
    const authoredClubId = lockedClub?.id;
    const clubIds = lockedClub ? [] : selected;
    create.mutate(
      { file: files.length === 1 ? files[0]! : files, caption: caption.trim() || undefined, clubIds, authoredClubId },
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

        {previews.length > 0 ? (
          <div className="mb-4">
            {previews.length > 1 ? (
              <PhotoCarousel images={previews.map((p) => ({ uri: p.url }))} aspectRatio={4 / 5} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previews[0]!.url} alt="preview" className="w-full rounded-xl object-cover" style={{ maxHeight: 360 }} />
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {previews.map((p, i) => (
                <div key={p.url} className="relative h-16 w-16">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="h-full w-full rounded-lg object-cover" />
                  <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] font-bold text-white">{i + 1}</span>
                  <button type="button" onClick={() => removeAt(i)} aria-label={`Remove photo ${i + 1}`} className="absolute -right-1.5 -top-1.5 rounded-full bg-black/70 p-0.5 text-white">
                    <CloseIcon size={12} />
                  </button>
                  <span className="absolute inset-x-1 bottom-1 flex justify-between">
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded bg-black/55 px-1 text-[11px] text-white disabled:opacity-30">‹</button>
                    <button type="button" disabled={i === previews.length - 1} onClick={() => move(i, 1)} className="rounded bg-black/55 px-1 text-[11px] text-white disabled:opacity-30">›</button>
                  </span>
                </div>
              ))}
              {files.length < 5 && (
                <button type="button" onClick={() => fileRef.current?.click()} className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed" style={{ borderColor: "#0FA6A6", color: "#0FA6A6" }}>
                  <ImageIcon size={18} />
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mb-4 flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed"
            style={{ borderColor: "#E5E7EB", color: "#9CA3AF" }}
          >
            <ImageIcon size={36} />
            <span className="text-sm">Choose photos (up to 5)</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />

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
            <span className="text-gray-500">Posting as</span>
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
          disabled={files.length === 0 || create.isPending}
          className="w-full rounded-full py-3 text-[15px] font-semibold text-white disabled:opacity-50"
          style={{ background: "#0FA6A6" }}
        >
          {create.isPending ? "Posting…" : "Post"}
        </button>
      </div>
    </Modal>
  );
}
