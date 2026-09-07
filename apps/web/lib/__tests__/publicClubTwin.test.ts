import { describe, it, expect } from "vitest";
import { publicClubPhotos } from "../publicClub";
import type { PublicClubTwin } from "../publicClub";

// The public club twin's "Photos that Glue" merge — the migration 131 `media`
// items plus any official club-authored post carrying a cover image that isn't
// already in `media`, newest first (mirrors the authenticated profile).

function twin(overrides: Partial<PublicClubTwin>): PublicClubTwin {
  return {
    id: "c",
    name: "Club",
    handle: null,
    avatar_url: null,
    banner_url: null,
    description: null,
    goals: [],
    meeting_day: null,
    meeting_time_start: null,
    meeting_time_end: null,
    meeting_schedule: null,
    meeting_location: null,
    meeting_building: null,
    meeting_room: null,
    member_count: 0,
    officers: [],
    upcoming_events: { items: [], has_more: false },
    past_events: { items: [], has_more: false },
    media: { items: [], has_more: false },
    posts: { items: [], has_more: false },
    ...overrides,
  };
}

const media = (id: string, created_at: string, image_count = 1) => ({
  id,
  url: `https://x/${id}.jpg`,
  caption: null,
  source: "officer_upload",
  image_count,
  created_at,
});

const post = (id: string, created_at: string, image_url: string | null, images = 0) => ({
  id,
  caption: null,
  image_url,
  images: Array.from({ length: images }, (_, i) => ({ path: `p${i}`, width: null, height: null, position: i })),
  created_at,
});

describe("publicClubPhotos", () => {
  it("returns media items newest-first", () => {
    const t = twin({
      media: {
        items: [media("a", "2026-01-01T00:00:00Z"), media("b", "2026-03-01T00:00:00Z")],
        has_more: false,
      },
    });
    expect(publicClubPhotos(t).map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("folds in club-authored posts with a cover image, interleaved by date", () => {
    const t = twin({
      media: { items: [media("m1", "2026-02-01T00:00:00Z")], has_more: false },
      posts: {
        items: [
          post("p1", "2026-03-01T00:00:00Z", "https://x/p1.jpg"),
          post("p2", "2026-01-01T00:00:00Z", "https://x/p2.jpg"),
        ],
        has_more: false,
      },
    });
    expect(publicClubPhotos(t).map((p) => p.id)).toEqual(["p1", "m1", "p2"]);
  });

  it("skips posts with no cover image", () => {
    const t = twin({
      posts: { items: [post("p1", "2026-01-01T00:00:00Z", null)], has_more: false },
    });
    expect(publicClubPhotos(t)).toEqual([]);
  });

  it("does not duplicate a post already present in media (same id)", () => {
    const t = twin({
      media: { items: [media("shared", "2026-01-01T00:00:00Z")], has_more: false },
      posts: { items: [post("shared", "2026-01-01T00:00:00Z", "https://x/shared.jpg")], has_more: false },
    });
    expect(publicClubPhotos(t).map((p) => p.id)).toEqual(["shared"]);
  });

  it("carries the carousel count from a multi-image post", () => {
    const t = twin({
      posts: { items: [post("p1", "2026-01-01T00:00:00Z", "https://x/p1.jpg", 4)], has_more: false },
    });
    const out = publicClubPhotos(t);
    expect(out).toHaveLength(1);
    expect(out[0]!.image_count).toBe(4);
  });
});
