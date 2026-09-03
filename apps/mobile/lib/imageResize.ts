// Rewrites a Supabase Storage public URL to request a server-resized render
// at the given display dimensions, instead of decoding the full uploaded
// source (often several times larger than any on-screen use needs).
// Non-Supabase URLs (external, preset:/text: avatar values, null) pass
// through unchanged.
//
// `resize` matches the Supabase render transform:
//   'cover'   (default) — fill the box, cropping the overflow. Right for
//                         thumbnails, avatars and fixed-ratio carousels.
//   'contain'           — fit the whole image inside the box, no crop. Used for
//                         a single natural-aspect post image, where the box has
//                         already been sized to the image's own ratio.
export function getResizedImageUrl(
  url: string | null | undefined,
  width: number,
  height: number = width,
  resize: 'cover' | 'contain' = 'cover',
): string | null {
  if (!url) return null;
  if (!url.includes('/storage/v1/object/public/')) return url;

  const [base, query] = url.split('?');
  const renderBase = base.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');

  const params = new URLSearchParams(query);
  params.set('width', String(Math.round(width)));
  params.set('height', String(Math.round(height)));
  params.set('resize', resize);
  params.set('quality', '75');

  return `${renderBase}?${params.toString()}`;
}
