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
