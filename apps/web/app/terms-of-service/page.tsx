import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "Terms of Service",
};

export default function TermsOfServicePage() {
  return (
    <main className="min-h-screen bg-[#FEFCF0] px-6 py-12 max-w-2xl mx-auto">
      <Link href="/" className="flex items-center gap-2 mb-8">
        <Image src="/logo.png" alt="We Glue" width={28} height={28} />
        <span className="font-bold text-base text-black" style={{ fontFamily: "var(--font-zain)" }}>
          We Glue
        </span>
      </Link>

      <h1 className="text-3xl font-bold text-black mb-2" style={{ fontFamily: "var(--font-zain)" }}>
        Terms of Service
      </h1>

      <p className="text-xs text-[#5F5D5D] mb-8 italic">
        Last updated: June 24, 2026 — Full terms coming soon.
      </p>

      <div className="space-y-6">
        <section>
          <h2 className="text-lg font-semibold text-black mb-2">
            Acceptance of Terms
          </h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            By accessing or using We Glue, you agree to be bound by these Terms
            of Service. If you do not agree to these terms, please do not use
            our platform.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-black mb-2">
            Eligibility
          </h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            You must be at least 13 years of age to use We Glue. By creating an
            account, you confirm that you meet this age requirement. We Glue is
            designed for college and university students and requires a valid
            .edu email address for registration.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-black mb-2">
            Your Account
          </h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            You are responsible for maintaining the confidentiality of your
            account credentials and for all activities that occur under your
            account. You agree to notify us immediately of any unauthorised use
            of your account.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-black mb-2">
            Acceptable Use
          </h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            You agree not to use We Glue for any unlawful purpose or in any way
            that could harm other users. You agree to respect community
            guidelines, which will be published prior to the public launch.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-black mb-2">
            Intellectual Property
          </h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            All content and materials available on We Glue, except content
            contributed by users, are the property of We Glue and are protected
            by applicable intellectual property laws.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-black mb-2">
            Limitation of Liability
          </h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            We Glue is provided &quot;as is&quot; without warranties of any kind. We
            shall not be liable for any indirect, incidental, or consequential
            damages arising from your use of the platform.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-black mb-2">Contact Us</h2>
          <p className="text-sm text-[#5F5D5D] leading-relaxed">
            If you have questions about these Terms, please contact us at{" "}
            <a
              href="mailto:legal@weglue.app"
              className="text-[#0FA6A6] hover:underline"
            >
              legal@weglue.app
            </a>
            .
          </p>
        </section>

        <p className="text-xs text-[#5F5D5D] border-t border-black/10 pt-6">
          This is a placeholder Terms of Service. Comprehensive terms compliant
          with applicable laws will be published before the public launch of We
          Glue.
        </p>
      </div>

      <div className="mt-10 flex gap-4 text-xs">
        <Link href="/" className="text-[#0FA6A6] hover:underline">
          ← Back to Home
        </Link>
        <Link href="/privacy-policy" className="text-[#5F5D5D] hover:text-[#0FA6A6]">
          Privacy Policy →
        </Link>
      </div>
    </main>
  );
}
