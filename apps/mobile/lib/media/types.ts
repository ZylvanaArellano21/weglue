// ─── Shared media-selection contract ─────────────────────────────────────────
//
// One normalized result shape for every image entry point in the app (profile
// avatar, post, chat attachment, club avatar, club banner, event image), so a
// feature never has to know whether the bytes came from the camera or the
// photo library, or which platform produced them.
//
// Deliberately mirrors the fields the existing upload paths already read off
// an expo-image-picker asset, so callers keep working unchanged:
//   lib/imageUpload.ts        → uri
//   lib/chatAttachments.ts    → uri, name, size, mime, kind
//   edit-profile-pic.tsx      → source ('camera' | 'library' → avatar_type)

export type MediaSource = 'camera' | 'library';

/**
 * What a caller asks for:
 *   'camera'  → straight to the We Glue camera (screen has its own Camera button)
 *   'library' → straight to the OS photo picker (screen has its own Library button)
 *   'choose'  → show the Take Photo / Photo Library sheet first (screen had a
 *               single "change image" tap and no source buttons of its own)
 */
export type MediaRequestSource = MediaSource | 'choose';

export interface PickMediaRequest {
  source: MediaRequestSource;
  /**
   * Feature crop ratio as [width, height] — avatars [1,1], club banner [16,9],
   * event image [4,5]. Omit for free-form (posts, chat).
   *
   * Library: handed to the OS crop step, exactly as before.
   * Camera:  drawn as a visible crop frame on the preview and applied only
   *          after the user confirms, so nothing is ever silently cropped.
   */
  aspect?: [number, number];
  /** Library only: run the platform crop/edit step. Matches each screen's pre-existing behavior. */
  allowsEditing?: boolean;
  /** JPEG quality handed to the OS picker (0..1). */
  quality?: number;
  /** Library only. Chat is the sole surface that accepts video. */
  allowVideo?: boolean;
}

export interface PickedMedia {
  /** Local file:// (camera) or content:///file:// (library) URI. NEVER persisted to the DB. */
  uri: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  /** null when the OS did not report one. */
  fileSize: number | null;
  source: MediaSource;
  kind: 'image' | 'video';
}
