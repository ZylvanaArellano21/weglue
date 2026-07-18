"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "./icons";

// Accessible dialog: dims + locks the background, closes on Escape, backdrop
// click and the X, traps focus, and restores focus to the opener on close.
export function Modal({
  onClose,
  labelledBy,
  children,
  maxWidth = 560,
}: {
  onClose: () => void;
  labelledBy?: string;
  children: ReactNode;
  maxWidth?: number;
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
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

    // Move focus into the dialog.
    requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("button,[href],input,[tabindex]")?.focus();
    });

    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey, true);
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  return (
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
        {children}
      </div>
    </div>
  );
}
