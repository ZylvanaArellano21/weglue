"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "../home/AppHeader";
import { Avatar } from "../shared/Avatar";
import { PlusIcon } from "../shared/icons";
import { AvatarPickerModal } from "./AvatarPickerModal";
import { ToastProvider, useToast } from "../shared/Toast";
import { useOwnProfile, useUpdateDisplayName } from "../../lib/hooks/useOwnProfile";

// Matches the web Edit Profile screenshot: centered avatar with a ⊕ that opens
// the picture picker, an editable Display Name, and Save. Saving updates the
// shared profile row, so the Home card, header avatar, profile page and mobile
// all reflect it (full cache invalidation prevents stale copies).
export function EditProfileClient({ userId }: { userId: string }): JSX.Element {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-cream">
        <AppHeader userId={userId} />
        <EditProfileBody userId={userId} />
      </div>
    </ToastProvider>
  );
}

function EditProfileBody({ userId }: { userId: string }): JSX.Element {
  const router = useRouter();
  const show = useToast();
  const { data: profile } = useOwnProfile(userId);
  const updateName = useUpdateDisplayName(userId);

  const [name, setName] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [initialised, setInitialised] = useState(false);

  // Seed the field once from the loaded profile (don't clobber edits on refetch).
  useEffect(() => {
    if (!initialised && profile) {
      setName(profile.full_name ?? "");
      setInitialised(true);
    }
  }, [profile, initialised]);

  const dirty = initialised && name.trim() !== (profile?.full_name ?? "").trim();

  const onSave = async () => {
    if (!name.trim()) {
      show("Display name cannot be empty.", "error");
      return;
    }
    if (!dirty) {
      router.push("/profile");
      return;
    }
    try {
      await updateName.mutateAsync(name);
      show("Profile updated!");
      router.push("/profile");
    } catch {
      show("Could not save. Please try again.", "error");
    }
  };

  return (
    <main className="mx-auto max-w-xl px-6 py-8">
      <div className="relative flex items-center justify-center">
        <h1 className="text-lg font-bold text-gray-900">Edit profile</h1>
        <button
          type="button"
          onClick={onSave}
          disabled={updateName.isPending}
          className="absolute right-0 rounded-full px-6 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "#0FA6A6" }}
        >
          {updateName.isPending ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="mt-8 flex flex-col items-center">
        <div className="relative">
          <Avatar uri={profile?.avatar_url} size={132} name={profile?.full_name ?? profile?.username} />
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label="Change profile picture"
            className="absolute bottom-1 right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-cream bg-white"
            style={{ color: "#0FA6A6" }}
          >
            <PlusIcon size={18} strokeWidth={2.4} />
          </button>
        </div>

        <div className="mt-8 flex w-full max-w-sm items-center gap-3">
          <label htmlFor="display-name" className="shrink-0 text-sm font-bold text-gray-900">
            Display Name
          </label>
          <input
            id="display-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-full border border-black/10 bg-white px-4 py-2 text-sm outline-none focus:ring-2"
            placeholder="Your name"
          />
        </div>
      </div>

      {pickerOpen && profile && (
        <AvatarPickerModal
          userId={userId}
          username={profile.username}
          currentAvatarUrl={profile.avatar_url}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </main>
  );
}
