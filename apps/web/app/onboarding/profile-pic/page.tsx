"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";
import { useOnboardingStore } from "@weglue/shared";

const PRESET_COLORS = [
  "#4CAF50", "#9C27B0", "#E91E63", "#2196F3", "#FF9800",
  "#F44336", "#FFEB3B", "#000000", "#00BCD4", "#795548",
];

function Toast({ message, type }: { message: string; type: "success" | "error" | "info" }) {
  const bg =
    type === "error" ? "bg-[#F02719]" : type === "success" ? "bg-[#0FA6A6]" : "bg-gray-800";
  return (
    <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 ${bg} text-white font-semibold text-sm px-5 py-3 rounded-xl shadow-lg max-w-sm text-center`}>
      {message}
    </div>
  );
}

export default function WebProfilePicPage(): JSX.Element | null {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const { pendingUsername, selectedInterests, selectedActivities } = useOnboardingStore();

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  function showToast(message: string, type: "success" | "error" | "info" = "success") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarUrl(URL.createObjectURL(file));
    setSelectedPreset(null);
  }

  function selectPreset(color: string) {
    setSelectedPreset(color);
    setAvatarUrl(null);
    setAvatarFile(null);
  }

  function clearAvatar() {
    setAvatarUrl(null);
    setAvatarFile(null);
    setSelectedPreset(null);
  }

  async function handleDone() {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/auth/login"); return; }

    try {
      let finalAvatarUrl: string | null = null;

      if (avatarFile) {
        const ext = avatarFile.name.split(".").pop() ?? "jpg";
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(`${user.id}/avatar.${ext}`, avatarFile, { upsert: true });
        if (!uploadError) {
          const { data } = supabase.storage.from("avatars").getPublicUrl(`${user.id}/avatar.${ext}`);
          // Cache-bust: this fixed path reuses the same URL on every upload,
          // and image caches key purely by URL — without this the old picture
          // keeps rendering until cache eviction.
          finalAvatarUrl = `${data.publicUrl}?v=${Date.now()}`;
        }
      } else if (selectedPreset) {
        finalAvatarUrl = `preset:${selectedPreset}`;
      }

      // Only overwrite the username when this signup session actually chose
      // one. The profile row already holds the username picked at signup —
      // falling back to the email prefix here silently destroyed real
      // usernames whenever pendingUsername was lost (e.g. cold-start resume).
      const profileUpdate: Record<string, unknown> = {
        avatar_url: finalAvatarUrl,
        avatar_type: avatarFile ? "photo" : selectedPreset ? "preset" : null,
      };
      if (pendingUsername) profileUpdate.username = pendingUsername;

      await supabase.from("profiles").update(profileUpdate).eq("id", user.id);

      if (selectedInterests.length > 0) {
        await supabase.from("user_interests").upsert(
          selectedInterests.map((interest) => ({ user_id: user.id, interest })),
          { onConflict: "user_id,interest" }
        );
      }

      if (selectedActivities.length > 0) {
        await supabase.from("user_activities").upsert(
          selectedActivities.map((activity) => ({ user_id: user.id, activity })),
          { onConflict: "user_id,activity" }
        );
      }

      router.push("/onboarding/matches");
    } catch {
      showToast("Something went wrong. Please try again.", "error");
      setLoading(false);
    }
  }

  const displayName = pendingUsername || "there";

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex items-start justify-center px-4 py-8">
      {toast && <Toast message={toast.message} type={toast.type} />}
      <div className="w-full max-w-sm">
        {/* Back */}
        <Link href="/onboarding/signup" className="inline-flex items-center text-black mb-4 hover:opacity-70 transition-opacity">
          <span className="text-3xl leading-none">‹</span>
        </Link>

        <h1 className="text-2xl font-bold text-black text-center mb-2">One last step</h1>
        <p className="text-sm text-[#5F5D5D] text-center mb-6 leading-relaxed">
          Add a profile picture so your friends can recognize your
        </p>

        {/* Avatar preview */}
        <div className="flex justify-center mb-6 relative">
          <div
            className="w-40 h-40 rounded-full border-2 border-dashed border-black/25 overflow-hidden flex items-center justify-center"
            style={selectedPreset ? { backgroundColor: selectedPreset, borderStyle: "solid" } : {}}
          >
            {avatarUrl && (
              <Image src={avatarUrl} alt="Profile" width={160} height={160} className="w-full h-full object-cover" />
            )}
          </div>
          {(avatarUrl || selectedPreset) && (
            <button
              onClick={clearAvatar}
              className="absolute top-0 right-16 w-7 h-7 rounded-full bg-black/60 text-white text-xs flex items-center justify-center hover:bg-black/80 transition-colors"
            >
              ✕
            </button>
          )}
        </div>

        {/* Upload options */}
        <p className="text-sm font-semibold text-black text-center mb-4">You can add:</p>
        <div className="flex justify-center gap-8 mb-6">
          <button onClick={() => fileRef.current?.click()} className="flex flex-col items-center gap-1.5">
            <div className="w-14 h-14 rounded-xl bg-[#0FA6A6] flex items-center justify-center text-2xl hover:bg-[#0d9494] transition-colors">📷</div>
            <span className="text-xs font-medium text-black">Photo</span>
          </button>
          <button onClick={() => showToast("Camera not available on web.", "info")} className="flex flex-col items-center gap-1.5">
            <div className="w-14 h-14 rounded-xl bg-[#0FA6A6] flex items-center justify-center text-2xl hover:bg-[#0d9494] transition-colors">🖼️</div>
            <span className="text-xs font-medium text-black">Gallery</span>
          </button>
          <button onClick={() => showToast("Text avatar coming soon!", "info")} className="flex flex-col items-center gap-1.5">
            <div className="w-14 h-14 rounded-xl bg-[#0FA6A6] flex items-center justify-center font-bold text-white text-lg hover:bg-[#0d9494] transition-colors">A+</div>
            <span className="text-xs font-medium text-black">Text</span>
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

        {/* Preset avatars */}
        <p className="text-sm font-semibold text-black text-center mb-4">Or choose a We Glue avatar</p>
        <div className="flex justify-center gap-3 mb-3">
          {PRESET_COLORS.slice(0, 5).map((color) => (
            <button
              key={color}
              onClick={() => selectPreset(color)}
              className="w-12 h-12 rounded-full transition-all hover:scale-110"
              style={{
                backgroundColor: color,
                outline: selectedPreset === color ? `3px solid #0FA6A6` : "none",
                outlineOffset: "2px",
              }}
            />
          ))}
        </div>
        <div className="flex justify-center gap-3 mb-6">
          {PRESET_COLORS.slice(5).map((color) => (
            <button
              key={color}
              onClick={() => selectPreset(color)}
              className="w-12 h-12 rounded-full transition-all hover:scale-110"
              style={{
                backgroundColor: color,
                outline: selectedPreset === color ? `3px solid #0FA6A6` : "none",
                outlineOffset: "2px",
              }}
            />
          ))}
        </div>

        {/* Welcome banner */}
        <div className="bg-[#0FA6A6] rounded-xl p-4 mb-6">
          <p className="font-bold text-white text-sm mb-1">Welcome to We Glue, {displayName}!</p>
          <p className="text-white text-xs leading-relaxed">
            Your clubs are ready. Events are waiting. Your campus is calling.
          </p>
        </div>

        {/* Done */}
        <button
          onClick={handleDone}
          disabled={loading}
          className="w-full h-[52px] bg-[#0FA6A6] text-[#FEFCF0] font-semibold text-base rounded-[40px] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors disabled:opacity-60 flex items-center justify-center"
        >
          {loading ? (
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            "Done"
          )}
        </button>
      </div>
    </main>
  );
}
