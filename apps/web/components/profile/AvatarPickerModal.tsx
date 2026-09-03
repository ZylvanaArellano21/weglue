"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../shared/Modal";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { ImageCropper } from "../shared/ImageCropper";
import { Avatar, parsePresetColor, parseTextAvatar } from "../shared/Avatar";
import { CameraIcon, CloseCircleIcon, ImageIcon } from "../shared/icons";
import { useToast } from "../shared/Toast";
import { useUpdateProfileAvatar, useUploadAvatar } from "../../lib/hooks/useOwnProfile";
import {
  PRESET_AVATARS,
  parsePresetAvatarId,
  presetAvatarValue,
  type PresetAvatarId,
} from "@weglue/shared";

// ─── Profile-picture editor (web) ────────────────────────────────────────────
//
// Port of apps/mobile/app/profile/edit-profile-pic.tsx. Same four sources, the
// same order, and the same values written to the SAME `profiles.avatar_url`
// column mobile uses:
//
//   Camera → an image captured now      → uploaded, avatar_type 'camera'
//   Photo  → an image file from disk    → uploaded, avatar_type 'photo'
//   Text   → up to 4 uppercase initials → `text:ZA`,          avatar_type 'text'
//   We Glue avatar → bundled stable preset       → `preset:avatar_01`
//
// Nothing is written until Save. Camera permission is requested ONLY when the
// student actually chooses Camera.

const TEXT_MAX = 4;

/** Formats the browser accepts and the canvas downscaler can decode. */
const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
];
const ACCEPT_ATTR = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";
/** Pre-compression ceiling. Everything is downscaled to 800px and re-encoded. */
const MAX_FILE_BYTES = 15 * 1024 * 1024;
/** Below this the source is too small to make a usable avatar. */
const MIN_DIMENSION = 64;

type Pending =
  | { kind: "none" }
  | { kind: "image"; blob: Blob; previewUrl: string; source: "photo" | "camera" }
  | { kind: "preset"; id: PresetAvatarId }
  | { kind: "text"; value: string }
  | { kind: "remove" };

