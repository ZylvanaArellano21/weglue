export interface EmailValidationResult {
  valid: boolean;
  reason?: string;
}

// Email eligibility is intentionally open: any real, well-formed email address
// is accepted (Gmail, Outlook, Hotmail, school email — anything). We only reject
// input that is not a syntactically valid email so we never send a malformed
// address to the auth backend. The server-side gate mirrors this policy.
//
// NOTE: The name is kept for backwards compatibility with all existing call
// sites across the mobile and web apps; it no longer restricts to .edu domains.
export function validateEducationEmail(email: string): EmailValidationResult {
  const trimmed = email.trim().toLowerCase();

  if (!trimmed || !trimmed.includes("@")) {
    return { valid: false, reason: "Please enter a valid email address." };
  }

  const atIndex = trimmed.lastIndexOf("@");
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);

  // Require a non-empty local part and a domain that has at least one dot with
  // characters on both sides (e.g. "example.com"). This is a light sanity check,
  // not a strict RFC validation — the auth backend does the authoritative check.
  const domainLooksValid = /^[^\s@]+\.[^\s@]+$/.test(domain);

  if (!local || !domainLooksValid) {
    return { valid: false, reason: "Please enter a valid email address." };
  }

  return { valid: true };
}
