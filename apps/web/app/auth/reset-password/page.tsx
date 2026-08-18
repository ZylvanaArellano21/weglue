import type { Metadata } from "next";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import ResetPasswordClient from "./ResetPasswordClient";

export const metadata: Metadata = {
  title: "Reset Password — We Glue",
};

interface PageProps {
  searchParams: { token_hash?: string; type?: string; code?: string };
}

// The reset-password link mails a token in one of three shapes depending on
// how GoTrue's hosted /verify redirect resolves it: a PKCE `code`, a
// `token_hash` (+ `type`), or — only when neither query param is present —
// tokens in the URL fragment, which the server can never read (handled by
// ResetPasswordClient). This mirrors exactly what /auth/confirm/page.tsx
// already does successfully for signup verification; reset-password
// previously only had client-side fragment/token_hash handling and NEVER
// handled `code` at all, so a PKCE link failed every single time before a
// human ever saw whether the token itself was valid.
export default async function ResetPasswordPage({
  searchParams,
}: PageProps): Promise<JSX.Element> {
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

  // True only when this request itself established a recovery session
  // (a fresh cookie was just set). ResetPasswordClient still confirms via
  // getSession() client-side before showing the form — this only tells it
  // whether to also try the legacy fragment path.
  let serverExchanged = false;

  try {
    if (token_hash && type) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash,
        type: type as "recovery" | "email",
      });
      if (!error) serverExchanged = true;
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) serverExchanged = true;
    }
  } catch {}

  return <ResetPasswordClient serverExchanged={serverExchanged} />;
}
