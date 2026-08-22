"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { publishAppRelease } from "../../lib/admin/appReleasesActions";
import type { Platform } from "../../lib/admin/appReleasesData";

/**
 * Publish form: platform + version, calling the existing publish_app_release
 * RPC (migration 090) through a single server action. Fans out a real push to
 * every eligible user on the chosen platform immediately (migration 089/091's
 * dispatch fix) — there is no undo, so this asks for an explicit confirmation
 * before submitting.
 */
export function AppReleasesActions() {
  const router = useRouter();
  const [platform, setPlatform] = useState<Platform>("ios");
  const [version, setVersion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const inFlight = useRef(false);

  const trimmedVersion = version.trim();
  const versionValid = /^\d+(\.\d+){0,3}$/.test(trimmedVersion);

  function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setSuccess(null);
    setConfirming(false);
    publishAppRelease(platform, trimmedVersion)
      .then((res) => {
        if (res.ok) {
          setSuccess(`${res.data.platform === "ios" ? "iOS" : "Android"} ${res.data.version} is now live and the update push has been sent.`);
          setVersion("");
          router.refresh();
        } else {
          setError(res.error);
        }
      })
      .catch(() => setError("Something went wrong."))
      .finally(() => {
        inFlight.current = false;
        setPending(false);
      });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Platform</label>
          <select
            value={platform}
            onChange={(e) => {
              setPlatform(e.target.value as Platform);
              setConfirming(false);
            }}
            disabled={pending}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
          >
            <option value="ios">iOS</option>
            <option value="android">Android</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Version</label>
          <input
            value={version}
            onChange={(e) => {
              setVersion(e.target.value);
              setConfirming(false);
            }}
            disabled={pending}
            placeholder="1.0.4"
            className="w-32 rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
          />
        </div>
        {!confirming ? (
          <button
            disabled={pending || !versionValid}
            onClick={() => setConfirming(true)}
            className="rounded-md bg-teal-500 px-3 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
          >
            Publish
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              disabled={pending}
              onClick={submit}
              className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? "Publishing…" : "Confirm: send push now"}
            </button>
            <button
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      <p className="text-xs text-gray-400">
        Only mark a version public once it is 100% publicly downloadable from the store — never for a
        TestFlight, internal-testing, or in-review build. This immediately sends a real push to every user with
        notifications enabled on the chosen platform.
      </p>
      {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {success ? <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{success}</div> : null}
    </div>
  );
}
