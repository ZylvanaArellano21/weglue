import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { compressImageForUpload } from './imageUpload';

// ─── Private chat attachment storage ─────────────────────────────────────────
// Bucket `chat-attachments` is PRIVATE. Objects live at
//   <conversation_id>/<random>.<ext>
// and RLS grants read/write only to current conversation participants
// (migration 040). messages.attachment_url stores the STORAGE PATH, never a
// public URL — rendering always goes through short-lived signed URLs.

export const CHAT_ATTACHMENTS_BUCKET = 'chat-attachments';
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB document cap

// ─── Supported document types ────────────────────────────────────────────────
//
// MUST stay in sync with the `chat-attachments` bucket's allowed_mime_types.
// Storage enforces that whitelist server-side and rejects anything else, so a
// file we let through here (the picker browses '*/*') fails the upload with an
// opaque error — and Retry then fails forever, because retrying cannot change
// the file's type. Checking at pick time turns that dead end into a clear
// "this type isn't supported" message before anything is queued.
const SUPPORTED_DOC_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

// Some providers (notably Android's Downloads/Drive) hand back
// application/octet-stream for a perfectly good PDF or DOCX, so fall back to
// the extension rather than rejecting a file the bucket would have accepted.
const SUPPORTED_DOC_EXTS = new Set(['pdf', 'doc', 'docx', 'txt']);

/** True when the bucket will accept this document. */
export function isSupportedDocument(
  mime: string | null | undefined,
  name: string | null | undefined,
): boolean {
  if (mime && SUPPORTED_DOC_MIMES.has(mime.toLowerCase())) return true;
  const ext = name?.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined;
  return !!ext && SUPPORTED_DOC_EXTS.has(ext);
}

export const UNSUPPORTED_DOC_MESSAGE =
  'That file type isn’t supported. You can send PDF, Word (.doc/.docx) and text (.txt) files.';

/** Non-cryptographic v4-format UUID (client send tags + storage names). */
export function clientUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function extFromNameOrMime(name?: string | null, mime?: string | null): string {
  const fromName = name?.includes('.') ? name.split('.').pop() : undefined;
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'application/pdf': 'pdf',
  };
  return map[mime ?? ''] ?? 'bin';
}

export interface UploadResult {
  /** Storage path inside the bucket (what messages.attachment_url stores). */
  path: string;
  mime: string;
  size: number;
}

/**
 * Uploads a local file to the private chat bucket with upload progress.
 * Uses a signed upload URL + XMLHttpRequest so React Native reports
 * `upload.onprogress` (supabase-js uploads cannot).
 */
export async function uploadChatAttachment(opts: {
  conversationId: string;
  localUri: string;
  mime: string;
  fileName?: string | null;
  kind: 'image' | 'video' | 'file';
  onProgress?: (fraction: number) => void;
}): Promise<UploadResult> {
  const { conversationId, kind, onProgress } = opts;
  let { localUri, mime } = opts;

  // Preflight: the picked file lives in the OS cache, which the system can
  // evict — so by the time a user taps Retry on a failed send, the source may
  // be gone. Uploading it then produces a 0-byte object and an attachment
  // nobody can open. Fail here instead, with an error that tells the user the
  // one thing that actually helps: pick the file again.
  if (localUri.startsWith('file://')) {
    let info: { exists: boolean; size?: number };
    try {
      info = (await FileSystem.getInfoAsync(localUri)) as { exists: boolean; size?: number };
    } catch {
      throw new Error('This file is no longer available. Choose it again to send it.');
    }
    if (!info.exists) {
      throw new Error('This file is no longer available. Choose it again to send it.');
    }
    if (info.size === 0) {
      throw new Error("This file is empty or couldn't be read. Choose it again to send it.");
    }
    if (info.size != null && info.size > MAX_FILE_BYTES) {
      throw new Error('This file is larger than 25 MB. Choose a smaller file and try again.');
    }
  }

  // Images: recompress large captures; keeps aspect ratio, JPEG output.
  if (kind === 'image') {
    try {
      localUri = await compressImageForUpload(localUri, 1600);
      mime = 'image/jpeg';
    } catch {
      // Fall back to the original file rather than failing the send.
    }
  }

  const ext = extFromNameOrMime(kind === 'image' ? 'photo.jpg' : opts.fileName, mime);
  const path = `${conversationId}/${clientUuid()}.${ext}`;

  const { data: signed, error: signErr } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(path);
  if (signErr || !signed) throw signErr ?? new Error('Could not start upload');

  const size = await new Promise<number>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signed.signedUrl);
    xhr.setRequestHeader('Content-Type', mime);
    xhr.setRequestHeader('x-upsert', 'false');
    let sent = 0;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        sent = e.total;
        onProgress?.(Math.min(0.99, e.loaded / e.total));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve(sent);
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection'));
    // RN XHR accepts { uri, type, name } file descriptors as the body.
    xhr.send({ uri: localUri, type: mime, name: opts.fileName ?? `upload.${ext}` } as any);
  });

  return { path, mime, size };
}

// ─── Signed URL resolution + cache ───────────────────────────────────────────

// Deletion removes the object immediately when the interactive endpoint is
// available; a short TTL also bounds any already-issued URL on older clients.
const SIGNED_TTL_SECONDS = 60;
const signedCache = new Map<string, { url: string; expiresAt: number }>();

/** True when the stored attachment value is a private-bucket storage path. */
export function isStoragePath(value: string | null | undefined): boolean {
  return !!value && !value.startsWith('http') && !value.startsWith('file:') && !value.startsWith('content:');
}

/**
 * Resolves a messages.attachment_url value to something an <Image>/player can
 * load: passes through http(s)/local URIs (legacy rows, optimistic sends) and
 * signs private storage paths with an in-memory cache.
 */
export async function resolveAttachmentUrl(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (!isStoragePath(value)) return value;

  const cached = signedCache.get(value);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url;

  const { data, error } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .createSignedUrl(value, SIGNED_TTL_SECONDS);
  if (error || !data) return null;

  signedCache.set(value, {
    url: data.signedUrl,
    expiresAt: Date.now() + SIGNED_TTL_SECONDS * 1000,
  });
  return data.signedUrl;
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileTypeLabel(name?: string | null, mime?: string | null): string {
  const ext = name?.includes('.') ? name.split('.').pop()?.toUpperCase() : undefined;
  if (ext && ext.length <= 5) return ext;
  if (mime?.includes('pdf')) return 'PDF';
  if (mime?.includes('word')) return 'DOCX';
  if (mime?.includes('presentation')) return 'PPTX';
  if (mime?.includes('sheet') || mime?.includes('excel')) return 'XLSX';
  if (mime?.startsWith('text/')) return 'TXT';
  return 'FILE';
}
