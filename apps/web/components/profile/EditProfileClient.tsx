"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "../home/AppHeader";
import { Avatar } from "../shared/Avatar";
import { PlusIcon, ChevronLeftIcon, ChevronRightIcon } from "../shared/icons";
import { AvatarPickerModal } from "./AvatarPickerModal";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { ToastProvider, useToast } from "../shared/Toast";
import { useOwnProfile, useUpdateDisplayName } from "../../lib/hooks/useOwnProfile";

// Matches the web Edit profile reference: centred avatar with a ⊕ that opens the
// picture editor, an editable Display Name, and Save.
//
// The editable field set is exactly mobile's (apps/mobile/app/profile/
// edit-profile.tsx): display name + profile picture, and nothing else. Interests
// and activities are edited through their own survey flow on both platforms
// (/interests on web), and username / email / password belong to Account Center —
// so this screen does not grow fields mobile does not have.
//
// Validation is mobile's: non-empty after trimming, at most 60 characters.
// Saving updates the shared `profiles` row, and the mutation invalidates every
// query, so the header avatar, the dropdown, the profile page, posts, comments
// and chats all pick up the new name without a page refresh.

const NAME_MAX = 60;

export function EditProfileClient({ userId }: { userId: string }): JSX.Element {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-cream pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <AppHeader userId={userId} />
        <EditProfileBody userId={userId} />
      </div>
    </ToastProvider>
  );
}

