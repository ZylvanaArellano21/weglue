/**
 * The ONE presentation contract for chat attachments, shared by mobile and web.
 *
 * These rules were previously implemented only in `apps/mobile/lib/chatAttachments.ts`,
 * so the web file card showed a bare "📎 filename" link with no type and no size
 * while mobile showed "PDF · 92 KB". Keeping them here means a change to how an
 * attachment reads happens once, for both platforms.
 */

/** Human file size. Returns "" for a missing/zero size so callers can omit the
 *  segment entirely rather than print a meaningless "0 B". */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Short type label — the extension when there is a usable one, otherwise a
 *  label derived from the MIME type, otherwise the neutral "FILE". */
export function fileTypeLabel(name?: string | null, mime?: string | null): string {
  const ext = name?.includes(".") ? name.split(".").pop()?.toUpperCase() : undefined;
  if (ext && ext.length <= 5) return ext;
  if (mime?.includes("pdf")) return "PDF";
  if (mime?.includes("word")) return "DOCX";
  if (mime?.includes("presentation")) return "PPTX";
  if (mime?.includes("sheet") || mime?.includes("excel")) return "XLSX";
  if (mime?.startsWith("text/")) return "TXT";
  return "FILE";
}

/** The "PDF · 92 KB" subtitle mobile's file card shows. Size is omitted when it
 *  is unknown, so the separator never dangles. */
export function fileSubtitle(
  name?: string | null,
  mime?: string | null,
  bytes?: number | null
): string {
  const size = formatFileSize(bytes);
  return size ? `${fileTypeLabel(name, mime)} · ${size}` : fileTypeLabel(name, mime);
}

/**
 * Aspect ratio to RESERVE for an image before its bytes have loaded, and to
 * constrain it to afterwards.
 *
 * Why this exists: a chat image whose intrinsic size is not yet known has no
 * layout box of its own. Rendered as a bare `<img>` with only a max-height, it
 * collapses to a few pixels — the "tiny dot" in the correction screenshots.
 * Mobile already clamps to [0.5, 2] so neither a panorama nor a very tall
 * screenshot can take over the thread; web must use the same clamp or the two
 * platforms disagree about the same message.
 *
 * `null`/unknown falls back to 4:3, which is a neutral, stable box rather than
 * a zero-height one.
 */
export const CHAT_IMAGE_MIN_ASPECT = 0.5;
export const CHAT_IMAGE_MAX_ASPECT = 2;
export const CHAT_IMAGE_FALLBACK_ASPECT = 4 / 3;

export function clampChatImageAspect(aspect: number | null | undefined): number {
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return CHAT_IMAGE_FALLBACK_ASPECT;
  return Math.max(CHAT_IMAGE_MIN_ASPECT, Math.min(CHAT_IMAGE_MAX_ASPECT, aspect));
}
