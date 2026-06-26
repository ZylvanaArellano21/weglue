import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import Image from "next/image";

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

  let sessionTokens: { access_token: string; refresh_token: string } | null =
    null;
  let errorMessage = "";

  try {
    if (token_hash && type) {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash,
        type: type as "signup" | "email",
      });
      if (error) throw error;
      if (data.session) {
        sessionTokens = {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        };
      }
    } else if (code) {
      const { data, error } =
        await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      if (data.session) {
        sessionTokens = {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        };
      }
    } else {
      errorMessage = "No valid auth token found in the confirmation URL.";
    }
  } catch (err) {
    errorMessage =
      err instanceof Error ? err.message : "Email verification failed.";
  }

  const deepLinkUrl = sessionTokens
    ? `weglue://auth/confirmed#access_token=${encodeURIComponent(
        sessionTokens.access_token
      )}&refresh_token=${encodeURIComponent(sessionTokens.refresh_token)}`
    : null;

  const success = !!deepLinkUrl;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Zain:wght@700&display=swap');
        .font-zain { font-family: 'Zain', serif; }
      `}</style>

      {/* Auto-redirect to app deep link on success */}
      {deepLinkUrl && (
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var deepLink = ${JSON.stringify(deepLinkUrl)};
                window.location.replace(deepLink);
                setTimeout(function() {
                  var el = document.getElementById('fallback-msg');
                  if (el) el.style.display = 'block';
                }, 2000);
              })();
            `,
          }}
        />
      )}

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

              <a
                href={deepLinkUrl}
                className="w-full rounded-full font-semibold text-white text-base py-4 mb-4 transition-opacity hover:opacity-90 text-center block"
                style={{
                  backgroundColor: "#0FA6A6",
                  maxWidth: 320,
                  lineHeight: "1.5rem",
                  paddingTop: "1rem",
                  paddingBottom: "1rem",
                  textDecoration: "none",
                }}
              >
                Go back to We Glue
              </a>

              <p
                id="fallback-msg"
                className="text-xs mt-2 text-center"
                style={{ color: "#5F5D5D", display: "none" }}
              >
                Open the We Glue app on your phone to continue.
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
              <p className="text-sm mb-10" style={{ color: "#5F5D5D" }}>
                Please request a new confirmation email
              </p>

              <a
                href="weglue://signup"
                className="w-full rounded-full font-semibold text-white text-base py-4 transition-opacity hover:opacity-90 text-center block"
                style={{
                  backgroundColor: "#0FA6A6",
                  maxWidth: 320,
                  lineHeight: "1.5rem",
                  paddingTop: "1rem",
                  paddingBottom: "1rem",
                  textDecoration: "none",
                }}
              >
                Back to sign up
              </a>
            </>
          )}
        </div>
      </main>
    </>
  );
}
