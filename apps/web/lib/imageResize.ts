// Keep public Storage render URLs aligned with the native client. Query
// parameters such as the upload-time avatar version are preserved.
export function getResizedImageUrl(
  url: string | null | undefined,
  width: number,
  height: number = width,
  resize: 'cover' | 'contain' = 'cover',
): string | null {
  if (!url) return null;
  if (!url.includes('/storage/v1/object/public/')) return url;
  const [base = url, query] = url.split('?');
  const params = new URLSearchParams(query);
  params.set('width', String(Math.round(width)));
  params.set('height', String(Math.round(height)));
  params.set('resize', resize);
  params.set('quality', '75');
  return `${base.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')}?${params.toString()}`;
}

export function avatarImagePixels(size: number): number {
  const pixels = size * 2;
  if (pixels <= 64) return 64;
  if (pixels <= 128) return 128;
  if (pixels <= 256) return 256;
  return 512;
}
