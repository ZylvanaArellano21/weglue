import Link from "next/link";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
} from "@weglue/shared/legal/termsAndConditions";
import { BackButton } from "../../components/auth/BackButton";

export const metadata = {
  title: "Community Guidelines — We Glue",
  description:
    "How to stay safe on We Glue: reporting, blocking, and what We Glue does about behavior that breaks the rules.",
};

// ─── Community Guidelines ───────────────────────────────────────────────────
//
// Public, student-facing companion to the Terms. The Terms say what is
// prohibited in legal language; this page says what a student can DO about it
// and what actually happens when they do.
//
// Written to be accurate rather than reassuring. Where a control has a limit —
// blocking not deleting shared history, blocking not being a report — the limit
// is stated plainly, because a student who expects more than the product does
// is a student who will be let down at the worst possible moment.

const sections = [
  {
    heading: "Treat people the way you would on campus",
    body: [
      "We Glue is for students finding clubs, events and people at their own school. Harassment, threats, stalking, bullying, impersonation, hate speech and sexual harassment are not allowed, and neither is repeatedly contacting someone who does not want to hear from you.",
      "The full list of prohibited behavior is in our Terms & Conditions. This page is about the tools you have when someone breaks it.",
    ],
  },
  {
    heading: "Blocking someone",
    body: [
      "If another student makes you uncomfortable, you can block them. You do not need a reason, and you do not need to report them first.",
      "Blocking takes effect immediately. The person you block is NOT told, and there is no notification, badge or message that reveals it. Only you can see your Blocked Accounts list.",
    ],
    bullets: [
      "You can block from their profile, from a direct conversation, from the report flow, or from Settings → Blocked Accounts.",
      "They cannot find your profile, and you will not see theirs.",
      "Neither of you can start a new direct conversation or send a new direct message.",
      "Any existing follow between you is removed in both directions, which also ends a Gluemate connection.",
      "You can unblock at any time — but unblocking does not restore the follows or the Gluemate connection you had before.",
    ],
  },
  {
    heading: "What blocking does not do",
    body: [
      "We would rather be straight with you about the limits than have you find them out later.",
    ],
    bullets: [
      "You may still share campus clubs, group chats and official events with someone you blocked. Blocking stops direct contact between you; it does not remove either of you from a group you both chose to join.",
      "Official club and event information stays visible. If you block someone who runs a club you are in, you will still see that club's posts, events and announcements — losing your club's meeting times because of a personal block would not be safe.",
      "Blocking does not delete history. Messages already sent in a shared group or club conversation stay there for everyone, and your existing direct-message history is not erased.",
      "Blocking is not a report. It changes your experience; it does not ask us to review anyone.",
    ],
  },
  {
    heading: "Reporting someone",
    body: [
      "Reporting is a separate action from blocking, and it is the one that reaches us. Use it when behavior breaks the rules, not just when you want it out of your feed.",
      "You can report a profile, post, comment, message, club, chat or event from inside We Glue. When you report a person, you can choose “Report and block” to do both at once.",
      "You can still report someone you have already blocked, and blocking someone does not stop them from being reported by anyone else.",
    ],
  },
  {
    heading: "If we restrict an account",
    body: [
      "When someone breaks these guidelines, we may restrict their access to We Glue. A restriction can be temporary (with or without an end date), last until we lift it, or accompany a scheduled account deletion. It is our decision about the platform, and it is separate from anyone blocking anyone.",
    ],
    bullets: [
      "A restricted account keeps its content. Posts, messages, clubs, events and media are not deleted just because access was restricted — restriction is not deletion.",
      "The affected person is shown a violation category and a specific plain-language reason. Internal notes, reporter identities and private evidence stay private. If you think a decision about your account is wrong, email zylvana.arellano.campos@gmail.com with your We Glue username and we will look at it.",
      "Administrator deletion normally allows seven days to appeal. We may use immediate deletion for urgent safety, legal, fraud, or institutional situations.",
      "You can always delete your account, including while restricted. That option never goes away.",
      "Restrictions do not change who you or anyone else has blocked. Those are your choices and they stay yours.",
    ],
  },
  {
    heading: "What We Glue does",
    body: [
      "We review reports and may remove content, restrict access to the service, or take other action needed to keep students safe. We act independently of whether you blocked the person — a block is your decision about your experience, and moderation is ours about the platform.",
      "We are not able to monitor every conversation, and we do not read private messages routinely. Reporting is what brings something to our attention.",
      "If someone is in immediate danger, contact your local emergency services or campus police first. We Glue is not an emergency service.",
    ],
  },
];

export default function CommunityGuidelinesPage(): JSX.Element {
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
          Community Guidelines
        </h1>
        <p className="mb-8 text-sm text-gray-500">
          Effective and last updated: {LEGAL_EFFECTIVE_DATE}
        </p>

        <div className="space-y-4 text-sm leading-relaxed text-gray-700">
          <p>
            These guidelines explain how to keep yourself safe on We Glue — what
            blocking does, what reporting does, and what we do when something is
            reported to us.
          </p>

          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="mb-3 mt-8 text-base font-bold text-gray-900">
                {section.heading}
              </h2>
              {section.body.map((p) => (
                <p key={p} className="mb-3">
                  {p}
                </p>
              ))}
              {section.bullets && (
                <ul className="list-disc space-y-1 pl-5">
                  {section.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          <section>
            <h2 className="mb-3 mt-8 text-base font-bold text-gray-900">
              Contact
            </h2>
            <p>
              Questions about these guidelines, or about a decision we made, can
              go to{" "}
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
          <span className="px-2">·</span>
          <Link className="hover:text-[#0FA6A6]" href="/child-safety-standards">
            Child Safety
          </Link>
        </div>
      </div>
    </main>
  );
}
