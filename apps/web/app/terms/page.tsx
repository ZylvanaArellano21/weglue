import { BackButton } from "../../components/auth/BackButton";
import { LegalDocumentBody } from "../../components/legal/LegalDocumentBody";

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
        <div className="mb-6">
          <BackButton />
        </div>
        <LegalDocumentBody />
      </div>
    </main>
  );
}
