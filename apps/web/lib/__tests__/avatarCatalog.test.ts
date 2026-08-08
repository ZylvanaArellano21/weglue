import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEGACY_PRESET_COLORS,
  PRESET_AVATARS,
  getPresetAvatar,
  parseLegacyPresetColor,
  parsePresetAvatarId,
  presetAvatarValue,
} from "@weglue/shared/avatarCatalog";

const root = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const canonicalAssets = path.join(root, "packages/shared/assets/preset-avatars");
// SHA-256 over every relative asset filename and byte stream, in deterministic
// PNG then WebP order. This protects the approved artwork from accidental
// replacement, re-encoding, or filename swaps after import.
const APPROVED_ASSET_SET_SHA256 = "abe968ee5cf410a637c7dd8bdbaf7cd4020309c9ad12b64e8cb9a4b9dbf87b61";

function canonicalAssetSetDigest(): string {
  const hash = createHash("sha256");
  for (const extension of ["png", "webp"]) {
    for (const filename of readdirSync(path.join(canonicalAssets, extension)).sort()) {
      hash.update(`${extension}/${filename}`);
      hash.update("\0");
      hash.update(readFileSync(path.join(canonicalAssets, extension, filename)));
    }
  }
  return hash.digest("hex");
}

describe("preset avatar catalog", () => {
  it("has every stable avatar ID exactly once and in canonical order", () => {
    expect(PRESET_AVATARS).toHaveLength(30);
    expect(new Set(PRESET_AVATARS.map((avatar) => avatar.id)).size).toBe(30);
    expect(PRESET_AVATARS.map((avatar) => avatar.id)).toEqual(
      Array.from({ length: 30 }, (_, index) => `avatar_${String(index + 1).padStart(2, "0")}`)
    );
  });

  it("has a supplied PNG and lossless WebP for every catalog entry", () => {
    expect(readdirSync(path.join(canonicalAssets, "png")).filter((file) => file.endsWith(".png"))).toHaveLength(30);
    expect(readdirSync(path.join(canonicalAssets, "webp")).filter((file) => file.endsWith(".webp"))).toHaveLength(30);
    for (const avatar of PRESET_AVATARS) {
      expect(existsSync(path.join(canonicalAssets, "png", avatar.png))).toBe(true);
      expect(existsSync(path.join(canonicalAssets, "webp", avatar.webp))).toBe(true);
    }
  });

  it("keeps the approved avatar bytes and deterministic filenames intact", () => {
    expect(canonicalAssetSetDigest()).toBe(APPROVED_ASSET_SET_SHA256);
  });

  it("stores stable IDs and preserves the old color-only preset presentation", () => {
    expect(presetAvatarValue("avatar_21")).toBe("preset:avatar_21");
    expect(parsePresetAvatarId("preset:avatar_21")).toBe("avatar_21");
    expect(getPresetAvatar("avatar_21")?.label).toContain("green dragon");
    expect(parsePresetAvatarId("preset:#0FA6A6")).toBeNull();
    for (const color of LEGACY_PRESET_COLORS) {
      expect(parseLegacyPresetColor(`preset:${color}`)).toBe(color);
    }
  });
});

