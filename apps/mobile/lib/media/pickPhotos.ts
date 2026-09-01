import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { PickedMedia } from './types';

/** Hard cap on photos per carousel / grouped media message. */
export const MAX_PHOTOS = 5;

/**
 * Multi-select up to `limit` photos from the OS photo library.
 *
 * The OS picker itself provides the familiar numbered selection-order
 * experience on both platforms (`orderedSelection`); this only normalizes the
 * result into `PickedMedia[]` in that order. Images only — video stays on the
 * single-item path.
 *
 * Returns [] on cancel. On iOS a photo-library permission is requested first
 * (Android's system photo picker returns a scoped grant and needs none).
 */
export async function pickPhotos(limit = MAX_PHOTOS): Promise<PickedMedia[]> {
  if (Platform.OS === 'ios') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return [];
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    orderedSelection: true,
    quality: 0.9,
  });

  if (result.canceled) return [];

  return result.assets.slice(0, limit).map((a) => ({
    uri: a.uri,
    fileName: a.fileName ?? 'photo.jpg',
    mimeType: a.mimeType ?? 'image/jpeg',
    width: a.width,
    height: a.height,
    fileSize: a.fileSize ?? null,
    source: 'library' as const,
    kind: 'image' as const,
  }));
}
