// Rewrites a Supabase Storage public URL to request a server-resized render
// at the given display dimensions, instead of decoding the full uploaded
// source (often several times larger than any on-screen use needs).
// Non-Supabase URLs (external, preset:/text: avatar values, null) pass
// through unchanged.
export function getResizedImageUrl(
  url: string | null | undefined,
  width: number,
  height: number = width,
): string | null {
  if (!url) return null;
  if (!url.includes('/storage/v1/object/public/')) return url;

  const [base, query] = url.split('?');
  const renderBase = base.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');

  const params = new URLSearchParams(query);
  params.set('width', String(Math.round(width)));
  params.set('height', String(Math.round(height)));
  params.set('resize', 'cover');
  params.set('quality', '75');

  return `${renderBase}?${params.toString()}`;
}
