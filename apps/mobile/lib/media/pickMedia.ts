import { ActionSheetIOS, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { naturalCropAspect } from '@weglue/shared';
import { requestMedia } from '../../store/mediaPickerStore';
import { requestCrop } from '../../store/imageCropStore';
import type { CropAspectOption } from '../../components/media/ImageCropper';
import type { PickMediaRequest, PickedMedia } from './types';

/**
 * The post-compose ratio picker: "Original" (the image's own ratio — landscape
 * stays landscape), "1:1" and "4:5". Built from the source pixel size so
 * "Original" is truly that image's aspect. Shared by the single-photo and
 * carousel-frame flows on both platforms.
 */
export function postCropAspectOptions(width: number, height: number): CropAspectOption[] {
  return [
    { key: 'original', label: 'Original', ratio: naturalCropAspect(width, height) },
    { key: 'square', label: '1:1', ratio: [1, 1] },
    { key: 'portrait', label: '4:5', ratio: [4, 5] },
  ];
}

// ─── Image-selection entry points ───────────────────────────────────────────
//
// pickMedia()           — Android-only shared camera / library + confirm
//                         preview (free-form: posts, chat). iOS callers keep
//                         their own expo-image-picker path for this.
// pickImageForFeature() — CROSS-PLATFORM ratio flow (profile picture, club
//                         banner, event image): pick or shoot (never the OS
//                         editor) then frame it in the in-app ImageCropper.
// cropExistingImage()   — cross-platform re-frame of an image already in hand.
//
// On Android, pickMedia and pickImageForFeature both hand off to the single
// MediaPickerHost (the We Glue camera, the preview / cropper, the permission
// UI). On iOS, pickImageForFeature drives the OS picker itself and then the
// shared ImageCropHost.

/** True when this call site should use the shared We Glue Android flow. */
export const useWeGlueMediaFlow = Platform.OS === 'android';

/**
 * Runs the shared Android camera / photo-library flow.
 * Resolves with the confirmed image, or null if the user cancelled.
 *
 * Never resolves with an unconfirmed image: the caller only sees a result
 * after Use Photo, which is what keeps "shutter tapped" from meaning
 * "uploaded".
 */
export function pickMedia(options: PickMediaRequest): Promise<PickedMedia | null> {
  return requestMedia(options);
}

/**
 * Opens Android's official system photo picker and normalizes the result.
 *
 * Called only by MediaPickerHost (for the initial pick and for Choose Another).
 * No runtime permission is requested: on Android the photo picker returns a
 * grant scoped to the single item the user chose, so asking for broad
 * READ_MEDIA_IMAGES access would be requesting more than we need — which both
 * the task's privacy rules and Play Store policy tell us not to do.
 *
 * `allowsEditing` is deliberately NOT forwarded: the OEM crop activity Android
 * launches for it has no dependable confirm/cancel and is exactly what this
 * flow replaces — ratio framing happens in the in-app ImageCropper instead.
 *
 * Cancellation resolves null, and is not an error.
 */
export async function openAndroidLibrary(options: PickMediaRequest): Promise<PickedMedia | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: options.allowVideo ? ['images', 'videos'] : ['images'],
    allowsEditing: false,
    quality: options.quality ?? 0.85,
    ...(options.allowVideo ? { videoMaxDuration: 120 } : {}),
  });

  return normalizeAsset(result, 'library');
}

function normalizeAsset(
  result: ImagePicker.ImagePickerResult,
  source: 'camera' | 'library',
): PickedMedia | null {
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const isVideo = asset.type === 'video';
  return {
    uri: asset.uri,
    fileName: asset.fileName ?? (isVideo ? 'video.mp4' : 'photo.jpg'),
    mimeType: asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
    width: asset.width,
    height: asset.height,
    fileSize: asset.fileSize ?? null,
    source,
    kind: isVideo ? 'video' : 'image',
  };
}

/**
 * The ONE entry point for a feature image (profile picture, club banner, event
 * image, a carousel frame). Cross-platform:
 *   Android → the shared We Glue camera / picker + in-app cropper (MediaPickerHost)
 *   iOS     → the OS picker (never the OS editor) + the same in-app cropper
 * Resolves the picked image, or null if the user cancelled at any step.
 *
 * `aspect` is optional: when omitted, the image is returned free-form (no
 * crop step at all) — the caller keeps the photo's own horizontal / vertical /
 * square shape, exactly like the post-compose flow, and may still offer an
 * optional later "Adjust" via `cropExistingImage`. When given, framing is
 * mandatory before the result resolves (avatar, club banner — ratios that
 * always need a fixed frame).
 */
export async function pickImageForFeature(req: {
  source: 'camera' | 'library' | 'choose';
  aspect?: [number, number];
  quality?: number;
  /** Called if OS permission for this source is denied (iOS path only —
   *  Android's system picker is scoped and needs no runtime grant; the Android
   *  camera surfaces its own in-flow permission screen). */
  onDenied?: () => void;
}): Promise<PickedMedia | null> {
  if (Platform.OS === 'android') {
    return pickMedia({ source: req.source, aspect: req.aspect, quality: req.quality });
  }

  // iOS 'choose': a native Take Photo / Photo Library / Cancel action sheet.
  let source: 'camera' | 'library';
  if (req.source === 'choose') {
    const chosen = await new Promise<'camera' | 'library' | null>((resolve) => {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Take Photo', 'Photo Library', 'Cancel'], cancelButtonIndex: 2 },
        (i) => resolve(i === 0 ? 'camera' : i === 1 ? 'library' : null),
      );
    });
    if (!chosen) return null;
    source = chosen;
  } else {
    source = req.source;
  }

  let picked: PickedMedia | null = null;
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      req.onDenied?.();
      return null;
    }
    picked = normalizeAsset(
      await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: req.quality ?? 0.9 }),
      'camera',
    );
  } else {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      req.onDenied?.();
      return null;
    }
    picked = normalizeAsset(
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: req.quality ?? 0.9,
      }),
      'library',
    );
  }
  if (!picked || picked.kind !== 'image') return picked;
  if (!req.aspect) return picked; // free-form: no crop step, keep the photo's own shape

  const cropped = await requestCrop({
    uri: picked.uri,
    sourceWidth: picked.width || 1,
    sourceHeight: picked.height || 1,
    aspect: req.aspect,
  });
  if (!cropped) return null;
  return {
    ...picked,
    uri: cropped.uri,
    width: cropped.width,
    height: cropped.height,
    mimeType: 'image/jpeg',
    fileSize: null,
  };
}

/**
 * Cross-platform: re-frame an image the caller ALREADY has (e.g. one photo of a
 * multi-photo post) into `aspect` with the in-app cropper. Resolves null if the
 * user cancelled.
 *
 * `aspectOptions` (post compose only) turns on the Original / 1:1 / 4:5 ratio
 * picker; `aspect` is then the initial selection.
 */
export async function cropExistingImage(input: {
  uri: string;
  width: number;
  height: number;
  aspect: [number, number];
  aspectOptions?: CropAspectOption[];
}): Promise<PickedMedia | null> {
  const cropped = await requestCrop({
    uri: input.uri,
    sourceWidth: input.width || 1,
    sourceHeight: input.height || 1,
    aspect: input.aspect,
    aspectOptions: input.aspectOptions,
  });
  if (!cropped) return null;
  return {
    uri: cropped.uri,
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    width: cropped.width,
    height: cropped.height,
    fileSize: null,
    source: 'library',
    kind: 'image',
  };
}
