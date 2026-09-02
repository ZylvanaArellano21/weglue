import type { Metadata } from "next";
import ResetPasswordClient from "./ResetPasswordClient";

export const metadata: Metadata = {
  title: "Reset Password — We Glue",
};

interface PageProps {
  searchParams: { token_hash?: string; type?: string; code?: string };
}

// The one-time recovery token is NEVER consumed here, and never on page load.
//
// A GET to this URL is not always a human — corporate mail scanners,
// link-preview crawlers, the mail client's own prefetch, and (with click
// tracking) the email provider's redirector all fetch the link first. Any of
// them consuming the token is why a freshly issued link showed "expired" on a
// link nobody had used.
//
// The server component only forwards the params. ResetPasswordClient shows the
// "create a new password" form and consumes the token exactly once — only when
// the person deliberately submits their new password.
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
