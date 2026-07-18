"use client";

import { useEffect, useRef, useState } from "react";
import { useIsOfficer } from "../../lib/hooks/useClubMembership";
import { PlusIcon, ImageIcon, CalendarIcon } from "../shared/icons";

// The "Share a Glue" creation menu. Options match permissions: Picture for
// everyone, Event only for club officers (event creation is enforced
// officer-only on the backend). The full create-post / create-event flows land
// in a later phase; onSelect is raised so the host can route/handle.
export function ShareAGlue({
  userId,
  onSelect,
}: {
  userId: string;
  onSelect: (kind: "post" | "event") => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: isOfficer } = useIsOfficer(userId);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const choose = (kind: "post" | "event") => {
    setOpen(false);
    onSelect(kind);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl bg-white px-4 py-3.5 text-left"
        style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid rgba(0,0,0,0.05)" }}
      >
        <PlusIcon size={22} strokeWidth={2.2} />
        <span className="text-[15px] font-semibold text-gray-800">Share a Glue</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-40 top-2 z-50 min-w-[150px] overflow-hidden rounded-xl bg-white py-1.5"
          style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.14)" }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => choose("post")}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[15px] text-gray-900 hover:bg-gray-50"
          >
            <ImageIcon size={20} /> Picture
          </button>
          {isOfficer && (
            <button
              type="button"
              role="menuitem"
              onClick={() => choose("event")}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[15px] text-gray-900 hover:bg-gray-50"
            >
              <CalendarIcon size={20} /> Event
            </button>
          )}
        </div>
      )}
    </div>
  );
}
