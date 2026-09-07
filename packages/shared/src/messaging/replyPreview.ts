/**
 * The one-line label for a quoted message reference (migration 129).
 *
 * Used in two places on both platforms so a reply to a photo, an event, a
 * document, a poll, … always reads the same:
 *   • the composer banner ("Replying to Alex · Photo")
 *   • the quoted block rendered above a reply bubble
 *
 * `content` wins when present (a photo/file caption is meaningful context);
 * otherwise the type gets a short human label.
 */

export interface ReplyPreviewSource {
  content: string | null;
  message_type: string | null;
  /** Number of grouped image attachments, when known (0/undefined = not grouped). */
  attachment_count?: number;
}

export function messageReplyPreviewLabel(source: ReplyPreviewSource | null | undefined): string {
  if (!source) return 'Message';
  const text = source.content?.trim();
  const type = source.message_type ?? 'text';

  switch (type) {
    case 'image': {
      const n = source.attachment_count ?? 0;
      const media = n > 1 ? `${n} Photos` : 'Photo';
      return text ? `${media} · ${text}` : media;
    }
    case 'video':
      return text ? `Video · ${text}` : 'Video';
    case 'file':
      return text ? `Document · ${text}` : 'Document';
    case 'shared_event':
      return text || '📅 Event';
    case 'shared_post':
      return text || '🖼️ Post';
    case 'poll':
      return text || '📊 Poll';
    default:
      return text || 'Message';
  }
}
