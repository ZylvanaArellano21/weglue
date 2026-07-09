import {
  LEGAL_EFFECTIVE_DATE,
  TERMS_AND_CONDITIONS_INTRO,
  TERMS_AND_CONDITIONS_SECTIONS,
  TERMS_AND_CONDITIONS_TITLE,
} from "@weglue/shared";

export const metadata = {
  title: "Terms & Conditions — We Glue",
};

// Single legal document: Terms and the Privacy Policy in one page, matching
// the in-app Terms & Conditions screen exactly. No legal links inside the
// content — it reads as one clean, continuous document.
export default function TermsPage(): JSX.Element {
  return (
    <main className="min-h-screen bg-[#FEFCF0] px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
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
      </div>
    </main>
  );
}
