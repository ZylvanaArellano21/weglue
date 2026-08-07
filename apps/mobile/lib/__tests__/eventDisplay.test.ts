import { describe, expect, it, vi } from 'vitest';
import {
  isEventPast,
  isEventPastAt,
  openEventOrExplain,
  restrictedEventMessage,
  splitPastAndUpcoming,
} from '../eventDisplay';

describe('mobile event expiration', () => {
  it('treats the exact America/Chicago end boundary as past', () => {
    const justBefore = new Date('2026-08-03T18:59:59.000Z'); // 1:59:59 PM CDT
    const atEnd = new Date('2026-08-03T19:00:00.000Z');

    expect(isEventPast('2026-08-03', '14:00:00', justBefore)).toBe(false);
    expect(isEventPast('2026-08-03', '14:00:00', atEnd)).toBe(true);
    expect(isEventPastAt('2026-08-03T19:00:00.000Z', atEnd)).toBe(true);
  });

  it('uses server-derived timestamps across CDT and CST rather than device time', () => {
    expect(isEventPastAt('2026-07-01T19:00:00.000Z', new Date('2026-07-01T18:59:59.999Z'))).toBe(false);
    expect(isEventPastAt('2026-07-01T19:00:00.000Z', new Date('2026-07-01T19:00:00.000Z'))).toBe(true);
    expect(isEventPastAt('2026-11-03T20:00:00.000Z', new Date('2026-11-03T20:00:00.000Z'))).toBe(true);
  });

  it('puts an event in Past Events at event_end_at even when its local date is today', () => {
    const result = splitPastAndUpcoming([
      { id: 'ended', event_date: '2026-08-03', start_time: '10:00', end_time: '14:00', event_end_at: '2026-08-03T19:00:00.000Z' },
      { id: 'later', event_date: '2026-08-03', start_time: '14:00', end_time: '15:00', event_end_at: '2026-08-03T20:00:00.000Z' },
    ], new Date('2026-08-03T19:00:00.000Z'));

    expect(result.past.map((event) => event.id)).toEqual(['ended']);
    expect(result.upcoming.map((event) => event.id)).toEqual(['later']);
  });
});

describe('restricted members-only event guidance', () => {
  it('names the actual club', () => {
    expect(restrictedEventMessage('Forest Club')).toBe(
      'Join Forest Club to be able to attend this event.',
    );
    expect(restrictedEventMessage('Film Club')).toBe(
      'Join Film Club to be able to attend this event.',
    );
  });

  it('trims surrounding whitespace instead of producing a double space', () => {
    expect(restrictedEventMessage('  Forest Club  ')).toBe(
      'Join Forest Club to be able to attend this event.',
    );
  });

  it('falls back when the club name is missing', () => {
    expect(restrictedEventMessage()).toBe('Join this club to be able to attend this event.');
    expect(restrictedEventMessage(null)).toBe('Join this club to be able to attend this event.');
    expect(restrictedEventMessage(undefined)).toBe(
      'Join this club to be able to attend this event.',
    );
  });

  it('falls back when the club name is blank', () => {
    expect(restrictedEventMessage('')).toBe('Join this club to be able to attend this event.');
    expect(restrictedEventMessage('   ')).toBe('Join this club to be able to attend this event.');
  });
});

describe('club-profile event tap', () => {
  it('explains once and performs no other action when the card is restricted', () => {
    const onRestricted = vi.fn();
    const onOpen = vi.fn();

    openEventOrExplain({ canOpen: false, clubName: 'Forest Club', onRestricted, onOpen });

    // Exactly one toast, with the dynamic copy...
    expect(onRestricted).toHaveBeenCalledTimes(1);
    expect(onRestricted).toHaveBeenCalledWith('Join Forest Club to be able to attend this event.');
    // ...and nothing else runs: no navigation, so no RSVP/attendance mutation
    // can be reached from the restricted branch.
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the event and shows no message when the viewer is allowed', () => {
    const onRestricted = vi.fn();
    const onOpen = vi.fn();

    openEventOrExplain({ canOpen: true, clubName: 'Forest Club', onRestricted, onOpen });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onRestricted).not.toHaveBeenCalled();
  });
});
