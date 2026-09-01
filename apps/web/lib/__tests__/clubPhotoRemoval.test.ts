import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ============================================================================
// Removing a photo from a club's "Photos that Glue" — web must match mobile
// ============================================================================
//
// Mobile is the canonical contract (apps/mobile/app/club/[clubId]/edit.tsx →
// handlePhotoOptions). There are exactly two cases and they are NOT the same
// operation:
//
//   tagged_post     -> remove_post_from_club(post, club)   detach from ONE club
//   officer_upload  -> delete_club_photo_everywhere(photo) delete the photo row
//
// The server half was proven against PRODUCTION in a rolled-back transaction:
// a non-officer is refused (`not_authorized`); after an officer removal
// posts.club_id is NULL, the post_club_tags row is gone, the club_photos row is
// gone, and the posts row itself is untouched and still readable by the
// creator, the officer and an outsider.
//
// This file pins the WEB half:
//   1. a tagged post reaches Home + the creator's profile + the tagged club;
//   2. an officer removes it from the club through the right RPC;
//   3. the club association disappears;
//   4. it disappears from that club's Photos that Glue;
//   5. the post still exists in Home and on the creator's profile;
// plus that web offers no third "hide" path and its wording is mobile's.
// ============================================================================

const rpc = vi.fn();
const from = vi.fn();
vi.mock("../supabase-browser", () => ({
  getSupabaseBrowser: () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    from: (...a: unknown[]) => from(...a),
  }),
}));

import * as clubManagement from "../clubs/clubManagement";
import { planClubPhotoRemoval } from "../clubs/clubPhotoRemoval";

const CLUB = "46906f64-0000-4000-8000-000000000001";
const OTHER_CLUB = "46906f64-0000-4000-8000-000000000002";
const CREATOR = "1b665001-0000-4000-8000-000000000001";
const POST = "7d2a3caf-0000-4000-8000-000000000001";
const CLUB_NAME = "Dog Club";

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  rpc.mockResolvedValue({ error: null });
});

// ── A model of the three tables, and of the exact statements the production
//    `remove_post_from_club__inner` runs (read back from prod and reproduced
//    here verbatim in effect: clear posts.club_id for this club, delete the
//    post_club_tags row for this club, delete the club_photos row for this
//    club — and nothing else).
interface Db {
  posts: { id: string; author_id: string; club_id: string | null; caption: string; image_url: string }[];
  post_club_tags: { post_id: string; club_id: string }[];
  club_photos: { id: string; club_id: string; post_id: string | null; source: string; is_visible: boolean }[];
}

function makeDb(): Db {
  return {
    posts: [
      { id: POST, author_id: CREATOR, club_id: CLUB, caption: "PROBE", image_url: "https://x/1.jpg" },
    ],
    post_club_tags: [{ post_id: POST, club_id: OTHER_CLUB }],
    club_photos: [
      { id: "photo-1", club_id: CLUB, post_id: POST, source: "tagged_post", is_visible: true },
      { id: "photo-2", club_id: OTHER_CLUB, post_id: POST, source: "tagged_post", is_visible: true },
    ],
  };
}

function applyRemovePostFromClub(db: Db, postId: string, clubId: string) {
  for (const p of db.posts) if (p.id === postId && p.club_id === clubId) p.club_id = null;
  db.post_club_tags = db.post_club_tags.filter((t) => !(t.post_id === postId && t.club_id === clubId));
  db.club_photos = db.club_photos.filter((c) => !(c.post_id === postId && c.club_id === clubId));
}

// The three reads the product actually performs.
const homeFeed = (db: Db) => db.posts.map((p) => p.id);
const creatorProfile = (db: Db, userId: string) =>
  db.posts.filter((p) => p.author_id === userId).map((p) => p.id);
/** getClubProfile's photo query: this club, visible, upload-or-tagged. */
const clubPhotosThatGlue = (db: Db, clubId: string) =>
  db.club_photos
    .filter((c) => c.club_id === clubId && c.is_visible && (c.source === "officer_upload" || c.post_id))
    .map((c) => c.id);

