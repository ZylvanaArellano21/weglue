"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clampPostImageRatio, naturalCropAspect } from "@weglue/shared";
import { Modal } from "../shared/Modal";
import { ImageIcon, CloseIcon } from "../shared/icons";
import { useToast } from "../shared/Toast";
import { useAllClubs, useCreatePost } from "../../lib/hooks/useCreatePost";
import { imageDimensions } from "../../lib/imageUpload";
import { PhotoCarousel } from "../shared/PhotoCarousel";
import { ImageCropper, type CropAspectOption } from "../shared/ImageCropper";

/** Post-compose ratio picker: Original (the image's own ratio), 1:1, 4:5. */
function postCropAspectOptions(width: number, height: number): CropAspectOption[] {
  return [
    { key: "original", label: "Original", ratio: naturalCropAspect(width, height) },
    { key: "square", label: "1:1", ratio: [1, 1] },
    { key: "portrait", label: "4:5", ratio: [4, 5] },
  ];
}

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
  // The photo currently shown in the carousel preview (what "Adjust" acts on).
  const [current, setCurrent] = useState(0);
  // The photo being adjusted: its object URL and the resolved frame. `options`
  // is set only for the first photo (or a lone photo) — its ratio choice
  // defines the shared carousel ratio; later photos only reposition into it.
  const [crop, setCrop] = useState<
    { idx: number; src: string; aspect: [number, number]; options?: CropAspectOption[] } | null
  >(null);

  const previews = useMemo(
    () => files.map((f) => ({ f, url: URL.createObjectURL(f) })),
    [files],
  );
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const replaceFile = (idx: number, blob: Blob) => {
    setFiles((prev) =>
      prev.map((f, i) =>
        i === idx ? new File([blob], `photo-${idx + 1}.jpg`, { type: "image/jpeg" }) : f,
      ),
    );
  };

  const openAdjust = async (idx: number) => {
    const file = files[idx];
    const url = previews[idx]?.url;
    if (!file || !url) return;
    const withPicker = idx === 0 || files.length === 1;
    try {
      const d = await imageDimensions(file);
      const w = d.width || 1;
      const h = d.height || 1;
      if (withPicker) {
        setCrop({ idx, src: url, aspect: naturalCropAspect(w, h), options: postCropAspectOptions(w, h) });
      } else {
        const d0 = await imageDimensions(files[0]!);
        const r = clampPostImageRatio((d0.width || 1) / (d0.height || 1));
        setCrop({ idx, src: url, aspect: [Math.round(r * 1000), 1000] });
      }
    } catch {
      setCrop({ idx, src: url, aspect: [4, 5] });
    }
  };

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
    <>
    {crop && (
      <ImageCropper
        src={crop.src}
        aspect={crop.aspect}
        aspectOptions={crop.options}
        title={files.length > 1 ? `Adjust photo ${crop.idx + 1}` : "Adjust photo"}
        onCancel={() => setCrop(null)}
        onConfirm={({ blob }) => {
          replaceFile(crop.idx, blob);
          setCrop(null);
        }}
      />
    )}
    <Modal onClose={onClose} labelledBy="compose-post-title" maxWidth={520}>
      <div className="p-5 sm:p-6">
        <h2 id="compose-post-title" className="mb-4 text-center text-lg font-bold text-gray-900">
          New Post
        </h2>

        {previews.length > 0 ? (
          <div className="mb-4">
            <div className="relative">
              <PhotoCarousel
                images={previews.map((p) => ({ uri: p.url }))}
                naturalRatio
                onIndexChange={setCurrent}
              />
              <button
                type="button"
                onClick={() => void openAdjust(Math.min(current, previews.length - 1))}
                className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-[13px] font-semibold text-white"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2" />
                </svg>
                Adjust
              </button>
            </div>

            <p className="mt-2 text-[12px] text-gray-500">
              {previews.length > 1
                ? "Tap a photo to adjust · ‹ › to reorder"
                : "Tap the photo to adjust its framing"}
            </p>

            <div className="mt-2 flex flex-wrap gap-3">
              {previews.map((p, i) => (
                <div key={p.url} className="flex flex-col items-center gap-1">
                  <div className="relative h-20 w-20">
                    <button
                      type="button"
                      onClick={() => void openAdjust(i)}
                      aria-label={`Adjust photo ${i + 1}`}
                      className="block h-full w-full"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt="" className="h-full w-full rounded-xl object-cover" />
                    </button>
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[11px] font-bold text-white">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAt(i)}
                      aria-label={`Remove photo ${i + 1}`}
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-black/75 text-white"
                    >
                      <CloseIcon size={13} />
                    </button>
                  </div>
                  {previews.length > 1 && (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        aria-label={`Move photo ${i + 1} earlier`}
                        className="flex h-8 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-900 disabled:opacity-35"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        disabled={i === previews.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label={`Move photo ${i + 1} later`}
                        className="flex h-8 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-900 disabled:opacity-35"
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {files.length < 5 && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  aria-label="Add more photos"
                  className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-dashed"
                  style={{ borderColor: "#0FA6A6", color: "#0FA6A6" }}
                >
                  <ImageIcon size={20} />
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
    </>
  );
}
