import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Get Started",
};

export default function GetStartedPage(): JSX.Element | null {
  return (
    <main className="min-h-screen bg-[#FEFCF0] flex flex-col items-center px-6">
      {/* Logo */}
      <div className="mt-[18vh] mb-[12vh]">
        <Image src="/logo.png" alt="We Glue" width={110} height={100} priority />
      </div>

      {/* CTA buttons */}
      <div className="w-full max-w-[332px] flex flex-col gap-[46px]">
        {/* Deliberately inert: there is no app-store destination yet, and this
            must never trigger a navigation or form side effect. */}
        <button
          type="button"
          className="w-full h-[86px] bg-[#0FA6A6] text-white font-semibold text-[20px] rounded-full flex items-center justify-center shadow-[0px_4px_6px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0FA6A6]"
        >
          Download the app
        </button>

        <Link
          href="/onboarding/interests"
          className="w-full h-[75px] bg-[#FFFEF7] rounded-full flex items-center justify-center text-[#0FA6A6] font-semibold text-[20px] shadow-[0px_4px_6px_rgba(0,0,0,0.2)] hover:bg-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0FA6A6]"
        >
          Continue on the web
        </Link>
      </div>

      {/* Footer links */}
      <p className="mt-[8.5vh] text-[14px] font-semibold text-black">
        Go back to{" "}
        <Link
          href="/"
          className="text-[#0FA6A6] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0FA6A6]"
        >
          Home page
        </Link>
      </p>

      <p className="mt-7 text-[14px] font-semibold text-black">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-[#0FA6A6] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0FA6A6]"
        >
          Log in
        </Link>
      </p>
    </main>
  );
}
