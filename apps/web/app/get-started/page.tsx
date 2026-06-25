import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Get Started",
};

export default function GetStartedPage() {
  return (
    <main className="min-h-screen bg-[#FEFCF0] flex flex-col items-center justify-center px-6 gap-6">
      {/* Logo */}
      <div className="mb-4">
        <Image src="/logo.png" alt="We Glue" width={80} height={80} priority />
      </div>

      {/* CTA buttons */}
      <div className="w-full max-w-xs flex flex-col gap-4">
        <a
          href="https://weglue.app/download"
          className="w-full h-[56px] bg-[#0FA6A6] text-white font-semibold text-base rounded-[40px] flex items-center justify-center shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors"
        >
          Download the app
        </a>

        <Link
          href="/onboarding/interests"
          className="w-full h-[56px] bg-white border border-black/10 rounded-[40px] flex items-center justify-center text-[#0FA6A6] font-semibold text-base shadow-sm hover:bg-gray-50 transition-colors"
        >
          Continue on the web
        </Link>
      </div>

      {/* Back to home */}
      <Link
        href="/"
        className="text-xs text-[#5F5D5D] hover:text-[#0FA6A6] transition-colors"
      >
        Go back to{" "}
        <span className="text-[#0FA6A6] underline">Home page</span>
      </Link>
    </main>
  );
}
