"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Server-pagination controls. Renders the current window and prev/next, driven
 * by the `page` query param so navigation stays server-rendered.
 */
export function Pagination({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  function goto(p: number) {
    const sp = new URLSearchParams(params.toString());
    if (p <= 1) sp.delete("page");
    else sp.set("page", String(p));
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm">
      <p className="text-gray-500">
        {total === 0 ? "No results" : (
          <>
            <span className="font-medium text-gray-700">{from.toLocaleString()}</span>–
            <span className="font-medium text-gray-700">{to.toLocaleString()}</span> of{" "}
            <span className="font-medium text-gray-700">{total.toLocaleString()}</span>
          </>
        )}
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => goto(page - 1)}
          disabled={page <= 1}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-600 enabled:hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Prev
        </button>
        <span className="text-xs text-gray-400">
          Page {page} / {totalPages}
        </span>
        <button
          onClick={() => goto(page + 1)}
          disabled={page >= totalPages}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-600 enabled:hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
