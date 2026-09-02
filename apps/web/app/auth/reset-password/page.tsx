import type { Metadata } from "next";
import ResetPasswordClient from "./ResetPasswordClient";

export const metadata: Metadata = {
  title: "Reset Password — We Glue",
};

interface PageProps {
  searchParams: { token_hash?: string; type?: string; code?: string };
}

// A recovery link must be verified in the PERSON'S OWN BROWSER, on their real
// visit — never here in the server component.
//
// This page used to call verifyOtp() / exchangeCodeForSession() on every GET.
// A recovery token is single-use, and a GET to this URL is not always a human:
// corporate mail scanners, link-preview crawlers and the mail client's own
// prefetch all fetch the link first. That server-side fetch burned the token,
// so by the time the person tapped it GoTrue reported "expired" — a freshly
// issued link that had never been used by anyone.
//
// The server now only forwards the params. ResetPasswordClient consumes them
// exactly once, client-side, where a scanner's plain GET (which runs no JS)
// can never reach them.
export default function ResetPasswordPage({
  searchParams,
}: PageProps): JSX.Element {
  const { token_hash, type, code } = searchParams;
  return (
    <ResetPasswordClient
      tokenHash={token_hash ?? null}
      linkType={type ?? null}
      code={code ?? null}
    />
  );
}
