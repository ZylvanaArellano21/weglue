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
    const resetQueries = vi.fn();
    const queryClient = { resetQueries } as unknown as QueryClient;

    clearPermissionSensitiveStudentContent(queryClient);

    const keys = resetQueries.mock.calls.map(([arg]) => arg.queryKey);
    expect(keys).toContainEqual(["eventDetail"]);
    expect(keys).toContainEqual(["savedEventsUpcoming"]);
    expect(keys).toContainEqual(["eventAttendees"]);
    expect(keys).toContainEqual(["messages"]);
  });

  /**
   * Regression: this MUST be `resetQueries`, never `removeQueries`.
   *
   * Both discard the cached payload — the privacy requirement — but
   * `removeQueries` destroys a query that still has observers, so an in-flight
   * fetch resolves onto a discarded object and the component is stranded in
   * `pending`/`idle` forever. That was a real, reproduced defect: entering
   * /messages removed the in-flight message queries, leaving the conversation
   * list on its skeleton and the thread pane showing "This conversation isn't
   * available" for a conversation the viewer was a participant of.
   *
   * `resetQueries` clears the data AND refetches active observers.
   */
  it("resets rather than removes, so mounted screens refetch instead of stranding", () => {
    const resetQueries = vi.fn();
    const removeQueries = vi.fn();
    const queryClient = { resetQueries, removeQueries } as unknown as QueryClient;

    clearPermissionSensitiveStudentContent(queryClient);

    expect(removeQueries).not.toHaveBeenCalled();
    expect(resetQueries).toHaveBeenCalled();
    expect(resetQueries.mock.calls.map(([arg]) => arg.queryKey)).toContainEqual(["messages"]);
  });

  // Parity with mobile's STUDENT_CONTENT_QUERY_ROOTS. A block, restriction or
  // deletion changes who may appear in discovery search and who may appear on
  // an attendee list, so both roots must refresh on the opaque campus signal
  // rather than sitting on a previously authorized payload.
  it("refreshes discovery search and attendee lists, as mobile does", () => {
    expect(STUDENT_CONTENT_QUERY_ROOTS).toContain("discoverySearch");
    expect(STUDENT_CONTENT_QUERY_ROOTS).toContain("eventAttendees");

    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as unknown as QueryClient;
    invalidateStudentContentQueries(queryClient);

    const keys = invalidateQueries.mock.calls.map(([arg]) => arg.queryKey);
    expect(keys).toContainEqual(["discoverySearch"]);
    expect(keys).toContainEqual(["eventAttendees"]);
  });
});
