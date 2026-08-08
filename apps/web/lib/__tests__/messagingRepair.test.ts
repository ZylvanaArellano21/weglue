import { describe, expect, it } from "vitest";
import {
  clampChatImageAspect,
  CHAT_IMAGE_FALLBACK_ASPECT,
  fileSubtitle,
  fileTypeLabel,
  formatFileSize,
} from "@weglue/shared";
import { messagesHref } from "../messages/routes";

/**
 * Regression coverage at the exact boundaries the web messaging repair fixed.
 * Each block names the defect it prevents from coming back.
 */

describe("Bug 3 — a chat image must never collapse into a dot", () => {
  it("reserves a usable box when the intrinsic size is not known yet", () => {
    // The "tiny dot" in the correction screenshots was an <img> with no layout
    // box of its own. An unknown ratio must still produce a real one.
    expect(clampChatImageAspect(null)).toBe(CHAT_IMAGE_FALLBACK_ASPECT);
    expect(clampChatImageAspect(undefined)).toBe(CHAT_IMAGE_FALLBACK_ASPECT);
    expect(clampChatImageAspect(0)).toBe(CHAT_IMAGE_FALLBACK_ASPECT);
    expect(clampChatImageAspect(Number.NaN)).toBe(CHAT_IMAGE_FALLBACK_ASPECT);
    expect(clampChatImageAspect(-3)).toBe(CHAT_IMAGE_FALLBACK_ASPECT);
  });

  it("keeps the real aspect ratio of ordinary portrait and landscape photos", () => {
    expect(clampChatImageAspect(600 / 1000)).toBeCloseTo(0.6);
    expect(clampChatImageAspect(1200 / 500)).toBe(2);
  });

  it("clamps to the same bounds mobile uses, so one platform cannot dwarf the other", () => {
    expect(clampChatImageAspect(0.01)).toBe(0.5);
    expect(clampChatImageAspect(50)).toBe(2);
  });
});

describe("Update 3 — a file card reads the same on web as on mobile", () => {
  it("shows type and size the way the mobile card does", () => {
    expect(fileSubtitle("Payment Success.pdf", "application/pdf", 94208)).toBe("PDF · 92 KB");
  });

  it("omits an unknown size rather than printing a dangling separator", () => {
    expect(fileSubtitle("notes.txt", "text/plain", null)).toBe("TXT");
    expect(fileSubtitle("notes.txt", "text/plain", 0)).toBe("TXT");
  });

  it("falls back to the MIME type when the name carries no usable extension", () => {
    expect(fileTypeLabel("attachment", "application/pdf")).toBe("PDF");
    expect(fileTypeLabel(null, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("DOCX");
    expect(fileTypeLabel(null, null)).toBe("FILE");
  });

  it("formats sizes across the unit boundaries", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(94208)).toBe("92 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatFileSize(null)).toBe("");
  });
});

describe("Bug 2 — selecting a search result keeps its context", () => {
  it("carries the selected message id so the thread can scroll to and highlight it", () => {
    const href = messagesHref({
      filter: "single",
      conversationId: "3e352e0e-cc74-4ddb-8b8a-a5af31e0d7de",
      messageId: "8b8ad3d9-495e-45b2-bf7b-aa6218a4d198",
    });
    // The id was previously written and never read; it must at least survive
    // the URL contract for the thread to be able to act on it.
    expect(href).toContain("message=8b8ad3d9-495e-45b2-bf7b-aa6218a4d198");
  });

  it("can keep the details panel and its tab open, which is where Search lives", () => {
    const href = messagesHref({
      filter: "groups",
      conversationId: "2ac586f9-97e6-4fe7-a29b-acd90d0bb61b",
      messageId: "8b8ad3d9-495e-45b2-bf7b-aa6218a4d198",
      info: true,
      infoTab: "media",
    });
    expect(href).toContain("info=1");
    expect(href).toContain("infoTab=media");
    expect(href).toContain("message=");
  });

  it("ignores a malformed message id rather than putting it in the URL", () => {
    expect(messagesHref({ conversationId: "2ac586f9-97e6-4fe7-a29b-acd90d0bb61b", messageId: "not-a-uuid" })).not.toContain("message=");
  });
});
