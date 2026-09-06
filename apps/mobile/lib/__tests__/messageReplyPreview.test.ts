import { describe, expect, it } from 'vitest';
import { messageReplyPreviewLabel } from '@weglue/shared';

describe('messageReplyPreviewLabel — quoted reference label (migration 129)', () => {
  it('uses the text for a plain text message', () => {
    expect(messageReplyPreviewLabel({ content: 'see you there', message_type: 'text' })).toBe('see you there');
  });

  it('labels a bare photo / caption photo / multi-photo', () => {
    expect(messageReplyPreviewLabel({ content: null, message_type: 'image', attachment_count: 1 })).toBe('Photo');
    expect(messageReplyPreviewLabel({ content: 'at the quad', message_type: 'image', attachment_count: 1 })).toBe('Photo · at the quad');
    expect(messageReplyPreviewLabel({ content: null, message_type: 'image', attachment_count: 4 })).toBe('4 Photos');
  });

  it('labels video / document', () => {
    expect(messageReplyPreviewLabel({ content: null, message_type: 'video' })).toBe('Video');
    expect(messageReplyPreviewLabel({ content: null, message_type: 'file' })).toBe('Document');
    expect(messageReplyPreviewLabel({ content: 'syllabus.pdf', message_type: 'file' })).toBe('Document · syllabus.pdf');
  });

  it('labels shared event / post / poll', () => {
    expect(messageReplyPreviewLabel({ content: null, message_type: 'shared_event' })).toBe('📅 Event');
    expect(messageReplyPreviewLabel({ content: 'Movie Night', message_type: 'shared_event' })).toBe('Movie Night');
    expect(messageReplyPreviewLabel({ content: null, message_type: 'shared_post' })).toBe('🖼️ Post');
    expect(messageReplyPreviewLabel({ content: null, message_type: 'poll' })).toBe('📊 Poll');
  });

  it('falls back to "Message" for a null source or an unknown empty type', () => {
    expect(messageReplyPreviewLabel(null)).toBe('Message');
    expect(messageReplyPreviewLabel({ content: null, message_type: 'weird_new_type' })).toBe('Message');
  });
});
