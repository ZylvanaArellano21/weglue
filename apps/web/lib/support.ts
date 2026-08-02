// Help / Support — web mirror of apps/mobile/lib/support.ts.
//
// The address and the subject line are the SAME ones the mobile Help item uses,
// so a student who emails from either platform reaches the same inbox with the
// same subject. There is no second web-only support address.

export const SUPPORT_EMAIL = "zylvana.arellano.campos@gmail.com";

export const SUPPORT_SUBJECT = "We Glue Support";

/** `mailto:` URL for the user's default mail client (Gmail, Outlook, Mail…). */
export function supportMailtoUrl(): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(SUPPORT_SUBJECT)}`;
}
