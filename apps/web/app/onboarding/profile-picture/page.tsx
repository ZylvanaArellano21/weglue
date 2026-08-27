"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PRESET_AVATARS,
  generatePendingAvatarToken,
  presetAvatarValue,
  type AvatarChoice,
  type PresetAvatarId,
} from "@weglue/shared";
import { Avatar } from "../../../components/shared/Avatar";
import { CameraIcon, ImageIcon } from "../../../components/shared/icons";
import { uploadPendingAvatar } from "../../../lib/imageUpload";
import { readOnboardingState, writeOnboardingState } from "../../../lib/onboardingState";

// Mandatory onboarding step between Activities and the username/email form.
// Same four sources as apps/web/components/profile/AvatarPickerModal.tsx
// (the existing edit-picture screen), ported to a full onboarding page:
// there is no account yet to attach an avatar to, so preset/text choices are
// just held here and travel to the server as signup metadata (like
// interests/activities already do), while Camera/Photo upload immediately to
// the pre-auth `pending-avatars` bucket — see migration 098.

const TEXT_MAX = 4;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
const ACCEPT_ATTR = ACCEPTED_TYPES.join(",");
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MIN_DIMENSION = 64;

type Pending =
  | { kind: "none" }
  | { kind: "image"; blob: Blob; previewUrl: string; source: "photo" | "camera" }
  | { kind: "preset"; id: PresetAvatarId }
  | { kind: "text"; value: string };

