"use client";

import { useState } from "react";

export default function DeleteAccountPage() {
  const [email, setEmail]   = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/delete-account-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), reason: reason.trim() || null }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Something went wrong. Please try again.");
      }

      setStatus("success");
    } catch (err: any) {
      setErrorMsg(err.message ?? "Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <main className="min-h-screen bg-[#FDFBEF] flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Request Received</h1>
          <p className="text-gray-600">
            We&apos;ve received your account deletion request. Your account will be
            permanently deleted within <strong>5 business days</strong>.
          </p>
          <p className="text-gray-500 text-sm mt-4">
            If you have questions, email us at{" "}
            <a href="mailto:support@weglue.app" className="text-[#0FA6A6] underline">
              support@weglue.app
            </a>
            .
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FDFBEF] flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Delete Your Account</h1>
        <p className="text-gray-600 mb-6 text-sm">
          Submitting this form will permanently delete your We Glue account and all
          associated data. This action cannot be undone. We will process your request
          within <strong>5 business days</strong>.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Your account email address <span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@university.edu"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA6A6]"
            />
          </div>

          <div>
            <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-1">
              Reason for leaving{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Help us improve by telling us why you're leaving…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA6A6] resize-none"
            />
          </div>

          {status === "error" && (
            <p className="text-red-600 text-sm">{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={status === "submitting"}
            className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
          >
            {status === "submitting" ? "Submitting…" : "Submit Deletion Request"}
          </button>
        </form>

        <p className="text-gray-400 text-xs mt-6 text-center">
          We Glue · weglue.app ·{" "}
          <a href="/privacy-policy" className="underline">
            Privacy Policy
          </a>{" "}
          ·{" "}
          <a href="/terms" className="underline">
            Terms of Service
          </a>
        </p>
      </div>
    </main>
  );
}