describe("officer removes a member's tagged post from a club", () => {
  it("runs the full contract end to end: 1 tagged everywhere, 2-4 removed from the club only, 5 post intact", async () => {
    const db = makeDb();

    // 1. The tagged post is in Home, on the creator's profile, and in the club.
    expect(homeFeed(db)).toContain(POST);
    expect(creatorProfile(db, CREATOR)).toContain(POST);
    expect(clubPhotosThatGlue(db, CLUB)).toContain("photo-1");
    expect(db.posts[0]!.club_id).toBe(CLUB);

    // 2. The officer removes it — through the officer-checked RPC, with the
    //    post id and the club id, and nothing else.
    await clubManagement.removePostFromClub(POST, CLUB);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("remove_post_from_club", { p_post_id: POST, p_club_id: CLUB });
    // Critically: the web client never issues a delete against `posts`.
    expect(from).not.toHaveBeenCalled();

    applyRemovePostFromClub(db, POST, CLUB);

    // 3. The club association is gone.
    expect(db.posts[0]!.club_id).toBeNull();
    expect(db.post_club_tags.filter((t) => t.club_id === CLUB)).toHaveLength(0);

    // 4. It is gone from THAT club's Photos that Glue.
    expect(clubPhotosThatGlue(db, CLUB)).not.toContain("photo-1");
    expect(clubPhotosThatGlue(db, CLUB)).toHaveLength(0);

    // 5. The post itself still exists — Home, creator profile, content intact.
    expect(db.posts).toHaveLength(1);
    expect(homeFeed(db)).toContain(POST);
    expect(creatorProfile(db, CREATOR)).toContain(POST);
    expect(db.posts[0]).toMatchObject({
      id: POST,
      author_id: CREATOR,
      caption: "PROBE",
      image_url: "https://x/1.jpg",
    });
  });

  it("leaves the post's OTHER club tags alone — removal is scoped to one club", async () => {
    const db = makeDb();
    await clubManagement.removePostFromClub(POST, CLUB);
    applyRemovePostFromClub(db, POST, CLUB);

    expect(db.post_club_tags).toEqual([{ post_id: POST, club_id: OTHER_CLUB }]);
    expect(clubPhotosThatGlue(db, OTHER_CLUB)).toContain("photo-2");
  });

  it("surfaces a server refusal instead of pretending the removal worked", async () => {
    rpc.mockResolvedValue({ error: { message: "not_authorized" } });
    await expect(clubManagement.removePostFromClub(POST, CLUB)).rejects.toMatchObject({
      message: "not_authorized",
    });
  });
});

describe("an officer-uploaded club photo", () => {
  it("is deleted by photo id, not by post id", async () => {
    await clubManagement.deleteClubPhotoEverywhere("photo-9");
    expect(rpc).toHaveBeenCalledWith("delete_club_photo_everywhere", { p_photo_id: "photo-9" });
  });
});

describe("web offers no third removal path", () => {
  it("no longer exports a club-photo hide", () => {
    // A web-only "hide" flipped club_photos.is_visible and LEFT the club tag in
    // place, so the post stayed attributed to a club it had been removed from.
    expect("hideClubPhoto" in clubManagement).toBe(false);
  });

  it("is not referenced by any live code path", () => {
    const root = join(__dirname, "..", "..");
    // Comments are stripped first: these files deliberately EXPLAIN why the
    // hide path was removed, and that prose must not fail the check.
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

    for (const file of [
      "components/clubs/ClubMediaOverlay.tsx",
      "components/clubs/ClubProfileClient.tsx",
      "lib/hooks/useClubManagement.ts",
      "lib/clubs/clubManagement.ts",
    ]) {
      const code = stripComments(readFileSync(join(root, file), "utf8"));
      expect(code, `${file} still references the removed hide path`).not.toMatch(
        /hideClubPhoto|Hide from this club/
      );
    }
  });
});