function EditProfileBody({ userId }: { userId: string }): JSX.Element {
  const router = useRouter();
  const show = useToast();
  const { data: profile, isLoading } = useOwnProfile(userId);
  const updateName = useUpdateDisplayName(userId);

  const [name, setName] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [initialised, setInitialised] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the field once from the loaded profile (don't clobber edits on refetch).
  useEffect(() => {
    if (!initialised && profile) {
      setName(profile.full_name ?? "");
      setInitialised(true);
    }
  }, [profile, initialised]);

  const trimmed = name.trim();
  const dirty = initialised && trimmed !== (profile?.full_name ?? "").trim();
  const tooLong = trimmed.length > NAME_MAX;
  const valid = trimmed.length > 0 && !tooLong;
  const canSave = dirty && valid && !updateName.isPending;

  // Closing the tab / reloading with unsaved edits gets the browser's own
  // warning; in-app navigation gets the dialog below. Both keep the same
  // promise: an unsaved change is never silently discarded.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const leave = useCallback(() => router.push("/profile"), [router]);

  const onBack = () => {
    if (dirty) {
      setLeaveConfirm(true);
      return;
    }
    leave();
  };

  const onSave = async () => {
    setError(null);
    if (!trimmed) {
      setError("Display name cannot be empty.");
      return;
    }
    if (tooLong) {
      setError(`Display name must be ${NAME_MAX} characters or fewer.`);
      return;
    }
    if (!canSave) return;
    try {
      await updateName.mutateAsync(trimmed);
      show("Profile updated!");
      setLeaveConfirm(false);
      router.push("/profile");
    } catch {
      setError("Could not save. Please try again.");
      show("Could not save. Please try again.", "error");
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      {/* Desktop/tablet top bar — unchanged. */}
      <div className="relative hidden items-center justify-center md:flex">
        <button
          type="button"
          onClick={onBack}
          className="absolute left-0 rounded-full px-2 py-1 text-sm font-semibold text-teal hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold text-gray-900">Edit profile</h1>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={!canSave}
          aria-busy={updateName.isPending}
          className="absolute right-0 flex items-center gap-2 rounded-full bg-teal px-6 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          {updateName.isPending ? (
            <>
              <span
                aria-hidden
                className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
              />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </button>
      </div>

      {/* Phone top bar — checked directly against native: a plain back
          chevron next to a left-aligned title, no Save here at all. Save
          moves to a full-width button at the end of the content instead
          (native's exact structure), rather than squeezing three controls
          into one row on a narrow screen. */}
      <div className="flex items-center gap-3 md:hidden">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          <ChevronLeftIcon size={24} />
        </button>
        <h1 className="text-xl font-bold text-gray-900">Edit Profile</h1>
      </div>

      {isLoading ? (
        <div className="mt-10 flex flex-col items-center" aria-live="polite" aria-busy>
          <span className="sr-only">Loading your profile…</span>
          <div className="h-[172px] w-[172px] animate-pulse rounded-full bg-black/[0.06]" />
          <div className="mt-8 h-10 w-72 animate-pulse rounded-full bg-black/[0.06]" />
        </div>
      ) : (
        <>
        {/* Desktop/tablet content — unchanged: big centered avatar with a ⊕
            badge, inline label + input. */}
        <div className="mt-10 hidden flex-col items-center md:flex">
          <div className="relative">
            <Avatar
              uri={profile?.avatar_url}
              size={172}
              name={profile?.full_name ?? profile?.username}
            />
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              aria-label="Change your profile picture"
              className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-cream bg-cream text-teal shadow-sm transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2"
            >
              <PlusIcon size={19} strokeWidth={2.4} />
            </button>
          </div>

          <div className="mt-10 flex w-full max-w-md flex-col items-center gap-3 sm:flex-row">
            <label htmlFor="display-name" className="shrink-0 text-[15px] font-bold text-gray-900">
              Display Name
            </label>
            <input
              id="display-name"
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => {
                setName(e.target.value.slice(0, NAME_MAX));
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSave) void onSave();
              }}
              aria-invalid={!!error}
              aria-describedby="display-name-help"
              className="w-full flex-1 rounded-full border border-black/15 bg-white px-4 py-2.5 text-[15px] font-semibold text-gray-900 outline-none focus:border-teal focus-visible:ring-2 focus-visible:ring-teal/40"
              placeholder="Your name"
            />
          </div>

          <p
            id="display-name-help-desktop"
            role={error ? "alert" : undefined}
            aria-live="polite"
            className="mt-2 min-h-[18px] text-[13px]"
            style={{ color: error ? "#F02719" : "#6B7280" }}
          >
            {error ?? `${name.length}/${NAME_MAX}`}
          </p>
        </div>

        {/* Phone content — checked directly against native: "Display Name"
            label stacked above a full-width box input (not centered/inline),
            then a "Profile Picture" section that's a navigation row opening
            the same picker modal, not the avatar shown directly on this
            screen. */}
        <div className="mt-8 md:hidden">
          <label htmlFor="display-name-phone" className="mb-1.5 block text-[15px] text-gray-500">
            Display Name
          </label>
          <input
            id="display-name-phone"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => {
              setName(e.target.value.slice(0, NAME_MAX));
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) void onSave();
            }}
            aria-invalid={!!error}
            aria-describedby="display-name-help-phone"
            className="w-full rounded-xl border border-black/15 bg-white px-4 py-3.5 text-[16px] text-gray-900 outline-none focus:border-teal focus-visible:ring-2 focus-visible:ring-teal/40"
            placeholder="Your name"
          />
          <p
            id="display-name-help-phone"
            role={error ? "alert" : undefined}
            aria-live="polite"
            className="mt-1.5 text-right text-[13px]"
            style={{ color: error ? "#F02719" : "#9CA3AF" }}
          >
            {error ?? `${name.length}/${NAME_MAX}`}
          </p>

          <h2 className="mb-2 mt-8 text-base font-bold text-gray-900">Profile Picture</h2>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex w-full items-center justify-between rounded-xl border border-black/15 bg-white px-4 py-3.5 text-left text-[15px] text-gray-900"
          >
            Change Profile Picture
            <span className="text-gray-400" aria-hidden><ChevronRightIcon size={18} /></span>
          </button>

          <button
            type="button"
            onClick={() => void onSave()}
            disabled={!canSave}
            aria-busy={updateName.isPending}
            className="mt-10 flex w-full items-center justify-center gap-2 rounded-full bg-teal py-3.5 text-[16px] font-semibold text-white transition-opacity disabled:opacity-45"
          >
            {updateName.isPending ? (
              <>
                <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </button>
        </div>
        </>
      )}

      {pickerOpen && profile && (
        <AvatarPickerModal
          userId={userId}
          username={profile.username}
          currentAvatarUrl={profile.avatar_url}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {leaveConfirm && (
        <ConfirmDialog
          title="Discard changes?"
          message="You have unsaved changes to your profile. Leaving now will discard them."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          destructive
          onConfirm={() => {
            setLeaveConfirm(false);
            leave();
          }}
          onCancel={() => setLeaveConfirm(false)}
        />
      )}
    </main>
  );
}
