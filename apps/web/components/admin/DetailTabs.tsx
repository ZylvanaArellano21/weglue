"use client";

import { useState, type ReactNode } from "react";

export interface DetailTab {
  key: string;
  label: string;
  count?: number;
  content: ReactNode;
}

/**
 * Tabbed detail view. All panels are rendered server-side and passed in as
 * `content`; this component only toggles which one is visible, so there is no
 * client re-fetch when switching tabs.
 */
export function DetailTabs({ tabs, initial }: { tabs: DetailTab[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {tabs.map((t) => {
          const isActive = t.key === current?.key;
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? "border-teal-500 text-teal-700"
                  : "border-transparent text-gray-500 hover:border-gray-200 hover:text-gray-800"
              }`}
            >
              {t.label}
              {typeof t.count === "number" ? (
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    isActive ? "bg-teal-50 text-teal-700" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {t.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="pt-5">{current?.content}</div>
    </div>
  );
}
