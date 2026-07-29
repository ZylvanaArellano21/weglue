"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Rerun scan (server refresh) + copy a safe diagnostics summary to clipboard. */
export function DataHealthControls({ summary }: { summary: Record<string, unknown> }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => {
          setPending(true);
          router.refresh();
          setTimeout(() => setPending(false), 800);
        }}
        disabled={pending}
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? "Rescanning…" : "↻ Rerun scan"}
      </button>
      <button
        onClick={copy}
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        {copied ? "Copied ✓" : "Copy summary"}
      </button>
    </div>
  );
}
