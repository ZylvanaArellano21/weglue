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

      <main
        style={{ backgroundColor: "#FEFCF0" }}
        className="min-h-screen flex items-center justify-center px-4"
      >
        <div className="w-full max-w-sm flex flex-col items-center text-center">
          <Image
            src="/logo.png"
            alt="We Glue"
            width={100}
            height={90}
            className="mb-6"
            priority
          />

          {success ? (
            <>
              <h1
                className="font-zain text-3xl font-bold mb-2"
                style={{ color: "#1a1a1a" }}
              >
                Your email has been confirmed
              </h1>
              <p className="text-sm mb-10" style={{ color: "#5F5D5D" }}>
                Connection starts with you
              </p>

              <div
                className="flex items-center justify-center mb-10"
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  border: "3px solid #0FA6A6",
                }}
              >
                <svg
                  width="32"
                  height="32"
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

              <p
                className="text-sm leading-relaxed max-w-[260px]"
                style={{ color: "#5F5D5D" }}
              >
                You can go back to We Glue now and click the{" "}
                <span style={{ color: "#0FA6A6", fontWeight: 600 }}>Next</span>{" "}
                button.
              </p>
            </>
          ) : (
            <>
              <div
                className="flex items-center justify-center mb-6"
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  border: "3px solid #F02719",
                  backgroundColor: "rgba(240,39,25,0.08)",
                }}
              >
                <svg
                  width="32"
                  height="32"
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

              <h1
                className="font-zain text-3xl font-bold mb-2"
                style={{ color: "#1a1a1a" }}
              >
                Confirmation link expired
              </h1>
              <p className="text-sm mb-6" style={{ color: "#5F5D5D" }}>
                Please request a new confirmation email
              </p>

              <p
                className="text-sm leading-relaxed max-w-[260px]"
                style={{ color: "#5F5D5D" }}
              >
                Return to We Glue and tap{" "}
                <span style={{ fontWeight: 600 }}>&ldquo;Resend email&rdquo;</span>{" "}
                to get a new link.
              </p>
            </>
          )}
        </div>
      </main>
    </>
  );
}
