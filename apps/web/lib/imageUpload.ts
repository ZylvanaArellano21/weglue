"use client";

import { getSupabaseBrowser } from "./supabase-browser";

// Web equivalent of apps/mobile/lib/imageUpload.ts. Downscales via canvas
// (browsers have no expo-image-manipulator), uploads to the SAME Supabase
// Storage bucket + path convention mobile uses, and cache-busts the fixed-path
// URL so the new avatar shows immediately everywhere (React Query keys by URL).

/**
 * Intrinsic pixel dimensions of an image blob. A proportional downscale keeps
 * the same aspect ratio, so the source dimensions are all a caller needs to
 * store for "show this image at its natural aspect" (migration 118).
 */
export async function imageDimensions(file: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("Could not read the image"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Centre-crop an image blob to a target width/height ratio. Used for the photos
 * of a multi-image post the user did not individually frame, so every carousel
 * slide is the same shape (the web sibling of mobile's compressImage
 * `targetRatio`). A blob already at the ratio is returned untouched.
 */
export async function cropBlobToRatio(file: Blob, targetRatio: number): Promise<Blob> {
  if (!(targetRatio > 0)) return file;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the image file"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the image"));
    image.src = dataUrl;
  });

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!(w > 0) || !(h > 0) || Math.abs(w / h - targetRatio) <= 0.01) return file;

  let cropW = w;
  let cropH = h;
  let originX = 0;
  let originY = 0;
  if (w / h > targetRatio) {
    cropW = Math.round(h * targetRatio);
    originX = Math.round((w - cropW) / 2);
  } else {
    cropH = Math.round(w / targetRatio);
    originY = Math.round((h - cropH) / 2);
  }

  const canvas = document.createElement("canvas");
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, originX, originY, cropW, cropH, 0, 0, cropW, cropH);
  return await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.9),
  );
}

// Accepts a Blob, not just a File, so a camera capture (canvas.toBlob) goes
// through the exact same downscale + upload path as a picked file.
export async function resizeToJpeg(file: Blob, maxDimension: number): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the image file"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the image"));
    image.src = dataUrl;
  });

  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, 0, 0, w, h);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not process the image"))),
      "image/jpeg",
      0.85
    );
  });
}

/**
 * Uploads to bucket `avatars` at `${userId}/avatar.jpg` (same as mobile).
 *
 * The fixed path + `upsert` is what makes replacement self-cleaning: a new
 * picture overwrites the old object rather than accumulating orphans, so there
 * is no separate deletion step to get wrong. The `?v=` cache-buster is what
 * makes the change visible immediately behind the CDN.
 */
export async function uploadAvatar(userId: string, file: Blob): Promise<string> {
  const supabase = getSupabaseBrowser();
  const blob = await resizeToJpeg(file, 800);
  const path = `${userId}/avatar.jpg`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

/**
 * Uploads a resized JPEG to the `pending-avatars` bucket at `${token}.jpg`,
 * pre-authentication (Camera/Photo chosen during onboarding, before the
 * account exists — there is no session yet). The bucket only accepts inserts
 * shaped like `<32 hex chars>.jpg` (see migration 098); the caller is
 * responsible for generating that token (generatePendingAvatarToken).
 */
export async function uploadPendingAvatar(token: string, file: Blob): Promise<void> {
  const supabase = getSupabaseBrowser();
  const blob = await resizeToJpeg(file, 800);
  const { error } = await supabase.storage
    .from("pending-avatars")
    .upload(`${token}.jpg`, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
}

/**
 * Uploads a resized JPEG to `bucket` at `path` (no upsert — unique paths) and
 * returns its public URL. Used for post + event images (both the `posts`
 * bucket, matching mobile's createPost / uploadEventImage).
 */
export async function uploadToBucket(
  bucket: string,
  path: string,
  file: Blob,
  maxDimension = 1280
): Promise<string> {
  const supabase = getSupabaseBrowser();
  const blob = await resizeToJpeg(file, maxDimension);
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error || !data) throw error ?? new Error("Upload failed");
  return supabase.storage.from(bucket).getPublicUrl(data.path).data.publicUrl;
}
