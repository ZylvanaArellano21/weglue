"use client";

import { useState } from "react";

export default function DeleteAccountPage(): JSX.Element {
  const [email, setEmail] = useState("");
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setErrorMsg(message);
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <main className="min-h-screen bg-[#FEFCF0] flex items-center justify-center px-6 py-12">
        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#0FA6A6]/10 mb-6">
            <span className="text-2xl" aria-hidden>
              ✓
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4 tracking-tight">Request Received</h1>
          <p className="text-gray-600 leading-relaxed">
            We&apos;ve received your account deletion request. Your account will be permanently
            deleted within <strong>5 business days</strong>.
          </p>
          <p className="text-gray-500 text-sm mt-6 leading-relaxed">
            If you have questions, email us at{" "}
            <a href="mailto:support@weglue.app" className="text-[#0FA6A6] underline font-medium">
              support@weglue.app
            </a>
            .
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex items-center justify-center px-6 py-12">
      <div className="max-w-md w-full">
        <p className="text-[#0FA6A6] font-semibold text-sm tracking-wide uppercase mb-2">We Glue</p>
        <h1 className="text-2xl font-bold text-gray-900 mb-2 tracking-tight">Delete Your Account</h1>
        <p className="text-gray-600 mb-8 text-sm leading-relaxed">
          Submitting this form will permanently delete your We Glue account and all associated
          data. This action cannot be undone. We will process your request within{" "}
          <strong>5 business days</strong>.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-800 mb-1.5">
              Your account email address <span className="text-[#F02719]">*</span>
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@university.edu"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0FA6A6] focus:border-transparent"
              autoComplete="email"
            />
          </div>

          <div>
            <label htmlFor="reason" className="block text-sm font-medium text-gray-800 mb-1.5">
              Reason for leaving{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Help us improve by telling us why you're leaving…"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0FA6A6] focus:border-transparent resize-none"
            />
          </div>

          {status === "error" && (
            <p className="text-[#F02719] text-sm" role="alert">
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={status === "submitting"}
            className="w-full bg-[#F02719] hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl text-sm transition-colors shadow-sm"
          >
            {status === "submitting" ? "Submitting…" : "Submit Deletion Request"}
          </button>
        </form>

        <p className="text-gray-400 text-xs mt-8 text-center leading-relaxed">
          We Glue · weglue.app ·{" "}
          <a href="/privacy-policy" className="underline hover:text-gray-600">
            Privacy Policy
          </a>{" "}
          ·{" "}
          <a href="/terms" className="underline hover:text-gray-600">
            Terms &amp; Conditions
          </a>
        </p>
      </div>
    </main>
  );
}
