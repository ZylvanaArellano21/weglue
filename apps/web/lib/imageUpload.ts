"use client";

import { getSupabaseBrowser } from "./supabase-browser";

// Web equivalent of apps/mobile/lib/imageUpload.ts. Downscales via canvas
// (browsers have no expo-image-manipulator), uploads to the SAME Supabase
// Storage bucket + path convention mobile uses, and cache-busts the fixed-path
// URL so the new avatar shows immediately everywhere (React Query keys by URL).

async function resizeToJpeg(file: File, maxDimension: number): Promise<Blob> {
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

/** Uploads to bucket `avatars` at `${userId}/avatar.jpg` (same as mobile). */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
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
