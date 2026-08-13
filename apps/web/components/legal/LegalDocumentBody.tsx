import {
  LEGAL_EFFECTIVE_DATE,
  TERMS_AND_CONDITIONS_INTRO,
  TERMS_AND_CONDITIONS_SECTIONS,
  TERMS_AND_CONDITIONS_TITLE,
} from "@weglue/shared";

// The Terms and the Privacy Policy live in one scrollable document with no
// legal links inside the content. Shared by the full-page /terms route and
// the signup legal modal, so both read the exact same text.
export function LegalDocumentBody(): JSX.Element {
  return (
    <>
      <h1 id="legal-title" className="text-3xl font-bold text-gray-900 mb-2">
        {TERMS_AND_CONDITIONS_TITLE}
      </h1>
      <p className="text-gray-500 text-sm mb-8">
        Effective and last updated: {LEGAL_EFFECTIVE_DATE}
      </p>

      <div className="text-sm leading-relaxed text-gray-700 space-y-4">
        {TERMS_AND_CONDITIONS_INTRO.map((paragraph, i) => (
          <p key={`intro-${i}`}>{paragraph}</p>
        ))}

        {TERMS_AND_CONDITIONS_SECTIONS.map((section) => (
          <section key={section.heading}>
            <h2 className="text-base font-bold text-gray-900 mt-8 mb-3">
              {section.heading}
            </h2>
            <div className="space-y-3">
              {section.body.map((paragraph, i) =>
                paragraph.startsWith("• ") ? (
                  <p key={i} className="pl-5 relative">
                    <span className="absolute left-1">•</span>
                    {paragraph.slice(2)}
                  </p>
                ) : (
                  <p key={i}>{paragraph}</p>
                ),
              )}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-12 border-t pt-6 text-center text-xs text-gray-400">
        We Glue
      </div>
    </>
  );
}
