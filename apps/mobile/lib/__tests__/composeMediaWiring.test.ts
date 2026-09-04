import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-level guards for the post-compose media flow. The interactive pieces
// (gestures, the crop canvas) are exercised by hand on device; these lock the
// wiring that a refactor could silently break.

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('post compose passes the adaptive-ratio flow end to end', () => {
  it('new-post drives PhotoTray with naturalRatio + an Adjust handler, not a fixed crop ratio', () => {
    const src = read('app/home/new-post.tsx');
    expect(src).toMatch(/naturalRatio/);
    expect(src).toMatch(/onAdjust=\{handleAdjust\}/);
    // The old hard-coded [4,5] / clamped-tuple prop is gone.
    expect(src).not.toMatch(/cropAspect=/);
    expect(src).not.toMatch(/multiCropAspect/);
  });

  it('new-post offers the Original / 1:1 / 4:5 picker only on the first (or lone) photo', () => {
    const src = read('app/home/new-post.tsx');
    expect(src).toMatch(/postCropAspectOptions\(w, h\)/);
    expect(src).toMatch(/photos\.length <= 1 \|\| index === 0/);
  });

  it('new-post sends the first image ratio as the shared carousel ratio at submit', () => {
    const src = read('app/home/new-post.tsx');
    expect(src).toMatch(/carouselRatio/);
    expect(src).toMatch(/clampPostImageRatio\(first\.width \/ first\.height\)/);
  });

  it('createPost centre-crops carousel slides to the shared ratio, single photos stay natural', () => {
    const src = read('services/postService.ts');
    expect(src).toMatch(/carouselRatio\?: number/);
    expect(src).toMatch(/imageUris\.length > 1 \? carouselRatio : undefined/);
    expect(src).toMatch(/compressImage\(uri, targetRatio\)/);
  });

  it('PhotoCarousel derives the ratio from the first image for a carousel, not just a lone image', () => {
    const src = read('components/shared/PhotoCarousel.tsx');
    expect(src).toMatch(/naturalRatio && count >= 1/);
    expect(src).not.toMatch(/naturalSingle/);
  });

  it('the in-app cropper exposes a ratio picker for post compose', () => {
    const src = read('components/media/ImageCropper.tsx');
    expect(src).toMatch(/aspectOptions\?: CropAspectOption\[\]/);
    expect(src).toMatch(/showPicker/);
  });
});

describe('the New Post / New Event back button is not overlaid by the title on Android', () => {
  for (const file of ['app/home/new-post.tsx', 'app/home/new-event.tsx']) {
    it(`${file}: centred title is a pointerEvents:none View inset clear of the buttons`, () => {
      const src = read(file);
      // The title no longer spans the full header width as a bare <Text>.
      expect(src).toMatch(/pointerEvents="none"[\s\S]{0,160}left: 56,\s*\n\s*right: 56,/);
      expect(src).toMatch(/accessibilityLabel="Go back"/);
    });
  }
});
