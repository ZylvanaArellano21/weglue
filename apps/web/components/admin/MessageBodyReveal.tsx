"use client";

import { useState } from "react";

interface Revealed {
  id: string;
  message_type: string;
  content: string | null;
  attachment: { name: string | null; size: number | null; mime: string | null } | null;
  poll_question: string | null;
}

/**
 * Recent-MFA-gated reveal of a single message body. Fetches from the POST
 * /admin/api/message-reveal endpoint (no-store; id in the body, never the URL).
 * The revealed text lives only in component state for this render — it is never
 * written to localStorage/sessionStorage and disappears on navigation. Deleted
 * messages are refused server-side and shown as an unavailable notice instead of
 * a reveal button.
 */
export function MessageBodyReveal({ messageId, deleted }: { messageId: string; deleted: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Revealed | null>(null);

  if (deleted) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
        <p className="text-sm font-medium text-gray-700">Message deleted</p>
        <p className="text-xs text-gray-400">
          If evidence was captured before deletion, it can be reviewed only from the related report after the founder private gateway and recent MFA verification.
        </p>
      </div>
    );
  }

  async function reveal() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/admin/api/message-reveal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ messageId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || (res.status === 403 ? "A recent MFA verification is required." : "Reveal failed."));
        return;
      }
      setData(json.data as Revealed);
    } catch {
      setError("Reveal failed.");
    } finally {
      setLoading(false);
    }
  }

  function hide() {
    setData(null);
  }

  if (data) {
    return (
      <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Revealed message body</p>
          <button onClick={hide} className="text-xs text-gray-500 hover:text-gray-800">
            Hide
          </button>
        </div>
        {data.poll_question ? (
          <p className="text-sm text-gray-900">
            <span className="text-xs uppercase text-gray-500">Poll question: </span>
            {data.poll_question}
          </p>
        ) : null}
        {data.content ? (
          <p className="whitespace-pre-wrap break-words text-sm text-gray-900">{data.content}</p>
        ) : !data.poll_question ? (
          <p className="text-sm text-gray-400">No text body on this message.</p>
        ) : null}
        {data.attachment ? (
          <p className="text-xs text-gray-500">
            Attachment: {data.attachment.name ?? "file"}
            {data.attachment.mime ? ` · ${data.attachment.mime}` : ""}
          </p>
        ) : null}
        <p className="text-[11px] text-gray-400">This body is shown once and not stored in your browser. Re-verify to view again after leaving.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={reveal}
        disabled={loading}
        className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
      >
        {loading ? "Verifying…" : "Reveal full message (requires recent MFA)"}
      </button>
      {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
    </div>
  );
}
