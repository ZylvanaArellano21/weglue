"use client";

import { useRef, useState } from "react";
import { Modal } from "../shared/Modal";
import { Avatar, parsePresetColor, parseTextAvatar } from "../shared/Avatar";
import { ImageIcon } from "../shared/icons";
import { useToast } from "../shared/Toast";
import { useUpdateProfileAvatar, useUploadAvatar } from "../../lib/hooks/useOwnProfile";

// The real backend avatar options (apps/mobile/app/profile/edit-profile-pic.tsx):
// a Photo upload, a Text monogram, or one of the We Glue preset colors. The
// screenshot's illustrated character avatars do NOT exist in the product/
// backend, so they are intentionally not offered (no fake options). Camera is
// mobile-only; desktop uses an accessible file upload.
const PRESET_COLORS = ["#0FA6A6", "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7"];
const TEXT_MAX = 4;

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

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingFilePreview, setPendingFilePreview] = useState<string | null>(null);
  const [pendingPreset, setPendingPreset] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [showText, setShowText] = useState(false);

  const existingPreset = parsePresetColor(currentAvatarUrl);
  const existingText = parseTextAvatar(currentAvatarUrl);

  const previewUri =
    pendingFilePreview ?? (currentAvatarUrl && !existingPreset && !existingText ? currentAvatarUrl : null);
  const previewPreset = pendingPreset ?? existingPreset;
  const previewText = showText || text ? text : existingText;

  const busy = upload.isPending || updateAvatar.isPending;
  const hasChange = !!pendingFile || !!pendingPreset || (showText && !!text.trim());

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      show("Please choose an image file.", "error");
      return;
    }
    setPendingFile(file);
    setPendingFilePreview(URL.createObjectURL(file));
    setPendingPreset(null);
    setShowText(false);
    setText("");
  };

  const onSave = async () => {
    if (!hasChange || busy) return;
    try {
      if (pendingFile) {
        await upload.mutateAsync(pendingFile);
      } else if (pendingPreset) {
        await updateAvatar.mutateAsync({ avatarUrl: `preset:${pendingPreset}`, avatarType: "text" });
      } else if (showText && text.trim()) {
        await updateAvatar.mutateAsync({ avatarUrl: `text:${text.trim()}`, avatarType: "text" });
      }
      show("Profile picture updated!");
      onClose();
    } catch {
      show("Could not save your profile picture. Please try again.", "error");
    }
  };

  return (
    <Modal onClose={onClose} labelledBy="avatar-picker-title" maxWidth={440}>
      <div className="p-5 sm:p-6">
        <h2 id="avatar-picker-title" className="mb-5 text-center text-lg font-bold text-gray-900">
          {username}, personalize your picture
        </h2>

        <div className="mb-6 flex justify-center">
          <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-2 border-dashed" style={{ borderColor: "#D1D5DB" }}>
            {previewUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUri} alt="preview" className="h-full w-full object-cover" />
            ) : previewText || previewPreset ? (
              <Avatar uri={previewText ? `text:${previewText}` : `preset:${previewPreset}`} size={112} name={username} />
            ) : (
              <span className="text-gray-300">
                <ImageIcon size={32} />
              </span>
            )}
          </div>
        </div>

        <p className="mb-2 text-center text-sm font-medium text-gray-500">You can add:</p>
        <div className="mb-4 flex justify-center gap-6">
          <button type="button" onClick={() => fileRef.current?.click()} className="flex flex-col items-center gap-1.5">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl text-white" style={{ background: "#0FA6A6" }}>
              <ImageIcon size={22} />
            </span>
            <span className="text-xs text-gray-500">Photo</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShowText(true);
              setPendingFile(null);
              setPendingFilePreview(null);
              setPendingPreset(null);
            }}
            className="flex flex-col items-center gap-1.5"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl font-bold text-white" style={{ background: "#0FA6A6" }}>
              A+
            </span>
            <span className="text-xs text-gray-500">Text</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>

        {showText && (
          <div className="mb-4 flex justify-center">
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, TEXT_MAX).toUpperCase())}
              placeholder="ZA"
              maxLength={TEXT_MAX}
              aria-label="Avatar initials"
              className="h-12 w-32 rounded-lg border-[1.5px] text-center text-xl font-bold tracking-widest outline-none"
              style={{ borderColor: "#0FA6A6" }}
            />
          </div>
        )}

        <p className="mb-3 text-center text-sm font-medium text-gray-700">Or choose a We Glue avatar</p>
        <div className="mb-6 flex flex-wrap justify-center gap-3">
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Preset color ${color}`}
              aria-pressed={pendingPreset === color}
              onClick={() => {
                setPendingPreset(color);
                setPendingFile(null);
                setPendingFilePreview(null);
                setShowText(false);
                setText("");
              }}
              className="h-12 w-12 rounded-full"
              style={{
                background: color,
                outline: pendingPreset === color ? "3px solid rgba(15,166,166,0.5)" : "none",
                outlineOffset: 2,
              }}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={onSave}
          disabled={!hasChange || busy}
          className="w-full rounded-full py-3 text-[15px] font-semibold text-white disabled:opacity-50"
          style={{ background: "#0FA6A6" }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
