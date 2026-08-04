import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import {
  STUDENT_CONTENT_QUERY_ROOTS,
  invalidateStudentContentQueries,
  clearPermissionSensitiveStudentContent,
  subscribeBrowserCanonicalRecovery,
} from "../studentSynchronization";

describe("Day 10E web content synchronization", () => {
  it("invalidates every lifecycle-sensitive root without applying event data", () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries, setQueryData: vi.fn() } as unknown as QueryClient;

    invalidateStudentContentQueries(queryClient);

    expect(invalidateQueries).toHaveBeenCalledTimes(STUDENT_CONTENT_QUERY_ROOTS.length);
    expect(invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toEqual(
      STUDENT_CONTENT_QUERY_ROOTS.map((root) => [root])
    );
    expect(queryClient.setQueryData).not.toHaveBeenCalled();
  });

  it("is idempotent for duplicate or delayed opaque broadcasts", () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    invalidateStudentContentQueries(queryClient);
    invalidateStudentContentQueries(queryClient);

    expect(invalidateQueries).toHaveBeenCalledTimes(STUDENT_CONTENT_QUERY_ROOTS.length * 2);
  });

  it("recovers canonically on focus, reconnect, and foreground visibility", () => {
    const listeners = new Map<string, () => void>();
    const windowTarget = {
      addEventListener: (event: string, listener: () => void) => listeners.set(`window:${event}`, listener),
      removeEventListener: (event: string) => listeners.delete(`window:${event}`),
    };
    const documentTarget = {
      visibilityState: "hidden",
      addEventListener: (event: string, listener: () => void) => listeners.set(`document:${event}`, listener),
      removeEventListener: (event: string) => listeners.delete(`document:${event}`),
    };
    const recover = vi.fn();
    const stop = subscribeBrowserCanonicalRecovery(recover, { windowTarget, documentTarget });

    listeners.get("window:focus")?.();
    listeners.get("window:online")?.();
    listeners.get("document:visibilitychange")?.();
    documentTarget.visibilityState = "visible";
    listeners.get("document:visibilitychange")?.();
    expect(recover).toHaveBeenCalledTimes(3);

    stop();
    expect(listeners.size).toBe(0);
  });

  it("clears selected-event and message payloads before canonical recovery", () => {
    const removeQueries = vi.fn();
    const queryClient = { removeQueries } as unknown as QueryClient;

    clearPermissionSensitiveStudentContent(queryClient);

    const keys = removeQueries.mock.calls.map(([arg]) => arg.queryKey);
    expect(keys).toContainEqual(["eventDetail"]);
    expect(keys).toContainEqual(["savedEventsUpcoming"]);
    expect(keys).toContainEqual(["eventAttendees"]);
    expect(keys).toContainEqual(["messages"]);
  });
});
