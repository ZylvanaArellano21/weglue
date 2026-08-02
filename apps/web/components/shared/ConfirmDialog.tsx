"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Web equivalent of apps/mobile/components/ConfirmModal.tsx — the small,
// focus-trapped yes/no dialog used for Log out, removing an RSVP and removing a
// profile picture. Deliberately a separate component from `Modal`: it must be
// able to sit ABOVE an open modal (Account Center) without the backdrop click of
// the dialog underneath swallowing the interaction, and it must never be
// dismissed by an accidental outside click while a destructive question is on
// screen. Escape cancels; the backdrop does not.
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive,
  loading,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  // Portaled to <body> for the same reason as Modal: an ancestor with
  // backdrop-filter (the sticky header) would otherwise become the containing
  // block for this fixed overlay.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Latest-callback ref, so the key handler below can be registered ONCE on
  // mount while still calling the current onCancel/loading.
  const latest = useRef({ onCancel, loading });
  latest.current = { onCancel, loading };

  // ── Focus ownership: mount and unmount ONLY ────────────────────────────────
  // This deliberately has an empty dep list. Callers pass inline arrow
  // functions, so a dependency on `onCancel` would re-run this effect on every
  // render — and its cleanup restores focus to the opener, which meant the
  // dialog yanked focus straight back out to <body> right after moving it in.
  // The result was a dialog that was visually open but had no focus inside it,
  // so Tab walked the page behind it and a screen reader never entered it.
  useEffect(() => {
    openerRef.current = document.activeElement;

    // Focus the SAFE option first, so Enter can never confirm a destructive
    // action the user has not read.
    //
    // Focused synchronously — NOT via requestAnimationFrame. The portal's
    // children are already in the DOM by the time this effect runs, and rAF is
    // paused outright in a background or unfocused window, which left the
    // dialog open with focus still on <body> and Tab walking the page behind
    // it. A timeout only covers the case where a child steals focus late.
    const focusFirst = () => panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    focusFirst();
    const t = window.setTimeout(focusFirst, 0);

    return () => {
      window.clearTimeout(t);
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Stop the event here so it cancels THIS dialog only and does not also
        // close the Account Center modal hosting it.
        e.stopPropagation();
        e.preventDefault();
        if (!latest.current.loading) latest.current.onCancel();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input,[tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  if (!mounted) return <></>;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4">
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="w-full max-w-[380px] rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h2 id="confirm-title" className="text-center text-[17px] font-bold text-gray-900">
          {title}
        </h2>
        <p
          id="confirm-message"
          className="mt-2 whitespace-pre-line break-words text-center text-sm leading-relaxed text-gray-600"
        >
          {message}
        </p>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-full border border-gray-200 bg-white py-2.5 text-[15px] font-semibold text-gray-900 transition-colors hover:bg-gray-50 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            aria-busy={loading}
            className="flex flex-1 items-center justify-center rounded-full py-2.5 text-[15px] font-semibold text-white transition-opacity disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            style={{ background: destructive ? "#F02719" : "#0FA6A6" }}
          >
            {loading ? (
              <span
                aria-hidden
                className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"
              />
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
