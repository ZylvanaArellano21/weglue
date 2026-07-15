import * as ImageManipulator from 'expo-image-manipulator';
import type { PickedMedia } from './types';

/**
 * Centered crop rectangle for `aspect` inside a `width`×`height` image.
 * Returns null when the image already matches the ratio closely enough that a
 * crop would only cost an encode.
 */
function centeredCrop(
  width: number,
  height: number,
  aspect: [number, number],
): { originX: number; originY: number; width: number; height: number } | null {
  if (width <= 0 || height <= 0) return null;

  const target = aspect[0] / aspect[1];
  const current = width / height;
  if (Math.abs(current - target) < 0.01) return null;

  let cropW: number;
  let cropH: number;
  if (current > target) {
    // Too wide — keep full height, trim the sides.
    cropH = height;
    cropW = Math.round(height * target);
  } else {
    // Too tall — keep full width, trim top/bottom.
    cropW = width;
    cropH = Math.round(width / target);
  }

  // Clamp: a rect even one pixel outside the bitmap makes the native crop throw.
  cropW = Math.min(cropW, width);
  cropH = Math.min(cropH, height);

  return {
    originX: Math.max(0, Math.round((width - cropW) / 2)),
    originY: Math.max(0, Math.round((height - cropH) / 2)),
    width: cropW,
    height: cropH,
  };
}

/**
 * Applies the feature's crop ratio to a camera capture, once the user has
 * confirmed it on the preview (Part 5/6: never crop before Use Photo).
 *
 * The camera already writes an upright JPEG — `skipProcessing` is left off, so
 * expo-camera bakes the sensor rotation into the pixels and the width/height it
 * reports describe the saved file. That means this is the ONLY re-encode
 * between shutter and upload, matching the encode count of the old
 * picker-crop → uploadImageToBucket path.
 *
 * With no `aspect`, the capture is passed through untouched (zero encodes).
 * A crop failure degrades to the uncropped photo rather than losing the shot.
 */
export async function applyFeatureCrop(picked: PickedMedia, aspect?: [number, number]): Promise<PickedMedia> {
  if (!aspect || picked.kind !== 'image') return picked;

  const rect = centeredCrop(picked.width, picked.height, aspect);
  if (!rect) return picked;

  try {
    const result = await ImageManipulator.manipulateAsync(
      picked.uri,
      [{ crop: rect }],
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
    );
    return {
      ...picked,
      uri: result.uri,
      width: result.width,
      height: result.height,
      mimeType: 'image/jpeg',
      // The cropped file is a new one on disk; the old size no longer describes it.
      fileSize: null,
    };
  } catch {
    return picked;
  }
}