export function AvatarPickerModal({
  userId,
  username,
  currentAvatarUrl,
  onClose,
}: {
  userId: string;
  username: string;
  currentAvatarUrl: string | null;
  onClose: () => void;
}): JSX.Element {
  const show = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useUploadAvatar(userId);
  const updateAvatar = useUpdateProfileAvatar(userId);

  const [pending, setPending] = useState<Pending>({ kind: "none" });
  const [textDraft, setTextDraft] = useState("");
  const [textOpen, setTextOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The picked/captured image waiting to be framed 1:1 in the cropper.
  const [cropSource, setCropSource] = useState<{ url: string; source: "photo" | "camera" } | null>(null);

  // Synchronous re-entry guard: `busy` only blocks the SECOND click after a
  // re-render, so two clicks in one frame would both start an upload.
  const inFlight = useRef(false);
  const busy = upload.isPending || updateAvatar.isPending;

  // Revoke the object URL when the preview is replaced or the modal closes —
  // otherwise every retake leaks a blob for the life of the document.
  const previewUrlRef = useRef<string | null>(null);
  const setPendingImage = useCallback((blob: Blob, source: "photo" | "camera") => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const previewUrl = URL.createObjectURL(blob);
    previewUrlRef.current = previewUrl;
    setPending({ kind: "image", blob, previewUrl, source });
    setTextOpen(false);
    setTextDraft("");
    setError(null);
  }, []);
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    []
  );

  const existingPresetId = parsePresetAvatarId(currentAvatarUrl);
  const existingPreset = parsePresetColor(currentAvatarUrl);
  const existingText = parseTextAvatar(currentAvatarUrl);
  const existingImage =
    currentAvatarUrl && !existingPresetId && !existingPreset && !existingText ? currentAvatarUrl : null;
  const hasExistingAvatar = !!currentAvatarUrl;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);

    if (!file.type.startsWith("image/") || !ACCEPTED_TYPES.includes(file.type.toLowerCase())) {
      setError("Please choose a JPEG, PNG, WebP, GIF or HEIC image.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("That image is too large. Please choose one under 15 MB.");
      return;
    }

    // Dimension check before anything is uploaded.
    try {
      const dims = await readImageSize(file);
      if (dims.width < MIN_DIMENSION || dims.height < MIN_DIMENSION) {
        setError(
          `That image is too small — it needs to be at least ${MIN_DIMENSION}×${MIN_DIMENSION} pixels.`
        );
        return;
      }
    } catch {
      setError("We couldn't read that image. Please try a different file.");
      return;
    }

    setCropSource({ url: URL.createObjectURL(file), source: "photo" });
  };

  const closeCrop = () => {
    setCropSource((cur) => {
      if (cur) URL.revokeObjectURL(cur.url);
      return null;
    });
  };

  const onSave = async () => {
    if (pending.kind === "none" || busy || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      if (pending.kind === "image") {
        await upload.mutateAsync({ blob: pending.blob, source: pending.source });
      } else if (pending.kind === "preset") {
        await updateAvatar.mutateAsync({
          avatarUrl: presetAvatarValue(pending.id),
          avatarType: "preset",
        });
      } else if (pending.kind === "text") {
        await updateAvatar.mutateAsync({
          avatarUrl: `text:${pending.value}`,
          avatarType: "text",
        });
      } else if (pending.kind === "remove") {
        // The no-avatar state is the SAME one every new account starts in, and
        // Avatar.tsx on both platforms already renders the initials fallback for
        // it — this is not a web-only concept.
        await updateAvatar.mutateAsync({ avatarUrl: null, avatarType: null });
      }
      show("Profile picture updated!");
      onClose();
    } catch {
      setError("Could not save your profile picture. Please try again.");
    } finally {
      inFlight.current = false;
    }
  };

  /** What the preview circle shows right now: the pending choice, else current. */
  const preview: { image?: string; avatarUri?: string } = (() => {
    if (pending.kind === "image") return { image: pending.previewUrl };
    if (pending.kind === "preset") return { avatarUri: presetAvatarValue(pending.id) };
    if (pending.kind === "text") return { avatarUri: `text:${pending.value}` };
    if (pending.kind === "remove") return {};
    if (textOpen && textDraft) return { avatarUri: `text:${textDraft}` };
    if (existingImage) return { image: existingImage };
    if (currentAvatarUrl) return { avatarUri: currentAvatarUrl };
    return {};
  })();

  const showClear = pending.kind !== "none" || hasExistingAvatar;

  const onClear = () => {
    if (pending.kind !== "none") {
      // First press just abandons the unsaved selection.
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      setPending({ kind: "none" });
      setTextOpen(false);
      setTextDraft("");
      setError(null);
      return;
    }
    // Nothing pending but there IS a saved picture → offer to remove it.
    setConfirmRemove(true);
  };

  return (
    <Modal onClose={onClose} labelledBy="avatar-picker-title" maxWidth={440}>
      <div className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden p-5 sm:p-6">
        <h2 id="avatar-picker-title" className="mb-5 text-center text-[17px] font-bold text-gray-900">
          {username}, you can personalize your picture
        </h2>

        {/* Preview */}
        <div className="mb-6 flex justify-center">
          <div className="relative">
            <div
              className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border-2 border-dashed bg-white"
              style={{ borderColor: "#D1D5DB" }}
            >
              {preview.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview.image}
                  alt="Your new profile picture"
                  className="h-full w-full object-cover"
                />
              ) : preview.avatarUri ? (
                <Avatar uri={preview.avatarUri} size={128} name={username} />
              ) : (
                <span className="text-gray-300" aria-hidden>
                  <ImageIcon size={34} />
                </span>
              )}
            </div>

            {showClear && (
              <button
                type="button"
                onClick={onClear}
                disabled={busy}
                aria-label={
                  pending.kind !== "none"
                    ? "Discard this selection"
                    : "Remove your current profile picture"
                }
                className="absolute -right-1 top-0 rounded-full bg-white text-gray-700 shadow-sm transition-colors hover:text-gray-900 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
              >
                <CloseCircleIcon size={24} />
              </button>
            )}
          </div>
        </div>

        {/* Sources */}
        <p className="mb-2.5 text-center text-sm font-medium text-gray-500">You can add:</p>
        <div className="mb-4 flex justify-center gap-7">
          <SourceButton
            label="Camera"
            onClick={() => {
              setError(null);
              setCameraOpen(true);
            }}
            disabled={busy}
          >
            <CameraIcon size={22} />
          </SourceButton>
          <SourceButton label="Photo" onClick={() => fileRef.current?.click()} disabled={busy}>
            <ImageIcon size={22} />
          </SourceButton>
          <SourceButton
            label="Text"
            onClick={() => {
              setTextOpen(true);
              setPending({ kind: "none" });
              setTextDraft("");
              setError(null);
            }}
            disabled={busy}
          >
            <span className="text-[17px] font-bold">A+</span>
          </SourceButton>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              // Reset so re-picking the same file fires `change` again.
              e.target.value = "";
            }}
          />
        </div>

        {textOpen && (
          <div className="mb-4 flex flex-col items-center gap-2">
            <label htmlFor="avatar-initials" className="sr-only">
              Avatar initials, up to {TEXT_MAX} characters
            </label>
            <input
              id="avatar-initials"
              autoFocus
              value={textDraft}
              onChange={(e) => {
                const value = e.target.value.slice(0, TEXT_MAX).toUpperCase();
                setTextDraft(value);
                setPending(value.trim() ? { kind: "text", value: value.trim() } : { kind: "none" });
              }}
              placeholder="ZA"
              maxLength={TEXT_MAX}
              className="h-12 w-36 rounded-lg border-[1.5px] bg-white text-center text-xl font-bold uppercase tracking-widest text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
              style={{ borderColor: "#0FA6A6" }}
            />
          </div>
        )}

        {/* Presets */}
        <p className="mb-3 text-center text-sm font-medium text-gray-700">
          Or choose a <span className="font-bold italic">We Glue</span> avatar
        </p>
        <div
          className="mb-5 h-[clamp(112px,calc(100vh-480px),204px)] min-h-[112px] overflow-y-auto pr-1 [scrollbar-color:rgba(15,166,166,0.45)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-teal/45 [&::-webkit-scrollbar]:w-1.5"
          aria-label="We Glue avatar choices"
        >
          <div className="grid grid-cols-5 justify-items-center gap-3">
          {PRESET_AVATARS.map((avatar) => {
            const selected = pending.kind === "preset" && pending.id === avatar.id;
            return (
              <button
                key={avatar.id}
                type="button"
                disabled={busy}
                aria-label={`Select ${avatar.label}`}
                aria-pressed={selected}
                onClick={() => {
                  setPending({ kind: "preset", id: avatar.id });
                  setTextOpen(false);
                  setTextDraft("");
                  setError(null);
                }}
                className="relative h-12 w-12 rounded-full transition-transform hover:scale-105 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                style={{
                  outline: selected ? "3px solid rgba(15,166,166,0.75)" : undefined,
                  outlineOffset: selected ? 2 : undefined,
                }}
              >
                <Avatar uri={presetAvatarValue(avatar.id)} size={48} name={username} />
                {selected && (
                  <span
                    aria-hidden
                    className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-cream bg-teal text-xs font-bold leading-none text-white"
                  >
                    ✓
                  </span>
                )}
              </button>
            );
          })}
          </div>
        </div>

        {error && (
          <p role="alert" className="mb-3 text-center text-[13px] leading-relaxed text-[#F02719]">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => void onSave()}
          disabled={pending.kind === "none" || busy}
          aria-busy={busy}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-teal py-3 text-[15px] font-semibold text-white transition-opacity hover:opacity-95 disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          {busy ? (
            <>
              <span
                aria-hidden
                className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
              />
              {pending.kind === "image" ? "Uploading…" : "Saving…"}
            </>
          ) : (
            "Save"
          )}
        </button>
      </div>

      {cameraOpen && (
        <CameraCapture
          onCancel={() => setCameraOpen(false)}
          onCapture={(blob) => {
            setCameraOpen(false);
            setCropSource({ url: URL.createObjectURL(blob), source: "camera" });
          }}
        />
      )}

      {cropSource && (
        <ImageCropper
          src={cropSource.url}
          aspect={[1, 1]}
          title="Position your picture"
          onCancel={closeCrop}
          onConfirm={({ blob }) => {
            setPendingImage(blob, cropSource.source);
            closeCrop();
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Remove profile picture?"
          message="Your profile will show your initials instead. You can add a new picture any time."
          confirmLabel="Remove"
          destructive
          onConfirm={() => {
            setConfirmRemove(false);
            setPending({ kind: "remove" });
          }}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </Modal>
  );
}

function SourceButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1.5 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2"
    >
      <span
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-xl text-white"
        style={{ background: "#0FA6A6" }}
      >
        {children}
      </span>
      <span className="text-xs text-gray-500">{label}</span>
    </button>
  );
}

// ─── Camera ──────────────────────────────────────────────────────────────────
//
// getUserMedia is requested ONLY when the student picks Camera — opening the
// picker never touches the camera. Every failure mode is handled explicitly:
// unsupported browser, insecure origin, permission denied, no camera present,
// and a device already in use by another app.

function CameraCapture({
  onCapture,
  onCancel,
}: {
  onCapture: (blob: Blob) => void;
  onCancel: () => void;
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"starting" | "live" | "error">("starting");
  const [message, setMessage] = useState<string>("");
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  // Bumped by Retake to re-run the stream request through the same code path.
  const [attempt, setAttempt] = useState(0);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setMessage(
          window.isSecureContext === false
            ? "Your browser only allows camera access over a secure (https) connection. Use Photo instead."
            : "Your browser doesn't support camera capture. Use Photo instead."
        );
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus("live");
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string })?.name ?? "";
        setStatus("error");
        if (name === "NotAllowedError" || name === "SecurityError") {
          setMessage(
            "Camera access was denied. Allow it in your browser's site settings, or use Photo instead."
          );
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setMessage("We couldn't find a camera on this device. Use Photo instead.");
        } else if (name === "NotReadableError") {
          setMessage("Your camera is being used by another app. Close it and try again.");
        } else {
          setMessage("We couldn't start your camera. Use Photo instead.");
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [stop, attempt]);

  // Revoke the previous capture's object URL when it is replaced or unmounted.
  useEffect(() => {
    if (!shot) return;
    return () => URL.revokeObjectURL(shot.url);
  }, [shot]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    // Full frame — the 1:1 framing happens afterwards in the in-app cropper,
    // so the student can reposition rather than accept a fixed centre crop.
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setShot({ blob, url: URL.createObjectURL(blob) });
        stop();
      },
      "image/jpeg",
      0.9
    );
  };

  const retake = () => {
    setShot(null);
    setStatus("starting");
    setAttempt((n) => n + 1);
  };

  return (
    <CameraShell onCancel={onCancel}>
      <h3 className="text-center text-[16px] font-bold text-gray-900">Take a picture</h3>

      <div className="mt-4 flex justify-center">
        <div className="relative flex h-56 w-56 items-center justify-center overflow-hidden rounded-full bg-black/5">
          {shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot.url} alt="Captured preview" className="h-full w-full object-cover" />
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              aria-label="Camera preview"
              className="h-full w-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
          )}
          {status === "starting" && !shot && (
            <span className="absolute text-xs text-gray-500">Starting camera…</span>
          )}
        </div>
      </div>

      {status === "error" && (
        <p role="alert" className="mt-4 text-center text-[13px] leading-relaxed text-[#F02719]">
          {message}
        </p>
      )}

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={() => {
            stop();
            onCancel();
          }}
          className="flex-1 rounded-full border border-gray-200 bg-white py-2.5 text-[15px] font-semibold text-gray-900 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          Cancel
        </button>
        {shot ? (
          <>
            <button
              type="button"
              onClick={retake}
              className="flex-1 rounded-full border border-teal bg-white py-2.5 text-[15px] font-semibold text-teal hover:bg-teal/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Retake
            </button>
            <button
              type="button"
              onClick={() => onCapture(shot.blob)}
              className="flex-1 rounded-full bg-teal py-2.5 text-[15px] font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Use photo
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={capture}
            disabled={status !== "live"}
            className="flex-1 rounded-full bg-teal py-2.5 text-[15px] font-semibold text-white disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            Capture
          </button>
        )}
      </div>
    </CameraShell>
  );
}

/** Centred overlay above the picker — same layer as ConfirmDialog. */
function CameraShell({
  children,
  onCancel,
}: {
  children: React.ReactNode;
  onCancel: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Cancel the camera only — do not also close the picker beneath it.
        e.stopPropagation();
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Take a picture"
        className="my-auto w-full max-w-[380px] rounded-2xl bg-white p-6 shadow-2xl"
      >
        {children}
      </div>
    </div>
  );
}

/** Reads intrinsic dimensions without decoding the file into the DOM. */
async function readImageSize(file: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("unreadable"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