describe("cross-platform preset avatar integration", () => {
  const webAvatar = readFileSync(path.join(root, "apps/web/components/shared/Avatar.tsx"), "utf8");
  const mobileAvatar = readFileSync(path.join(root, "apps/mobile/components/shared/Avatar.tsx"), "utf8");
  const webPicker = readFileSync(path.join(root, "apps/web/components/profile/AvatarPickerModal.tsx"), "utf8");
  const mobilePicker = readFileSync(path.join(root, "apps/mobile/app/profile/edit-profile-pic.tsx"), "utf8");
  const webProfile = readFileSync(path.join(root, "apps/web/components/profile/ProfileLayout.tsx"), "utf8");
  const webEditProfile = readFileSync(path.join(root, "apps/web/components/profile/EditProfileClient.tsx"), "utf8");
  const mobileProfile = readFileSync(path.join(root, "apps/mobile/app/profile/own.tsx"), "utf8");
  const mobileEditProfile = readFileSync(path.join(root, "apps/mobile/app/profile/edit-profile.tsx"), "utf8");
  const onboardingLayout = readFileSync(path.join(root, "apps/mobile/app/onboarding/_layout.tsx"), "utf8");
  const entryRoute = readFileSync(path.join(root, "apps/mobile/app/index.tsx"), "utf8");

  it("routes every existing display surface through one renderer per platform", () => {
    expect(webAvatar).toContain("parsePresetAvatarId");
    expect(webAvatar).toContain("getPresetAvatarSrc");
    expect(mobileAvatar).toContain("parsePresetAvatarId");
    expect(mobileAvatar).toContain("getPresetAvatarAsset");
  });

  it("keeps the web modal fixed while only a five-column picker grid scrolls", () => {
    expect(webPicker).toContain("grid grid-cols-5");
    expect(webPicker).toContain("overflow-y-auto");
    expect(webPicker).toContain("presetAvatarValue(avatar.id)");
    expect(webPicker).toContain("aria-pressed={selected}");
    expect(webPicker).toContain("inFlight.current");
  });

  it("uses a four-column mobile FlatList with selected accessible options", () => {
    expect(mobilePicker).toContain("<FlatList");
    expect(mobilePicker).toContain("numColumns={4}");
    expect(mobilePicker).toContain("presetGridHeight");
    expect(mobilePicker).toContain("accessibilityState={{ selected }}");
    expect(mobilePicker).toContain("saveInFlight.current");
  });

  it("uses the canonical renderer across posts, comments, conversations, people lists, search, notifications, events, and admin", () => {
    const displaySurfaces = [
      "apps/web/components/home/PostsFeed.tsx",
      "apps/web/components/home/PostModal.tsx",
      "apps/web/components/messages/MessagesClient.tsx",
      "apps/web/components/clubs/ManageClubModal.tsx",
      "apps/web/components/clubs/ClubOfficersTab.tsx",
      "apps/web/components/home/GluematesModal.tsx",
      "apps/web/components/admin/GlobalSearch.tsx",
      "apps/web/components/home/NotificationsModal.tsx",
      "apps/web/components/home/EventDetailModal.tsx",
      "apps/web/app/admin/users/[id]/page.tsx",
      "apps/mobile/components/home/PostCard.tsx",
      // Comments is the transparent-modal route; the old CommentsSheet
      // component was an unused duplicate and has been removed.
      "apps/mobile/app/comments/[postId].tsx",
      "apps/mobile/components/chat/ChatListItem.tsx",
      "apps/mobile/app/chat/[chatId]/index.tsx",
      "apps/mobile/app/chat/new-message.tsx",
      "apps/mobile/app/club/[clubId]/members.tsx",
      "apps/mobile/app/club/[clubId]/index.tsx",
      "apps/mobile/app/home/attendees.tsx",
    ];

    for (const surface of displaySurfaces) {
      expect(readFileSync(path.join(root, surface), "utf8")).toContain("shared/Avatar");
    }
  });

  it("routes every authenticated profile-edit entry point to the canonical picker", () => {
    expect(webProfile).toContain('aria-label="Edit your profile picture"');
    expect(webProfile).toContain('aria-label="Change your profile picture"');
    expect(webEditProfile).toContain("<AvatarPickerModal");
    expect(mobileProfile.match(/onPress={onEditProfilePic}/g)).toHaveLength(2);
    expect(mobileProfile).toContain("'/profile/edit-profile-pic'");
    expect(mobileEditProfile).toContain("'/profile/edit-profile-pic'");
  });

  it("leaves onboarding and first-login routing without an avatar picker", () => {
    expect(onboardingLayout).not.toContain('name="profile"');
    expect(onboardingLayout).not.toContain("edit-profile-pic");
    expect(entryRoute).toContain('router.replace("/(tabs)")');
    expect(entryRoute).not.toContain("edit-profile-pic");
  });
});
