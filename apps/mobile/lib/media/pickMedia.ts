import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { requestMedia } from '../../store/mediaPickerStore';
import type { PickMediaRequest, PickedMedia } from './types';

// ─── The one entry point for Android image selection ─────────────────────────
//
// Android only, by design. iOS keeps the working expo-image-picker flow it has
// today: every caller branches on Platform.OS and leaves its existing iOS code
// path byte-for-byte untouched, so nothing about the shipped iOS camera,
// library, crop or permission behavior can regress from this change.
//
// On Android this hands off to the single MediaPickerHost, which owns the
// We Glue camera, the confirm-before-upload preview, and the permission UI.

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
 * Cancellation resolves null, and is not an error.
 */
export async function openAndroidLibrary(options: PickMediaRequest): Promise<PickedMedia | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: options.allowVideo ? ['images', 'videos'] : ['images'],
    // The OS crop step, kept exactly where each screen already had it, so
    // feature ratios (avatar 1:1, banner 16:9, event 4:5) survive unchanged.
    allowsEditing: options.allowsEditing ?? false,
    ...(options.aspect ? { aspect: options.aspect } : {}),
    quality: options.quality ?? 0.85,
    ...(options.allowVideo ? { videoMaxDuration: 120 } : {}),
  });

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
    source: 'library',
    kind: isVideo ? 'video' : 'image',
  };
}
