import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import Image from "next/image";
import FragmentConfirm from "./FragmentConfirm";

interface PageProps {
  searchParams: { token_hash?: string; type?: string; code?: string };
}

export default async function AuthConfirmPage({ searchParams }: PageProps) {
  const { token_hash, type, code } = searchParams;

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );

  let success = false;

  try {
    if (token_hash && type) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash,
        type: type as "signup" | "email",
      });
      if (!error) success = true;
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) success = true;
    }
  } catch {}

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Zain:wght@700&display=swap');
        .font-zain { font-family: 'Zain', serif; }
      `}</style>

      {/*
        Default-mailer confirmation flow: tokens arrive in the URL fragment
        which the server cannot read. This client component reads them in the
        browser and overlays the success screen. Renders null when absent.
      */}
      <FragmentConfirm />

      <main className="min-h-screen bg-[#FEFCF0] flex items-center justify-center px-6">
        <div className="max-w-[400px] mx-auto text-center">
          <Image
            src="/logo.png"
            alt="We Glue"
            width={100}
            height={90}
            className="mb-6 mx-auto"
            priority
          />

          {success ? (
            <>
              <h1 className="font-zain text-3xl font-bold text-gray-900 mb-2">
                Your email has been confirmed
              </h1>
              <p className="text-sm text-gray-400 mb-8">
                Connection starts with you
              </p>

              <div className="w-20 h-20 rounded-full border-2 border-[#0FA6A6] flex items-center justify-center mx-auto mb-8">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#0FA6A6"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>

              <p className="text-sm text-gray-600 leading-relaxed">
                You can go back to We Glue now and click the{" "}
                <span className="text-[#0FA6A6] font-semibold">&ldquo;Next&rdquo;</span>{" "}
                button.
              </p>
            </>
          ) : (
            <>
              <div className="w-20 h-20 rounded-full border-2 border-[#F02719] bg-red-50 flex items-center justify-center mx-auto mb-6">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#F02719"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>

              <h1 className="font-zain text-3xl font-bold text-gray-900 mb-2">
                Confirmation link expired
              </h1>
              <p className="text-sm text-gray-400 mb-6">
                Please request a new confirmation email
              </p>

              <p className="text-sm text-gray-600 leading-relaxed">
                Return to We Glue and tap{" "}
                <span className="font-semibold">&ldquo;Resend email&rdquo;</span>{" "}
                to get a new link.
              </p>
            </>
          )}
        </div>
      </main>
    </>
  );
}
