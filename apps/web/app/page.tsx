import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "../lib/supabase/server";

export default async function WelcomePage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    const { data: interests } = await supabase
      .from("user_interests")
      .select("id")
      .eq("user_id", session.user.id)
      .limit(1);
    redirect(interests && interests.length > 0 ? "/home" : "/onboarding/interests");
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex flex-col items-center justify-between px-6 py-12">
      {/* Hero — logo + text */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4 pb-12">
        <div className="w-48 h-44 relative">
          <Image
            src="/icon.png"
            alt="We Glue logo"
            fill
            style={{ objectFit: "contain" }}
            priority
          />
        </div>
        <h1
          className="text-[50px] font-bold text-black leading-tight text-center"
          style={{ fontFamily: "var(--font-zain)" }}
        >
          We Glue
        </h1>
        <p
          className="text-[28px] text-black text-center"
          style={{ fontFamily: "var(--font-zain)" }}
        >
          Connection Starts with You
        </p>
      </div>

      {/* CTA buttons */}
      <div className="w-full max-w-sm flex flex-col items-center gap-4">
        <Link
          href="/onboarding/interests"
          className="w-full h-[52px] bg-[#0FA6A6] text-[#FEFCF0] font-semibold text-base rounded-[40px] flex items-center justify-center shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors"
        >
          Sign up
        </Link>
        <Link
          href="/auth/login"
          className="text-sm font-semibold text-black hover:text-[#0FA6A6] transition-colors"
        >
          Log in
        </Link>
      </div>
    </main>
  );
}
