import Link from "next/link";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
} from "@weglue/shared/legal/termsAndConditions";
import { BackButton } from "../../components/auth/BackButton";

export const metadata = {
  title: "Child Safety Standards — We Glue",
  description:
    "We Glue's public standards for preventing and responding to child sexual abuse and exploitation.",
};

const standards = [
  {
    heading: "Zero tolerance",
    body:
      "We Glue prohibits child sexual abuse material, grooming, sexual exploitation, sexual solicitation of minors, and any content or behavior that endangers minors.",
  },
  {
    heading: "User reporting",
    body:
      "Users can report posts, messages, profiles, chats, clubs, and events from inside We Glue. Reports are saved for review and routed to the We Glue safety contact.",
  },
  {
    heading: "Review and enforcement",
    body:
      "We review safety reports and may remove content, restrict access, suspend accounts, preserve evidence, or take other action needed to protect users and the platform.",
  },
  {
    heading: "Legal escalation",
    body:
      "When We Glue becomes aware of apparent child sexual abuse material or exploitation, we will take appropriate action, including reporting to relevant regional or national authorities where required by law.",
  },
  {
    heading: "Prevention",
    body:
      "We Glue limits access to users who are 16 years old or older, requires account sign-in for core functionality, and maintains moderation/reporting systems to help identify unsafe behavior.",
  },
];

export default function ChildSafetyStandardsPage(): JSX.Element {
  return (
    <main className="min-h-screen bg-[#FEFCF0] px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <BackButton />
        </div>

        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#0FA6A6]">
          We Glue Safety
        </p>
        <h1 className="mb-2 text-3xl font-bold text-gray-900">
          Child Safety Standards
        </h1>
        <p className="mb-8 text-sm text-gray-500">
          Effective and last updated: {LEGAL_EFFECTIVE_DATE}
        </p>

        <div className="space-y-4 text-sm leading-relaxed text-gray-700">
          <p>
            These standards describe how We Glue works to prevent and respond to child
            sexual abuse and exploitation (CSAE) on our service. They apply to the We
            Glue mobile app, website, and related services.
          </p>
          <p>
            We Glue is a student-support community platform. The service is intended
            for users who are 16 years old or older and is not directed to children
            under 13.
          </p>

          {standards.map((section) => (
            <section key={section.heading}>
              <h2 className="mb-3 mt-8 text-base font-bold text-gray-900">
                {section.heading}
              </h2>
              <p>{section.body}</p>
            </section>
          ))}

          <section>
            <h2 className="mb-3 mt-8 text-base font-bold text-gray-900">
              Safety contact
            </h2>
            <p>
              The designated point of contact for questions about We Glue&apos;s CSAE
              prevention practices and compliance is{" "}
              <a
                className="font-medium text-[#0FA6A6] underline"
                href={`mailto:${LEGAL_CONTACT_EMAIL}`}
              >
                {LEGAL_CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-12 border-t pt-6 text-center text-xs text-gray-400">
          <Link className="hover:text-[#0FA6A6]" href="/terms">
            Terms &amp; Conditions
          </Link>
          <span className="px-2">·</span>
          <Link className="hover:text-[#0FA6A6]" href="/privacy-policy">
            Privacy Policy
          </Link>
        </div>
      </div>
    </main>
  );
}
