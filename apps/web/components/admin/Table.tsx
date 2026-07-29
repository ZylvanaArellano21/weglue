"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/** Compact admin table shell with horizontal scroll on narrow laptops. */
export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            {head}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <th className={`whitespace-nowrap px-4 py-2.5 font-medium ${className}`}>{children}</th>;
}

export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 align-middle ${className}`}>{children ?? <span className="text-gray-300">—</span>}</td>;
}

/** A fully clickable table row that navigates to `href` (keyboard accessible). */
export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(href);
      }}
      tabIndex={0}
      className="cursor-pointer text-gray-700 outline-none transition hover:bg-teal-50/40 focus:bg-teal-50/60"
    >
      {children}
    </tr>
  );
}
