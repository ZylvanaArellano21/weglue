import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bug 8 — attachment bytes are fetched once per attachment, not once per
 * render pass.
 *
 * These assertions COUNT the downloads rather than describing them, so the
 * before/after claim is measured. Before this change every message bubble
 * downloaded independently of the info panel's media grid, and `useObjectUrls`
 * re-ran whenever the message list changed — so receiving a message
 * re-downloaded every image in the conversation, and leaving a chat and coming
 * back downloaded all of it again.
 */
const download = vi.fn();
vi.mock("../supabase-browser", () => ({
  getSupabaseBrowser: () => ({
    storage: { from: () => ({ download: (path: string) => download(path) }) },
  }),
}));

// Patch only the two object-URL statics; `new URL(...)` must keep working for
// everything else the module graph pulls in.
const revoked: string[] = [];
let created = 0;
URL.createObjectURL = (() => `blob:attachment-${++created}`) as typeof URL.createObjectURL;
URL.revokeObjectURL = ((url: string) => {
  revoked.push(url);
}) as typeof URL.revokeObjectURL;

const { attachmentObjectUrl, releaseAttachmentUrl, releaseAllAttachmentUrls } = await import("../messages/service");

const PATH_A = "11111111-1111-4111-8111-111111111111/aaaa.jpg";
const PATH_B = "11111111-1111-4111-8111-111111111111/bbbb.pdf";

describe("chat attachment fetching", () => {
  beforeEach(() => {
    releaseAllAttachmentUrls();
    download.mockReset();
    download.mockResolvedValue({ data: new Blob(["bytes"]), error: null });
    revoked.length = 0;
  });

  it("downloads a given attachment exactly once, however many times it is requested", async () => {
    const first = await attachmentObjectUrl(PATH_A);
    const second = await attachmentObjectUrl(PATH_A);
    const third = await attachmentObjectUrl(PATH_A);

    expect(download).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("collapses a simultaneous stampede into one request", async () => {
    // A thread mounting 40 bubbles that all show the same attachment.
    const urls = await Promise.all(Array.from({ length: 40 }, () => attachmentObjectUrl(PATH_A)));

    expect(download).toHaveBeenCalledTimes(1);
    expect(new Set(urls).size).toBe(1);
  });

  it("still fetches distinct attachments separately", async () => {
    await attachmentObjectUrl(PATH_A);
    await attachmentObjectUrl(PATH_B);

    expect(download).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledWith(PATH_A);
    expect(download).toHaveBeenCalledWith(PATH_B);
  });

  it("survives a re-mount, so leaving a chat and returning re-downloads nothing", async () => {
    await attachmentObjectUrl(PATH_A);
    // What an unmounting message bubble does.
    releaseAttachmentUrl(await attachmentObjectUrl(PATH_A));
    await attachmentObjectUrl(PATH_A);

    expect(download).toHaveBeenCalledTimes(1);
  });

  it("does not revoke a shared blob when one of its viewers unmounts", async () => {
    const url = await attachmentObjectUrl(PATH_A);
    releaseAttachmentUrl(url);

    // Revoking here would break the image for every other message showing it.
    expect(revoked).not.toContain(url);
  });

  it("still revokes a composer preview, which no one else shares", () => {
    releaseAttachmentUrl("blob:local-composer-preview");
    expect(revoked).toContain("blob:local-composer-preview");
  });

  /**
   * The authorization property is unchanged: bytes are fetched with an
   * authenticated `download()` that the storage policy evaluates, and the whole
   * cache is dropped when access may have changed — the same contract as
   * mobile's clearAttachmentCache().
   */
  it("drops every cached blob on an access change, and refetches afterwards", async () => {
    const url = await attachmentObjectUrl(PATH_A);

    releaseAllAttachmentUrls();

    expect(revoked).toContain(url);
    await attachmentObjectUrl(PATH_A);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("passes an absolute URL straight through without fetching it", async () => {
    expect(await attachmentObjectUrl("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(download).not.toHaveBeenCalled();
  });

  it("does not cache a failure, so a transient error can be retried", async () => {
    download.mockResolvedValueOnce({ data: null, error: new Error("network") });
    await expect(attachmentObjectUrl(PATH_A)).rejects.toThrow();

    download.mockResolvedValueOnce({ data: new Blob(["bytes"]), error: null });
    await expect(attachmentObjectUrl(PATH_A)).resolves.toMatch(/^blob:/);
    expect(download).toHaveBeenCalledTimes(2);
  });
});
