"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { lockAdminPortal } from "../../lib/admin/actions";
import { testSupabaseConnection } from "../../lib/admin/settingsActions";

/**
 * Settings operational controls. All are safe: lock (sign out + require MFA),
 * MFA re-challenge (navigate), read-only connection test, and a clipboard copy
 * of a content-free diagnostics summary. No environment mutation exists.
 */
export function SettingsActions({ diagnostics }: { diagnostics: Record<string, unknown> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [conn, setConn] = useState<null | { ok: boolean; msg: string }>(null);
  const [copied, setCopied] = useState(false);

  async function lock() {
    setBusy("lock");
    try {
      await lockAdminPortal();
    } catch {
      /* proceed to login regardless */
    }
    router.replace("/login?next=/admin");
    router.refresh();
  }

  async function test() {
    setBusy("test");
    setConn(null);
    try {
      const res = await testSupabaseConnection();
      setConn(res.ok ? { ok: true, msg: "Read probe succeeded." } : { ok: false, msg: res.error });
    } catch {
      setConn({ ok: false, msg: "Connection test failed." });
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const btn = "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button onClick={lock} disabled={busy === "lock"} className={`${btn} border-red-200 text-red-700 hover:bg-red-50`}>
          🔒 Lock portal (sign out)
        </button>
        <Link href="/admin/mfa?next=/admin/settings" className={btn}>
          Start MFA re-challenge
        </Link>
        <Link href="/admin/data-health" className={btn}>
          Run Data Health scan
        </Link>
        <button onClick={test} disabled={busy === "test"} className={btn}>
          {busy === "test" ? "Testing…" : "Test Supabase connection"}
        </button>
        <button onClick={copy} className={btn}>
          {copied ? "Copied ✓" : "Copy diagnostics summary"}
        </button>
      </div>
      {conn ? (
        <p className={`text-sm ${conn.ok ? "text-green-700" : "text-red-700"}`}>
          {conn.ok ? "✓ " : "✗ "}
          {conn.msg}
        </p>
      ) : null}
    </div>
  );
}
