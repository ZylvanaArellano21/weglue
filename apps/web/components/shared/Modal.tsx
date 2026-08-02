"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./icons";

// Accessible dialog: dims + locks the background, closes on Escape, backdrop
// click and the X, traps focus, and restores focus to the opener on close.
export function Modal({
  onClose,
  labelledBy,
  children,
  maxWidth = 560,
  onPrev,
  onNext,
  indicator,
}: {
  onClose: () => void;
  labelledBy?: string;
  children: ReactNode;
  maxWidth?: number;
  /** Optional adjacent navigation (calendar same-date events, adjacent media). */
  onPrev?: () => void;
  onNext?: () => void;
  indicator?: string;
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  // Rendered into <body> rather than in place. An ancestor with `filter`,
  // `backdrop-filter` or `transform` becomes the containing block for fixed
  // descendants — the sticky app header uses backdrop-blur, so a modal opened
  // from the header dropdown would otherwise be sized to the 64px header
  // instead of the viewport. `mounted` keeps SSR and the first client render
  // identical (no hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Latest-callback ref so the key handler registers once but always calls the
  // current callbacks.
  const latest = useRef({ onClose, onPrev, onNext });
  latest.current = { onClose, onPrev, onNext };

  // ── Focus + scroll-lock ownership: mount and unmount ONLY ──────────────────
  // Empty dep list on purpose. Callers pass inline arrows for onClose/onPrev/
  // onNext, so depending on them re-ran this effect on every render, and its
  // cleanup restores focus to the opener — which pulled focus straight back out
  // of the dialog after it had been moved in. The dialog then looked open but
  // held no focus, so Tab walked the page behind it.
  useEffect(() => {
    openerRef.current = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    // Synchronous, not requestAnimationFrame: rAF is paused entirely in a
    // background or unfocused window, which left the dialog holding no focus.
    const focusFirst = () =>
      panelRef.current?.querySelector<HTMLElement>("button,[href],input,[tabindex]")?.focus();
    focusFirst();
    const t = window.setTimeout(focusFirst, 0);

    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = overflow;
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        latest.current.onClose();
        return;
      }
      if (e.key === "ArrowLeft" && latest.current.onPrev) {
        latest.current.onPrev();
        return;
      }
      if (e.key === "ArrowRight" && latest.current.onNext) {
        latest.current.onNext();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
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
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="relative my-4 w-full rounded-2xl bg-cream shadow-2xl"
        style={{ maxWidth }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 rounded-full bg-white/80 p-1.5 text-gray-600 hover:text-gray-900"
          style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }}
        >
          <CloseIcon size={18} />
        </button>
        {indicator && (
          <span className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white">
            {indicator}
          </span>
        )}
        {children}
      </div>

      {onPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          aria-label="Previous"
          className="fixed left-2 top-1/2 z-[110] -translate-y-1/2 rounded-full bg-white/85 p-2.5 text-gray-800 shadow-lg hover:bg-white sm:left-6"
        >
          <ChevronGlyph dir="left" />
        </button>
      )}
      {onNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          aria-label="Next"
          className="fixed right-2 top-1/2 z-[110] -translate-y-1/2 rounded-full bg-white/85 p-2.5 text-gray-800 shadow-lg hover:bg-white sm:right-6"
        >
          <ChevronGlyph dir="right" />
        </button>
      )}
    </div>,
    document.body
  );
}

function ChevronGlyph({ dir }: { dir: "left" | "right" }): JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {dir === "left" ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
    </svg>
  );
}
