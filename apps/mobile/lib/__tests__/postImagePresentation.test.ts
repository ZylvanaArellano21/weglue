import { describe, expect, it } from 'vitest';
import {
  clampPostImageRatio,
  naturalCropAspect,
  postMediaDisplayRatio,
  POST_IMAGE_MIN_RATIO,
  POST_IMAGE_MAX_RATIO,
  POST_IMAGE_FALLBACK_RATIO,
} from '@weglue/shared';

const ratio = ([w, h]: [number, number]) => w / h;

describe('naturalCropAspect', () => {
  it('keeps a landscape image landscape (does not force square/portrait)', () => {
    // 3:2 landscape (1.5) is inside the feed-safe range → returned as-is.
    expect(ratio(naturalCropAspect(3000, 2000))).toBeCloseTo(1.5, 2);
    // 16:9 (~1.78) also in range.
    expect(ratio(naturalCropAspect(1920, 1080))).toBeCloseTo(16 / 9, 2);
  });

  it('keeps a portrait image portrait', () => {
    expect(ratio(naturalCropAspect(1080, 1350))).toBeCloseTo(0.8, 2);
    expect(ratio(naturalCropAspect(1000, 1600))).toBeCloseTo(POST_IMAGE_MIN_RATIO, 2);
  });

  it('clamps only genuinely extreme ratios into the feed-safe range', () => {
    // 2.4:1 panorama → clamped to the max, still landscape.
    expect(ratio(naturalCropAspect(2400, 1000))).toBeCloseTo(POST_IMAGE_MAX_RATIO, 2);
    // 1:2 skyscraper → clamped to the min, still portrait.
    expect(ratio(naturalCropAspect(600, 1200))).toBeCloseTo(POST_IMAGE_MIN_RATIO, 2);
  });

  it('falls back for a missing/zero dimension', () => {
    expect(ratio(naturalCropAspect(0, 0))).toBeCloseTo(POST_IMAGE_FALLBACK_RATIO, 2);
    expect(ratio(naturalCropAspect(null, 1000))).toBeCloseTo(POST_IMAGE_FALLBACK_RATIO, 2);
  });

  it('returns an integer [w, h] pair', () => {
    const [w, h] = naturalCropAspect(1920, 1080);
    expect(Number.isInteger(w)).toBe(true);
    expect(Number.isInteger(h)).toBe(true);
  });
});

describe('postMediaDisplayRatio', () => {
  it('single image → its own clamped natural ratio', () => {
    expect(postMediaDisplayRatio([{ width: 1920, height: 1080 }])).toBeCloseTo(16 / 9, 2);
    expect(postMediaDisplayRatio([{ width: 1080, height: 1350 }])).toBeCloseTo(0.8, 2);
  });

  it('carousel → the FIRST image ratio, shared (landscape batch stays landscape)', () => {
    const ratioValue = postMediaDisplayRatio([
      { width: 3000, height: 2000 }, // first: 3:2 landscape
      { width: 1080, height: 1350 }, // portrait — ignored for the shared ratio
      { width: 1000, height: 1000 },
    ]);
    expect(ratioValue).toBeCloseTo(1.5, 2);
  });

  it('uses the fallback only until the first image size is known', () => {
    expect(postMediaDisplayRatio([{ width: null, height: null }, { width: 1, height: 1 }])).toBe(
      POST_IMAGE_FALLBACK_RATIO,
    );
    expect(postMediaDisplayRatio([null])).toBe(POST_IMAGE_FALLBACK_RATIO);
  });
});

describe('clampPostImageRatio', () => {
  it('leaves an in-range landscape ratio untouched', () => {
    expect(clampPostImageRatio(1.5)).toBeCloseTo(1.5, 5);
  });
  it('clamps out-of-range ratios to the bounds', () => {
    expect(clampPostImageRatio(5)).toBe(POST_IMAGE_MAX_RATIO);
    expect(clampPostImageRatio(0.2)).toBe(POST_IMAGE_MIN_RATIO);
  });
  it('falls back on a malformed ratio', () => {
    expect(clampPostImageRatio(0)).toBe(POST_IMAGE_FALLBACK_RATIO);
    expect(clampPostImageRatio(NaN)).toBe(POST_IMAGE_FALLBACK_RATIO);
    expect(clampPostImageRatio(null)).toBe(POST_IMAGE_FALLBACK_RATIO);
  });
});
