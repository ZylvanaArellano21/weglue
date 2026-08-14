/**
 * Correction 3: the "directly relevant active Home surface" suppression
 * bucket. Screens register/unregister on focus; the banner asks
 * isViewingDestination before presenting.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearActiveDestination,
  isViewingDestination,
  setActiveDestination,
} from '../activeDestination';

beforeEach(() => {
  // Reset module-level state between tests without a real screen mount.
  clearActiveDestination('post', 'p1');
  clearActiveDestination('event', 'e1');
  clearActiveDestination('home');
});

describe('activeDestination', () => {
  it('reports nothing active by default', () => {
    expect(isViewingDestination('post', 'p1')).toBe(false);
    expect(isViewingDestination('event', 'e1')).toBe(false);
    expect(isViewingDestination('home')).toBe(false);
  });

  it('matches only the exact post id that registered', () => {
    setActiveDestination('post', 'p1');
    expect(isViewingDestination('post', 'p1')).toBe(true);
    expect(isViewingDestination('post', 'p2')).toBe(false);
    expect(isViewingDestination('event', 'p1')).toBe(false);
  });

  it('matches only the exact event id that registered', () => {
    setActiveDestination('event', 'e1');
    expect(isViewingDestination('event', 'e1')).toBe(true);
    expect(isViewingDestination('event', 'e2')).toBe(false);
  });

  it('home has no id — any home check matches while active', () => {
    setActiveDestination('home');
    expect(isViewingDestination('home')).toBe(true);
    expect(isViewingDestination('post', 'p1')).toBe(false);
  });

  it('clear is a no-op if a different id already replaced it (stale unmount)', () => {
    setActiveDestination('post', 'p1');
    setActiveDestination('post', 'p2'); // navigated to a second post before the first unmounted
    clearActiveDestination('post', 'p1'); // the first screen's cleanup fires late
    expect(isViewingDestination('post', 'p2')).toBe(true); // must still be active
  });

  it('clear removes the active destination when it matches', () => {
    setActiveDestination('event', 'e1');
    clearActiveDestination('event', 'e1');
    expect(isViewingDestination('event', 'e1')).toBe(false);
  });

  it('switching kinds replaces the previous active destination', () => {
    setActiveDestination('post', 'p1');
    setActiveDestination('home');
    expect(isViewingDestination('post', 'p1')).toBe(false);
    expect(isViewingDestination('home')).toBe(true);
  });
});
