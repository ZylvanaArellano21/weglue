"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";

const PRESET_COLORS = [
  { id: "teal", color: "#0FA6A6" },
  { id: "purple", color: "#8B5CF6" },
  { id: "red", color: "#EF4444" },
  { id: "blue", color: "#3B82F6" },
  { id: "orange", color: "#F97316" },
  { id: "green", color: "#22C55E" },
  { id: "yellow", color: "#EAB308" },
  { id: "pink", color: "#EC4899" },
];

export default function AvatarPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState("you");

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setSelectedPreset(null);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function handleDone() {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    let avatarUrl: string | null = null;

    if (selectedFile) {
      const ext = selectedFile.name.split(".").pop() ?? "jpg";
      const fileName = `${user.id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("avatars")
        .upload(fileName, selectedFile, { upsert: true });
      if (!error) {
        const { data } = supabase.storage.from("avatars").getPublicUrl(fileName);
        avatarUrl = data.publicUrl;
      }
    } else if (selectedPreset) {
      avatarUrl = `preset:${selectedPreset}`;
    }

    if (avatarUrl) {
      await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("id", user.id);
    }

    setLoading(false);
    router.push("/auth/survey");
  }

  const initial = username[0]?.toUpperCase() ?? "U";

  return (
    <main className="min-h-screen bg-cream flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-zain font-bold text-gray-900 text-center mb-8">
          @{username}, personalize your picture
        </h1>

        {/* Upload area */}
        <div className="flex justify-center mb-8">
          <button
            onClick={() => fileRef.current?.click()}
            className="w-36 h-36 rounded-full border-2 border-dashed border-teal flex items-center justify-center bg-white overflow-hidden hover:bg-teal/5 transition-colors"
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="preview" className="w-full h-full object-cover" />
            ) : selectedPreset ? (
              <div
                className="w-full h-full flex items-center justify-center text-white text-4xl font-bold"
                style={{
                  backgroundColor:
                    PRESET_COLORS.find((c) => c.id === selectedPreset)?.color,
                }}
              >
                {initial}
              </div>
            ) : (
              <span className="text-teal text-5xl">+</span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Upload options */}
        <div className="mb-8">
          <p className="font-zain font-bold text-gray-700 mb-3">You can add:</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center gap-2 bg-white border border-gray-200 rounded-2xl py-4 hover:border-teal transition-colors"
            >
              <span className="text-2xl">🖼️</span>
              <span className="text-sm text-gray-600">Upload Photo</span>
            </button>
            <button className="flex flex-col items-center gap-2 bg-white border border-gray-200 rounded-2xl py-4 hover:border-teal transition-colors">
              <span className="text-2xl">✏️</span>
              <span className="text-sm text-gray-600">Text Initials</span>
            </button>
          </div>
        </div>

        {/* Preset avatars */}
        <div className="mb-8">
          <p className="font-zain font-bold text-gray-700 mb-3">
            Or choose a We Glue avatar:
          </p>
          <div className="flex flex-wrap gap-3">
            {PRESET_COLORS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  setSelectedPreset(preset.id);
                  setPreviewUrl(null);
                  setSelectedFile(null);
                }}
                className="relative w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg transition-transform hover:scale-110"
                style={{ backgroundColor: preset.color }}
              >
                {initial}
                {selectedPreset === preset.id && (
                  <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-teal flex items-center justify-center text-white text-xs">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleDone}
          disabled={loading}
          className="w-full bg-teal text-white font-zain font-bold text-lg rounded-full py-4 hover:bg-teal/90 transition-colors disabled:opacity-60 flex items-center justify-center"
        >
          {loading ? (
            <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            "Done"
          )}
        </button>
      </div>
    </main>
  );
}
