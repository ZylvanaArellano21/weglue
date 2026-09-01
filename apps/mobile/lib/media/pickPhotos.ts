import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { PickedMedia } from './types';

/** Hard cap on photos per carousel / grouped media message. */
export const MAX_PHOTOS = 5;

/**
 * Multi-select up to `limit` items from the OS photo library.
 *
 * The OS picker provides the familiar numbered selection-order experience on
 * both platforms (`orderedSelection`); this only normalizes the result into
 * `PickedMedia[]` in that order.
 *
 * Video is still allowed (`allowVideo`, default true) so chat keeps its
 * single-video send — but a carousel is images-only, so the caller sends one
 * lone video on the single-attachment path and treats any multi-select or
 * mixed selection as images (see ChatInput / new-post).
 *
 * Returns [] on cancel. On iOS a photo-library permission is requested first
 * (Android's system photo picker returns a scoped grant and needs none).
 */
export async function pickPhotos(limit = MAX_PHOTOS, allowVideo = true): Promise<PickedMedia[]> {
  if (Platform.OS === 'ios') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return [];
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: allowVideo ? ['images', 'videos'] : ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    orderedSelection: true,
    quality: 0.9,
    ...(allowVideo ? { videoMaxDuration: 120 } : {}),
  });

  if (result.canceled) return [];

  return result.assets.slice(0, limit).map((a) => {
    const isVideo = a.type === 'video';
    return {
      uri: a.uri,
      fileName: a.fileName ?? (isVideo ? 'video.mp4' : 'photo.jpg'),
      mimeType: a.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
      width: a.width,
      height: a.height,
      fileSize: a.fileSize ?? null,
      source: 'library' as const,
      kind: isVideo ? ('video' as const) : ('image' as const),
    };
  });
}
