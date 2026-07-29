"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Hit {
  id: string;
  conversation_id: string;
  sender_username: string;
  message_type: string;
  preview: string;
  created_at: string;
}

const MIN = 3;

/**
 * Recent-MFA-gated active-message content search. This is an EXPLICIT action
 * (button, not live-as-you-type) that POSTs the term to /admin/api/message-search
 * (no-store; term in the body, never a URL). Server enforces min length, a result
 * cap, deleted-message exclusion, and no content logging. Terms/results are never
 * persisted in the browser.
 */
export function SensitiveMessageSearch() {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);

  async function run() {
    const q = term.trim();
    if (q.length < MIN) {
      setError(`Enter at least ${MIN} characters.`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/admin/api/message-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ q }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || (res.status === 403 ? "A recent MFA verification is required." : "Search failed."));
        setHits(null);
        return;
      }
      setHits(json.data as Hit[]);
    } catch {
      setError("Search failed.");
      setHits(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Search the text of currently-visible messages. This is a sensitive action: it requires a recent MFA verification, a minimum of {MIN}{" "}
        characters, and returns a limited number of results. Deleted messages are never searched.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
          }}
          placeholder="Search message content…"
          className="min-w-[240px] flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
        />
        <button
          onClick={run}
          disabled={loading || term.trim().length < MIN}
          className="rounded-md bg-teal-500 px-3 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
        >
          {loading ? "Verifying…" : "Search content"}
        </button>
      </div>

      {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      {hits ? (
        hits.length === 0 ? (
          <p className="text-sm text-gray-500">No visible messages match that text.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {hits.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <button onClick={() => router.push(`/admin/messages/${h.id}`)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm text-gray-900">{h.preview}</span>
                  <span className="block truncate text-xs text-gray-500">@{h.sender_username}</span>
                </button>
                <button
                  onClick={() => router.push(`/admin/conversations/${h.conversation_id}`)}
                  className="shrink-0 text-xs text-teal-600 hover:underline"
                >
                  Conversation →
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
