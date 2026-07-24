const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.es",
  "hotmail.fr",
  "live.com",
  "live.co.uk",
  "live.ca",
  "live.com.au",
  "live.com.mx",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.es",
  "yahoo.fr",
  "yahoo.com.mx",
  "yahoo.com.ar",
  "yahoo.com.br",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "msn.com",
  "mail.com",
  "inbox.com",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "web.de",
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
  "earthlink.net",
  "tutanota.com",
  "tuta.io",
  "fastmail.com",
  "fastmail.fm",
  "runbox.com",
  "mailbox.org",
  "hushmail.com",
  "disroot.org",
]);

// Domain suffixes that identify educational institutions worldwide
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

  if (CONSUMER_DOMAINS.has(domain)) {
    return {
      valid: false,
      reason:
        "Only university or college email addresses (.edu) are accepted. Please use your school email.",
    };
  }

  const isEducational = EDUCATIONAL_SUFFIXES.some((suffix) =>
    domain.endsWith(suffix)
  );

  if (!isEducational) {
    return {
      valid: false,
      reason:
        "Only university or college email addresses (.edu) are accepted. Please use your school email.",
    };
  }

  return { valid: true };
}
