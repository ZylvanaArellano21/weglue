"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";

const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Placeholder avatar colours if no preset images exist in storage
const PLACEHOLDER_COLORS = [
  "#0FA6A6", "#F97316", "#8B5CF6", "#EC4899", "#10B981",
  "#3B82F6", "#F59E0B", "#EF4444", "#6366F1", "#14B8A6",
];

type AvatarSource =
  | { kind: "preset"; url: string }
  | { kind: "placeholder"; color: string; index: number }
  | { kind: "upload"; file: File; preview: string };

function LegalFooter() {
  return (
    <p className="text-center text-[10px] text-[#5F5D5D] mt-6">
      <Link href="/privacy-policy" className="hover:text-[#0FA6A6] underline">
        Privacy Policy
      </Link>
      {" · "}
      <Link href="/terms-of-service" className="hover:text-[#0FA6A6] underline">
        Terms of Service
      </Link>
    </p>
  );
}

export default function AvatarPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [presetUrls, setPresetUrls] = useState<string[]>([]);
  const [selected, setSelected] = useState<AvatarSource | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      setUserId(user.id);

      // Try to load preset avatars from storage bucket
      const { data: files } = await supabase.storage
        .from("avatars")
        .list("presets", { limit: 20 });

      if (files && files.length > 0) {
        const urls = files.map((f) => {
          const { data } = supabase.storage
            .from("avatars")
            .getPublicUrl(`presets/${f.name}`);
          return data.publicUrl;
        });
        setPresetUrls(urls);
      }
      setLoading(false);
    }
    init();
  }, [router]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);

    if (!file.type.startsWith("image/")) {
      setFileError("Please select a valid image file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError(`Image must be smaller than ${MAX_FILE_SIZE_MB} MB.`);
      return;
    }

    const preview = URL.createObjectURL(file);
    setSelected({ kind: "upload", file, preview });
  }

  async function handleDone() {
    if (!userId) return;
    setUploading(true);

    try {
      const supabase = createClient();
      let avatarUrl: string | null = null;

      if (selected?.kind === "upload") {
        const ext = selected.file.name.split(".").pop() ?? "jpg";
        // Path format: {userId}/avatar.{ext} — matches the storage UPDATE policy
        // which checks foldername(name)[1] = auth.uid()
        const path = `${userId}/avatar.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, selected.file, { upsert: true });

        if (uploadError) throw uploadError;

        const { data } = supabase.storage.from("avatars").getPublicUrl(path);
        avatarUrl = data.publicUrl;
      } else if (selected?.kind === "preset") {
        avatarUrl = selected.url;
      }
      // If null (skipped), avatar_url stays null

      await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl, avatar_type: selected ? "preset" : null })
        .eq("id", userId);

      router.push("/onboarding/explore-clubs");
    } catch (err) {
      console.error("Avatar upload failed:", err);
    } finally {
      setUploading(false);
    }
  }

  const avatarItems: AvatarSource[] =
    presetUrls.length > 0
      ? presetUrls.map((url) => ({ kind: "preset", url }))
      : PLACEHOLDER_COLORS.map((color, index) => ({
          kind: "placeholder",
          color,
          index,
        }));

  return (
    <main className="min-h-screen bg-[#FEFCF0] px-4 py-8 flex flex-col items-center">
      {/* Logo */}
      <Image src="/logo.png" alt="We Glue" width={48} height={48} className="mb-6" />

      {/* Step indicator */}
      <div className="w-full max-w-sm mb-6">
        <div className="h-1.5 bg-[#0FA6A6] rounded-full" />
        <p className="text-xs font-medium text-[#5F5D5D] mt-1.5">Step 2 of 2</p>
      </div>

      <h1
        className="text-2xl font-bold text-black mb-1 text-center"
        style={{ fontFamily: "var(--font-zain)" }}
      >
        Pick your avatar
      </h1>
      <p className="text-sm text-[#5F5D5D] mb-8 text-center">
        Choose a We Glue avatar or upload your own photo
      </p>

      {/* Current selection preview */}
      {selected && (
        <div className="mb-6">
          {selected.kind === "upload" ? (
            <Image
              src={selected.preview}
              alt="Selected avatar"
              width={80}
              height={80}
              className="w-20 h-20 rounded-full object-cover border-4 border-[#0FA6A6] shadow-md"
            />
          ) : selected.kind === "preset" ? (
            <Image
              src={selected.url}
              alt="Selected avatar"
              width={80}
              height={80}
              className="w-20 h-20 rounded-full object-cover border-4 border-[#0FA6A6] shadow-md"
            />
          ) : (
            <div
              className="w-20 h-20 rounded-full border-4 border-[#0FA6A6] shadow-md flex items-center justify-center text-2xl font-bold text-white"
              style={{ backgroundColor: selected.color }}
            >
              ✓
            </div>
          )}
        </div>
      )}

      {loading ? (
        <span className="w-8 h-8 border-4 border-[#0FA6A6] border-t-transparent rounded-full animate-spin" />
      ) : (
        <>
          {/* Avatar grid */}
          <div className="grid grid-cols-5 gap-3 mb-8 w-full max-w-sm">
            {avatarItems.map((item, i) => {
              const isSelected =
                selected?.kind === item.kind &&
                (item.kind === "placeholder"
                  ? (selected as { index: number }).index === item.index
                  : item.kind === "preset"
                  ? (selected as { url: string }).url === item.url
                  : false);

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected(item)}
                  className={`w-full aspect-square rounded-full transition-all ${
                    isSelected
                      ? "ring-4 ring-[#0FA6A6] ring-offset-2"
                      : "hover:ring-2 hover:ring-[#0FA6A6]/50"
                  }`}
                >
                  {item.kind === "preset" ? (
                    <Image
                      src={item.url}
                      alt={`Avatar ${i + 1}`}
                      width={56}
                      height={56}
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-full h-full rounded-full flex items-center justify-center text-white font-bold text-lg"
                      style={{
                        backgroundColor:
                          item.kind === "placeholder"
                            ? item.color
                            : "#0FA6A6",
                      }}
                    >
                      {String.fromCharCode(65 + i)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Upload photo */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mb-2 text-sm font-semibold text-[#0FA6A6] border border-[#0FA6A6] px-6 py-2.5 rounded-full hover:bg-[#E0F7F7] transition-colors"
          >
            Upload photo
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          {fileError && (
            <p className="text-xs text-[#F02719] mb-2">{fileError}</p>
          )}
          <p className="text-[10px] text-[#5F5D5D] mb-8">
            Max {MAX_FILE_SIZE_MB} MB · JPG, PNG, GIF, WEBP
          </p>
        </>
      )}

      {/* Done / Skip */}
      <div className="flex flex-col items-center gap-3 w-full max-w-sm">
        <button
          type="button"
          onClick={handleDone}
          disabled={uploading}
          className="w-full h-[52px] bg-[#0FA6A6] text-white font-semibold text-base rounded-[40px] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors disabled:opacity-60 flex items-center justify-center"
        >
          {uploading ? (
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            "Done"
          )}
        </button>
        <button
          type="button"
          onClick={handleDone}
          className="text-sm text-[#5F5D5D] hover:text-[#0FA6A6] transition-colors"
        >
          Skip for now
        </button>
      </div>

      <LegalFooter />
    </main>
  );
}
