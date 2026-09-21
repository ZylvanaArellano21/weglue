import { describe, expect, it } from "vitest";
import { avatarImagePixels, getResizedImageUrl } from "../imageResize";

describe("public media cache identity", () => {
  const original = "https://example.supabase.co/storage/v1/object/public/posts/u/photo.jpg";

  it("keeps one URL for the same asset and display preset", () => {
    const first = getResizedImageUrl(original, 960, 1200);
    expect(first).toBe(getResizedImageUrl(original, 960, 1200));
    expect(first).toContain("/storage/v1/render/image/public/posts/u/photo.jpg?width=960&height=1200&resize=cover&quality=75");
  });

  it("preserves an upload version and never rewrites private or external URLs", () => {
    expect(getResizedImageUrl(`${original}?v=123`, 128)).toContain("v=123&width=128");
    const privateUrl = "https://example.supabase.co/storage/v1/object/authenticated/chat-attachments/a.jpg";
    expect(getResizedImageUrl(privateUrl, 128)).toBe(privateUrl);
  });

  it("uses the same avatar transform for nearby UI sizes", () => {
    expect(avatarImagePixels(38)).toBe(128);
    expect(avatarImagePixels(40)).toBe(128);
  });
});
