import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabase';

const DEFAULT_MAX_DIMENSION = 1280;
const DEFAULT_COMPRESS_QUALITY = 0.8;

export async function compressImageForUpload(
  uri: string,
  maxDimension: number = DEFAULT_MAX_DIMENSION,
): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxDimension } }],
    { compress: DEFAULT_COMPRESS_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
  );
  return result.uri;
}

// Compresses, converts to ArrayBuffer (fetch().blob() alone is unreliable on
// Android RN), uploads, and returns the public URL.
export async function uploadImageToBucket(
  bucket: string,
  path: string,
  localUri: string,
  maxDimension?: number,
): Promise<string> {
  const compressedUri = await compressImageForUpload(localUri, maxDimension);
  const response = await fetch(compressedUri);
  const blob = await response.blob();
  const arrayBuffer = await new Response(blob).arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  // Cache-bust: fixed-path uploads (e.g. avatars) reuse the same URL on every
  // re-upload, and RN's Image cache keys purely by URL, so without this the
  // old image keeps rendering everywhere it's displayed until cache eviction.
  return `${data.publicUrl}?v=${Date.now()}`;
}
