// ⚠️  PLACEHOLDER — Terms of Service text was not included in the task prompt.
// The full terms text must be provided by the founder before this page goes live.
// Replace the PLACEHOLDER_TERMS_CONTENT below with the exact legal text.

export default function TermsPage(): JSX.Element {
  return (
    <main className="min-h-screen bg-[#FDFBEF] px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-gray-500 text-sm mb-8">Last updated: July 2026</p>

        <div className="prose prose-gray max-w-none text-sm leading-relaxed text-gray-700">
          {/* ─────────────────────────────────────────────────────────────────────
              PLACEHOLDER — Replace with exact terms text from legal document.
              ───────────────────────────────────────────────────────────────── */}
          <p className="text-red-500 font-semibold">
            [Terms of Service content pending — please provide the full legal text.]
          </p>
        </div>

        <div className="mt-12 border-t pt-6 text-center text-xs text-gray-400">
          We Glue ·{" "}
          <a href="/privacy-policy" className="underline">
            Privacy Policy
          </a>{" "}
          ·{" "}
          <a href="/delete-account" className="underline">
            Delete Account
          </a>
        </div>
      </div>
    </main>
  );
}
