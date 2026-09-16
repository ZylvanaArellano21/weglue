// Domain suffixes that identify educational institutions worldwide.
// These are BLOCKED — We Glue now requires a personal/general email, not a
// school-issued one.
const EDUCATIONAL_SUFFIXES = [
  // United States
  ".edu",
  // United Kingdom, New Zealand, India, Japan, South Africa, Indonesia,
  // Thailand, South Korea, Israel, Iran, UAE, Tanzania, Uganda, Rwanda,
  // Zambia, Malawi, Zimbabwe, Kenya
  ".ac.uk",
  ".ac.nz",
  ".ac.in",
  ".ac.jp",
  ".ac.za",
  ".ac.id",
  ".ac.th",
  ".ac.kr",
  ".ac.il",
  ".ac.ir",
  ".ac.ae",
  ".ac.tz",
  ".ac.ug",
  ".ac.rw",
  ".ac.zm",
  ".ac.mw",
  ".ac.zw",
  ".ac.ke",
  // Latin America
  ".edu.mx",
  ".edu.co",
  ".edu.ar",
  ".edu.pe",
  ".edu.ec",
  ".edu.bo",
  ".edu.ve",
  ".edu.uy",
  ".edu.py",
  ".edu.gt",
  ".edu.cu",
  ".edu.do",
  ".edu.hn",
  ".edu.sv",
  ".edu.ni",
  ".edu.cr",
  ".edu.pa",
  ".edu.br",
  ".edu.cl",
  // Asia-Pacific
  ".edu.au",
  ".edu.cn",
  ".edu.sg",
  ".edu.hk",
  ".edu.ph",
  ".edu.my",
  ".edu.pk",
  ".edu.vn",
  ".edu.kh",
  ".edu.mm",
  ".edu.bd",
  ".edu.np",
  ".edu.lk",
  // Middle East & Africa
  ".edu.eg",
  ".edu.ng",
  ".edu.gh",
  ".edu.ke",
  ".edu.et",
  ".edu.ly",
  ".edu.tn",
  ".edu.ma",
  ".edu.dz",
  ".edu.sd",
  // Europe
  ".edu.tr",
  ".edu.rs",
  ".edu.ba",
  ".edu.mk",
  ".edu.al",
];

export const EDU_EMAIL_BLOCKED_MESSAGE =
  "Please use another email. Do not use your university or college email.";

export interface EmailValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateEducationEmail(email: string): EmailValidationResult {
  const trimmed = email.trim().toLowerCase();

  if (!trimmed || !trimmed.includes("@")) {
    return { valid: false, reason: "Please enter a valid email address." };
  }

  const atIndex = trimmed.lastIndexOf("@");
  const domain = trimmed.slice(atIndex + 1);

  if (!domain || !domain.includes(".")) {
    return { valid: false, reason: "Please enter a valid email address." };
  }

  const isBlocked = EDUCATIONAL_SUFFIXES.some((suffix) =>
    domain.endsWith(suffix)
  );

  if (isBlocked) {
    return { valid: false, reason: EDU_EMAIL_BLOCKED_MESSAGE };
  }

  return { valid: true };
}

// ─── Per-campus email eligibility ────────────────────────────────────────────
//
// We Glue runs one app across several campuses, and their email rules are
// deliberately OPPOSITE: Lone Star requires a personal address and blocks
// school-issued ones (the rule above, unchanged since launch), while Texas A&M
// accepts its own domain and nothing else.
//
// So the rule cannot live in the clients. It is data on the campus row
// (`universities.email_mode` / `email_domains` / `email_denied_message`),
// delivered to the clients by the `list_active_campuses()` RPC, and enforced
// server-side by `campus_email_allowed()`. What follows is the SAME policy
// evaluated locally, only so the user gets an answer as they type — it is never
// the security boundary.

export type CampusEmailMode = "block_educational" | "allowlist";

/** A selectable campus, exactly as `list_active_campuses()` returns it. */
export interface Campus {
  slug: string;
  name: string;
  emailMode: CampusEmailMode;
  /** Accepted domains for `allowlist` mode, matched EXACTLY (no subdomains). */
  emailDomains: string[] | null;
  /** Campus-specific rejection copy; null falls back to the shared message. */
  emailDeniedMessage: string | null;
}

/** Lowercased domain after the last `@`, or null when the address is malformed. */
export function emailDomainOf(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return null;
  const domain = trimmed.slice(trimmed.lastIndexOf("@") + 1);
  if (!domain || !domain.includes(".")) return null;
  return domain;
}

/**
 * Whether this address may be used on this campus.
 *
 * `block_educational` delegates to {@link validateEducationEmail} rather than
 * re-implementing it, so the shipped Lone Star behaviour and its message are
 * identical by construction.
 */
export function validateCampusEmail(
  campus: Campus | null | undefined,
  email: string
): EmailValidationResult {
  if (!campus) {
    return { valid: false, reason: "Choose your university to continue." };
  }

  if (campus.emailMode === "block_educational") {
    return validateEducationEmail(email);
  }

  const domain = emailDomainOf(email);
  if (!domain) {
    return { valid: false, reason: "Please enter a valid email address." };
  }

  const allowed = (campus.emailDomains ?? []).map((d) =>
    d.trim().toLowerCase()
  );
  if (allowed.includes(domain)) return { valid: true };

  return {
    valid: false,
    reason: campus.emailDeniedMessage ?? campusDomainHint(allowed),
  };
}

/** A row exactly as `list_active_campuses()` returns it over PostgREST. */
export interface CampusRow {
  slug: string | null;
  name: string | null;
  email_mode: string | null;
  email_domains: string[] | null;
  email_denied_message: string | null;
}

/**
 * Maps one RPC row to a {@link Campus}. Both platforms call the RPC with their
 * own Supabase client but share this mapping, so the wire shape is understood
 * in exactly one place. Rows missing a slug, a name or a known mode are dropped
 * rather than half-trusted — an unrecognised mode must never fall through to
 * "allowed".
 */
export function toCampuses(rows: CampusRow[] | null | undefined): Campus[] {
  return (rows ?? []).flatMap((row) => {
    const slug = row.slug?.trim();
    const name = row.name?.trim();
    const mode = row.email_mode?.trim();
    if (!slug || !name) return [];
    if (mode !== "block_educational" && mode !== "allowlist") return [];
    return [
      {
        slug,
        name,
        emailMode: mode,
        emailDomains: row.email_domains ?? null,
        emailDeniedMessage: row.email_denied_message?.trim() || null,
      },
    ];
  });
}

/** Last-resort copy when a campus row carries no message of its own. */
function campusDomainHint(allowed: string[]): string {
  if (allowed.length === 0) return "Please enter a valid email address.";
  const domains = allowed.map((d) => `@${d}`).join(" or ");
  return `Use your ${domains} email address to join this campus.`;
}