export default function OnboardingProfilePicturePage(): JSX.Element {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [pending, setPending] = useState<Pending>({ kind: "none" });
  const [textDraft, setTextDraft] = useState("");
  const [textOpen, setTextOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  // Restore a preset/text choice on Back navigation. A local image pick can't
  // be restored (never persisted, only its eventual upload token) — same
  // limitation the existing edit-picture screen has.
  useEffect(() => {
    const existing = readOnboardingState().avatarChoice;
    if (existing?.kind === "preset") setPending({ kind: "preset", id: existing.id as PresetAvatarId });
    else if (existing?.kind === "text") {
      setPending({ kind: "text", value: existing.value });
      setTextDraft(existing.value);
      setTextOpen(true);
    }
  }, []);

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
    try {
      const dims = await readImageSize(file);
      if (dims.width < MIN_DIMENSION || dims.height < MIN_DIMENSION) {
        setError(`That image is too small — it needs to be at least ${MIN_DIMENSION}×${MIN_DIMENSION} pixels.`);
        return;
      }
    } catch {
      setError("We couldn't read that image. Please try a different file.");
      return;
    }
    setPendingImage(file, "photo");
  };

  const hasSelection = pending.kind !== "none";

  const onDone = async () => {
    if (!hasSelection || saving || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      let choice: AvatarChoice;
      if (pending.kind === "image") {
        const token = generatePendingAvatarToken();
        await uploadPendingAvatar(token, pending.blob);
        choice = { kind: pending.source, token };
      } else if (pending.kind === "preset") {
        choice = { kind: "preset", id: pending.id };
      } else {
        choice = { kind: "text", value: pending.value };
      }
      writeOnboardingState({ avatarChoice: choice });
      router.push("/onboarding/signup");
    } catch {
      setError("Could not save your picture. Please try again.");
    } finally {
      setSaving(false);
      inFlight.current = false;
    }
  };

  const preview: { image?: string; avatarUri?: string } = (() => {
    if (pending.kind === "image") return { image: pending.previewUrl };
    if (pending.kind === "preset") return { avatarUri: presetAvatarValue(pending.id) };
    if (pending.kind === "text") return { avatarUri: `text:${pending.value}` };
    if (textOpen && textDraft) return { avatarUri: `text:${textDraft}` };
    return {};
  })();

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex justify-center px-4 py-5 sm:px-6 sm:py-8">
      <div className="w-full max-w-[560px]">
        {/* Back arrow — lands on Activities */}
        <div className="mb-5 sm:mb-8">
          <Link
            href="/onboarding/activities"
            aria-label="Back to Activities"
            className="inline-flex h-10 w-10 items-center justify-center text-[30px] leading-none text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0FA6A6]"
          >
            ‹
          </Link>
        </div>

        <h1 className="text-[22px] sm:text-[27px] font-bold text-[#0FA6A6] leading-tight mb-2 sm:mb-3 text-center">
          Add a profile picture
        </h1>
        <p className="text-[14px] sm:text-[17px] text-[#0FA6A6] mb-6 sm:mb-9 leading-relaxed text-center">
          Choose a photo, your initials, or a We Glue avatar so people recognize you.
        </p>

        {/* Preview */}
        <div className="mb-6 flex justify-center">
          <div
            className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border-2 border-dashed bg-white"
            style={{ borderColor: hasSelection ? "#0FA6A6" : "#D1D5DB", borderStyle: hasSelection ? "solid" : "dashed" }}
          >
            {preview.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.image} alt="Your new profile picture" className="h-full w-full object-cover" />
            ) : preview.avatarUri ? (
              <Avatar uri={preview.avatarUri} size={128} />
            ) : (
              <span className="text-gray-300" aria-hidden>
                <ImageIcon size={34} />
              </span>
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
            disabled={saving}
          >
            <CameraIcon size={22} />
          </SourceButton>
          <SourceButton label="Photo" onClick={() => fileRef.current?.click()} disabled={saving}>
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
            disabled={saving}
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
        <div className="mb-6 max-h-[280px] overflow-y-auto pr-1" aria-label="We Glue avatar choices">
          <div className="grid grid-cols-5 justify-items-center gap-3">
            {PRESET_AVATARS.map((avatar) => {
              const selected = pending.kind === "preset" && pending.id === avatar.id;
              return (
                <button
                  key={avatar.id}
                  type="button"
                  disabled={saving}
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
                  <Avatar uri={presetAvatarValue(avatar.id)} size={48} />
                  {selected && (
                    <span
                      aria-hidden
                      className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#FEFCF0] bg-[#0FA6A6] text-xs font-bold leading-none text-white"
                    >
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col items-center gap-3 pb-8">
          {error && (
            <p role="alert" className="text-center text-[13px] leading-relaxed text-[#F02719]">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void onDone()}
            disabled={!hasSelection || saving}
            aria-busy={saving}
            className="flex w-full max-w-[300px] items-center justify-center gap-2 rounded-full bg-[#0FA6A6] py-3 text-[15px] font-semibold text-white transition-opacity hover:opacity-95 disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            {saving ? (
              <>
                <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {pending.kind === "image" ? "Uploading…" : "Saving…"}
              </>
            ) : (
              "Done"
            )}
          </button>
        </div>
      </div>

      {cameraOpen && (
        <CameraCapture
          onCancel={() => setCameraOpen(false)}
          onCapture={(blob) => {
            setCameraOpen(false);
            setPendingImage(blob, "camera");
          }}
        />
      )}
    </main>
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
      className="flex flex-col items-center gap-1.5 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0FA6A6] focus-visible:ring-offset-2"
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

// ─── Camera (ported from AvatarPickerModal.tsx) ─────────────────────────────

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
          setMessage("Camera access was denied. Allow it in your browser's site settings, or use Photo instead.");
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

  useEffect(() => {
    if (!shot) return;
    return () => URL.revokeObjectURL(shot.url);
  }, [shot]);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    if (!side) return;
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, side, side);
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
              className="flex-1 rounded-full border border-[#0FA6A6] bg-white py-2.5 text-[15px] font-semibold text-[#0FA6A6] hover:bg-[#0FA6A6]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Retake
            </button>
            <button
              type="button"
              onClick={() => onCapture(shot.blob)}
              className="flex-1 rounded-full bg-[#0FA6A6] py-2.5 text-[15px] font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Use photo
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={capture}
            disabled={status !== "live"}
            className="flex-1 rounded-full bg-[#0FA6A6] py-2.5 text-[15px] font-semibold text-white disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            Capture
          </button>
        )}
      </div>
    </CameraShell>
  );
}

function CameraShell({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
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
      <div role="dialog" aria-modal="true" aria-label="Take a picture" className="my-auto w-full max-w-[380px] rounded-2xl bg-white p-6 shadow-2xl">
        {children}
      </div>
    </div>
  );
}

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
