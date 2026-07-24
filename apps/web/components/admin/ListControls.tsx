"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}
export interface SortDef {
  value: string;
  label: string;
}

/**
 * URL-driven list controls: debounced human-readable search, dropdown filters,
 * sort field + direction. All state lives in the query string so every list view
 * is server-rendered, shareable, and back/forward friendly. Changing anything
 * resets to page 1.
 */
export function ListControls({
  searchPlaceholder,
  filters = [],
  sorts = [],
}: {
  searchPlaceholder: string;
  filters?: FilterDef[];
  sorts?: SortDef[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [term, setTerm] = useState(params.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const firstRender = useRef(true);

  function update(next: Record<string, string | undefined>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === "" || v === "all") sp.delete(k);
      else sp.set(k, v);
    }
    sp.delete("page"); // any control change returns to first page
    router.push(`${pathname}?${sp.toString()}`);
  }

  // Debounce the free-text search into the URL.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      update({ q: term.trim() || undefined });
    }, 350);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const dir = params.get("dir") ?? "desc";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[240px] flex-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={searchPlaceholder}
          type="search"
          className="no-native-clear w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
        />
      </div>

      {filters.map((f) => (
        <select
          key={f.key}
          value={params.get(f.key) ?? "all"}
          onChange={(e) => update({ [f.key]: e.target.value })}
          className="rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-8 text-sm text-gray-700 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          aria-label={f.label}
        >
          <option value="all">{f.label}: All</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}

      {sorts.length > 0 ? (
        <div className="flex items-center gap-1">
          <select
            value={params.get("sort") ?? sorts[0]?.value}
            onChange={(e) => update({ sort: e.target.value })}
            className="rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-8 text-sm text-gray-700 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            aria-label="Sort by"
          >
            {sorts.map((s) => (
              <option key={s.value} value={s.value}>
                Sort: {s.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => update({ dir: dir === "asc" ? "desc" : "asc" })}
            title={dir === "asc" ? "Ascending" : "Descending"}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            {dir === "asc" ? "↑" : "↓"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
