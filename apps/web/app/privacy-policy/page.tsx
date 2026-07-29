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
