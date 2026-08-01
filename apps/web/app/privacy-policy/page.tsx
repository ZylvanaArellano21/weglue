import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPolicyPage(): JSX.Element | null {
  return (
    <main className="min-h-screen bg-[#FEFCF0] px-6 py-12 max-w-2xl mx-auto">
      <Link href="/" className="flex items-center gap-2 mb-8">
        <Image src="/logo.png" alt="We Glue" width={28} height={28} />
        <span className="font-bold text-base text-black" style={{ fontFamily: "var(--font-zain)" }}>
          We Glue
        </span>
      </Link>

      <h1 className="text-3xl font-bold text-black mb-2" style={{ fontFamily: "var(--font-zain)" }}>
        Privacy Policy
      </h1>

      <p className="text-xs text-[#5F5D5D] mb-8 italic">
        Last updated: June 24, 2026 — Full policy coming soon.
      </p>

      <div className="prose prose-sm text-[#333] space-y-6">
        <section>
          <h2 className="text-lg font-semibold text-black mb-2">Overview</h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            We Glue (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is committed to protecting your
            privacy. This Privacy Policy explains how we collect, use, and share
            information about you when you use our platform.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-black mb-2">
            Information We Collect
          </h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            We collect information you provide directly, such as your username,
            school email address, interests, and activity preferences. We also
            collect usage data to improve the platform.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-black mb-2">
            How We Use Your Information
          </h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            We use your information to match you with clubs and communities,
            personalise your experience, send important account notifications,
            and improve our services.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-black mb-2">
            Data Retention &amp; Security
          </h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            We retain your data as long as your account is active or as needed
            to provide services.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-black mb-2">
            Deleting Your Account
          </h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            You can permanently delete your We Glue account yourself, at any
            time, from inside We Glue. You never need to email us, call us or
            contact support to do it, and there is no waiting period — deletion
            is immediate and cannot be undone.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-[#5F5D5D] leading-relaxed list-disc pl-5">
            <li>
              On the web: <strong>Your Profile → Delete Account</strong>
            </li>
            <li>
              In the mobile app: <strong>Profile menu → Delete Account</strong>{" "}
              (also available in <strong>Account Center → Delete Account</strong>)
            </li>
          </ul>
          <p className="mt-3 text-sm text-[#5F5D5D] leading-relaxed">
            Deleting your account permanently removes your account record and
            your personal data, including your profile, username, email address,
            posts, photos, comments, likes, messages, club memberships, officer
            roles, RSVPs, saved events, interests, activities, followers and
            following, notifications, notification settings and registered
            devices, together with the files you uploaded.
          </p>
          <p className="mt-3 text-sm text-[#5F5D5D] leading-relaxed">
            Two things are deliberately not erased, and we want to be precise
            about them. Messages you sent in conversations that other people are
            still part of remain in those conversations so their history stays
            readable, but they are permanently disconnected from you and are no
            longer linked to your name, profile or account. Separately, where a
            safety or abuse report exists, we keep the minimum record needed to
            act on it, with your name and email address removed from it. Nothing
            else about you is kept.
          </p>
          <p className="mt-3 text-sm text-[#5F5D5D] leading-relaxed">
            If you have lost access to your account and cannot sign in, you can
            request deletion using our{" "}
            <a href="/delete-account" className="text-[#0FA6A6] hover:underline">
              account deletion request form
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-black mb-2">
            Blocking Another Student
          </h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            You can block another student at any time from their profile, from a
            direct conversation, from the report flow, or from{" "}
            <strong>Settings → Blocked Accounts</strong>.
          </p>
          <p className="mt-3 text-sm text-[#5F5D5D] leading-relaxed">
            When you block someone, we store exactly three pieces of
            information: <strong>your account ID</strong>, the{" "}
            <strong>blocked account&apos;s ID</strong>, and the{" "}
            <strong>date and time the block was created</strong>. We do not store
            a reason, and we do not ask you for one. We use this record only to
            keep the block working — for safety, abuse prevention, and app
            functionality.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-[#5F5D5D] leading-relaxed list-disc pl-5">
            <li>
              <strong>The other person is not told.</strong> We do not notify
              them, and we do not show them that a block exists.
            </li>
            <li>
              Block relationships are <strong>never publicly visible</strong>.
              There is no public count and no way for anyone to see who has
              blocked whom.
            </li>
            <li>
              <strong>Only you can see or manage your Blocked Accounts list</strong>,
              and only you can unblock someone you blocked.
            </li>
            <li>
              Blocking <strong>removes any existing follow relationship in both
              directions</strong>, which also ends a Gluemate connection.
            </li>
            <li>
              <strong>Unblocking does not restore</strong> those follows or your
              previous Gluemate connection.
            </li>
            <li>
              Blocking prevents direct discovery and direct communication between
              you. It does <strong>not</strong> remove official club or event
              information — if the person you blocked runs a club you are in, you
              will still see that club&apos;s posts, events and announcements.
            </li>
            <li>
              Active block records are <strong>deleted</strong> when either
              account is deleted.
            </li>
          </ul>
          <p className="mt-3 text-sm text-[#5F5D5D] leading-relaxed">
            Blocking introduces no advertising identifier, no access to your
            contacts, no precise location, and no third-party tracking.
          </p>
          <p className="mt-3 text-sm text-[#5F5D5D] leading-relaxed">
            One honest limitation: blocking controls what happens{" "}
            <strong>inside We Glue</strong>. Profile pictures and post images are
            served from public web addresses, so if someone already saved or
            shared such a link before you blocked them, we cannot make that copy
            unreachable. Blocking is not a guarantee of invisibility outside We
            Glue.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-black mb-2">
            Account Restrictions and Enforcement Records
          </h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            If an account breaks our Terms or Community Guidelines, We Glue may
            restrict its access — either temporarily (a suspension, which may
            have an end date) or until we lift it. We keep a record of that
            decision.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-[#5F5D5D] leading-relaxed list-disc pl-5">
            <li>
              An enforcement record contains the affected{" "}
              <strong>account ID</strong>, the <strong>type of restriction</strong>,{" "}
              <strong>timestamps</strong>, the <strong>administrator and audit
              identifiers</strong> for accountability, and an{" "}
              <strong>internal reason</strong> written by our team.
            </li>
            <li>
              The <strong>internal reason is never shown publicly</strong> and is
              never shown to the affected person. If you want to understand a
              decision, contact us.
            </li>
            <li>
              We use these records for <strong>safety, policy enforcement,
              security and compliance</strong> — not for advertising, and not to
              build a profile of you.
            </li>
            <li>
              <strong>A restriction does not delete your content.</strong> Your
              posts, messages, clubs, events and media stay as they are unless
              they are removed separately for breaking the rules.
            </li>
            <li>
              <strong>You can still delete your account while restricted.</strong>{" "}
              The in-app deletion option remains available, and the{" "}
              <a href="/delete-account" className="text-[#0FA6A6] hover:underline">
                deletion request form
              </a>{" "}
              remains available if you cannot sign in.
            </li>
            <li>
              A restriction is applied inside We Glue&apos;s own systems. We do{" "}
              <strong>not</strong> use our authentication provider&apos;s account-ban
              mechanism for it, which is precisely what keeps you able to sign in
              far enough to read this notice and to delete your account.
            </li>
          </ul>
          <p className="mt-3 text-sm text-[#5F5D5D] leading-relaxed">
            One thing we want to be precise about, because it is an exception to
            what we say above about deletion:{" "}
            <strong>
              enforcement and administrator audit records may be kept after an
              account is deleted
            </strong>
            , where we need them for security, abuse prevention and
            accountability. When that happens the record is reduced to identifiers
            and timestamps — it is no longer connected to a profile, a name or an
            email address, because those are gone. We would rather tell you this
            than promise that every trace disappears when it does not.
          </p>
          <p className="mt-3 text-sm text-[#5F5D5D] leading-relaxed">
            We keep such a record only for as long as it is reasonably needed for
            safety, fraud prevention, legal compliance, handling a dispute, or
            accountability — not indefinitely as a matter of course, and we do not
            claim every one of them is required by law.
          </p>
          <p className="mt-3 text-sm text-[#5F5D5D] leading-relaxed">
            What a retained record never contains:{" "}
            <strong>
              passwords, multi-factor authentication codes, access tokens, private
              administrative access details, or the contents of private messages
            </strong>
            . Enforcement records hold identifiers, timestamps, the category of
            action, and our internal note about it.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-black mb-2">
            Children&apos;s Privacy (COPPA)
          </h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            We Glue is not intended for children under 13 years of age. We do
            not knowingly collect personal information from children under 13.
            If you believe we have inadvertently collected such information,
            please contact us immediately.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-black mb-2">Contact Us</h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            If you have questions about this Privacy Policy, please contact us
            at{" "}
            <a
              href="mailto:privacy@weglue.app"
              className="text-[#0FA6A6] hover:underline"
            >
              privacy@weglue.app
            </a>
            .
          </p>
        </section>

        <p className="text-xs text-[#5F5D5D] border-t border-black/10 pt-6">
          This is a placeholder privacy policy. A comprehensive policy
          compliant with GDPR, CCPA, and applicable laws will be published
          before the public launch of We Glue.
        </p>
      </div>

      <div className="mt-10 flex gap-4 text-xs">
        <Link href="/" className="text-[#0FA6A6] hover:underline">
          ← Back to Home
        </Link>
        <Link href="/terms-of-service" className="text-[#5F5D5D] hover:text-[#0FA6A6]">
          Terms of Service →
        </Link>
      </div>
    </main>
  );
}
