"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "../shared/Avatar";

export interface PickedEntity {
  id: string;
  label: string;
  sub?: string;
  avatar_url?: string | null;
}

/**
 * Searchable user/club picker backed by the founder-gated /admin/api/search.
 * Human-readable — never asks for a UUID. Calls onPick with the chosen entity.
 */
export function EntityPicker({
  kind,
  value,
  onPick,
  placeholder,
}: {
  kind: "user" | "club";
  value: PickedEntity | null;
  onPick: (e: PickedEntity | null) => void;
  placeholder?: string;
}) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PickedEntity[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const q = term.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/admin/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        const items: PickedEntity[] =
          kind === "user"
            ? (data.users ?? []).map((u: any) => ({ id: u.id, label: u.full_name || u.username, sub: `@${u.username}${u.email ? ` · ${u.email}` : ""}`, avatar_url: u.avatar_url }))
            : (data.clubs ?? []).map((c: any) => ({ id: c.id, label: c.name, sub: `@${c.handle}${c.university ? ` · ${c.university}` : ""}`, avatar_url: c.avatar_url }));
        setResults(items);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [term, kind]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <Avatar uri={value.avatar_url} name={value.label} size={26} />
          <div>
            <p className="text-sm font-medium text-gray-900">{value.label}</p>
            {value.sub ? <p className="text-xs text-gray-500">{value.sub}</p> : null}
          </div>
        </div>
        <button onClick={() => onPick(null)} className="text-xs font-medium text-teal-700 hover:underline">
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => term.trim().length >= 2 && setOpen(true)}
        placeholder={placeholder ?? `Search ${kind}s…`}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
      />
      {open && (results.length > 0 || loading) ? (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {loading && results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">Searching…</p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  onPick(r);
                  setOpen(false);
                  setTerm("");
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
              >
                <Avatar uri={r.avatar_url} name={r.label} size={24} />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-gray-900">{r.label}</span>
                  {r.sub ? <span className="block truncate text-xs text-gray-500">{r.sub}</span> : null}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