describe("removal wording is mobile's, exactly", () => {
  const mobileEdit = readFileSync(
    join(__dirname, "..", "..", "..", "mobile", "app", "club", "[clubId]", "edit.tsx"),
    "utf8"
  );

  it("uses mobile's tagged-post copy and calls it a removal, never a delete", () => {
    const plan = planClubPhotoRemoval({ source: "tagged_post", post_id: POST }, CLUB_NAME);

    expect(plan.kind).toBe("remove_post_from_club");
    expect(plan.title).toBe(`Remove this post from ${CLUB_NAME}?`);
    expect(plan.message).toBe(
      `The post will remain on the creator’s profile and anywhere it was shared, but the ${CLUB_NAME} tag will be removed.`
    );
    expect(plan.confirmLabel).toBe("Remove from club");
    expect(plan.successMessage).toBe(`Post removed from ${CLUB_NAME}.`);

    // The action must never present itself as deleting the post.
    expect(plan.title).not.toMatch(/delete/i);
    expect(plan.confirmLabel).not.toMatch(/delete/i);
    expect(plan.message).toMatch(/will remain on the creator/);

    // And the strings really are the ones in the mobile source.
    expect(mobileEdit).toContain("`Remove this post from ${clubName}?`");
    expect(mobileEdit).toContain(
      "`The post will remain on the creator’s profile and anywhere it was shared, but the ${clubName} tag will be removed.`"
    );
    expect(mobileEdit).toContain("text: 'Remove from club'");
  });

  it("uses mobile's officer-upload copy", () => {
    const plan = planClubPhotoRemoval({ source: "officer_upload", post_id: null }, CLUB_NAME);

    expect(plan.kind).toBe("delete_club_photo");
    expect(plan.title).toBe("Remove this photo?");
    expect(plan.message).toBe(`This photo will be removed from ${CLUB_NAME}’s Photos that Glue.`);
    expect(plan.confirmLabel).toBe("Remove photo");
    expect(plan.successMessage).toBe("Photo removed.");

    expect(mobileEdit).toContain("'Remove this photo?'");
    expect(mobileEdit).toContain("`This photo will be removed from ${clubName}’s Photos that Glue.`");
    expect(mobileEdit).toContain("text: 'Remove photo'");
  });

  it("treats a tagged row with no post id as a plain club photo rather than firing a null RPC", () => {
    const plan = planClubPhotoRemoval({ source: "tagged_post", post_id: null }, CLUB_NAME);
    expect(plan.kind).toBe("delete_club_photo");
  });

  it("falls back to neutral wording when the club name is blank", () => {
    const plan = planClubPhotoRemoval({ source: "tagged_post", post_id: POST }, "   ");
    expect(plan.title).toBe("Remove this post from this club?");
  });
});

describe("an officer's own club-profile post is authored BY the club", () => {
  // A post made from a Club Profile is club-authored (author_kind='club'):
  // the acting officer stays in posts.author_id for audit, the club is the
  // public author, and it still appears in Home AND the club. Its club identity
  // IS its authorship, so removal is a full delete (any officer), not a detach.
  const root = join(__dirname, "..", "..");

  it("web posts the locked club as authoredClubId, not a tag", () => {
    const compose = readFileSync(join(root, "components/home/ComposePostModal.tsx"), "utf8");
    expect(compose).toContain("const authoredClubId = lockedClub?.id;");
    expect(compose).toContain("const clubIds = lockedClub ? [] : selected;");
    expect(compose.match(/create\.mutate\(/g) ?? []).toHaveLength(1);

    const createPost = readFileSync(join(root, "lib/hooks/useCreatePost.ts"), "utf8");
    expect(createPost).toContain("p_club_id: authoredClubId ?? null,");
  });

  it("mobile posts the locked club as authoredClubId through one createPost call", () => {
    const newPost = readFileSync(
      join(__dirname, "..", "..", "..", "mobile", "app", "home", "new-post.tsx"),
      "utf8"
    );
    expect(newPost).toContain("const authoredClubId = locked ? lockedClubId! : undefined;");
    expect(newPost.match(/await createPost\(/g) ?? []).toHaveLength(1);
  });

  it("a legacy tagged post is still only DETACHED from the club", () => {
    const plan = planClubPhotoRemoval({ source: "tagged_post", post_id: POST }, CLUB_NAME);
    expect(plan.kind).toBe("remove_post_from_club");
  });

  it("a club-authored post is DELETED, not detached", () => {
    const plan = planClubPhotoRemoval({ source: "club_authored", post_id: POST }, CLUB_NAME);
    expect(plan.kind).toBe("delete_club_post");
    expect(plan.title).toBe(`Delete this ${CLUB_NAME} post?`);
  });
});
