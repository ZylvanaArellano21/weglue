import { describe, expect, it } from "vitest";
import {
  type Campus,
  toCampuses,
  validateCampusEmail,
  validateEducationEmail,
} from "@weglue/shared";
import { isStrongPassword } from "../accountCenter";
import { SUPPORT_EMAIL, SUPPORT_SUBJECT, supportMailtoUrl } from "../support";

// These are the rules the mobile app enforces (apps/mobile/services/
// accountService.ts + lib/support.ts, both of which now call the same shared
// validateEducationEmail()). Web MUST accept and reject exactly the same
// inputs, or a student is told different things on different platforms about
// the same account.
//
// The typed-DELETE gate is deliberately NOT covered here: on web it lives
// inside components/account/DeleteAccountClient.tsx, which owns its own copy of
// the constant. Duplicating that constant in lib/ just to have something to
// assert against would have shipped a module nothing imports.

describe("validateEducationEmail (blocks .edu, allows personal email)", () => {
  it("blocks every school/academic suffix the app used to require", () => {
    for (const email of [
      "zarellanocampos@my.lonestar.edu",
      "someone@uni.edu.au",
      "someone@dept.ac.uk",
      "someone@college.ac.in",
      "someone@school.edu.sg",
    ]) {
      expect(validateEducationEmail(email).valid).toBe(false);
    }
  });

  it("is case- and whitespace-insensitive when blocking .edu", () => {
    expect(validateEducationEmail("  Student@My.LoneStar.EDU  ").valid).toBe(
      false
    );
  });

  it("allows ordinary personal email providers", () => {
    for (const email of [
      "someone@gmail.com",
      "someone@outlook.com",
      "someone@hotmail.com",
      "someone@yahoo.com",
      "someone@edu.com",
      "someone@example.education",
      "edu@example.org",
    ]) {
      expect(validateEducationEmail(email).valid).toBe(true);
    }
  });
});

// ─── Per-campus rules ────────────────────────────────────────────────────────
// The two launch campuses have deliberately OPPOSITE email rules. Lone Star
// requires a personal address and blocks school-issued ones; Texas A&M accepts
// only its own domain. These assertions mirror the database's
// campus_email_allowed() so a divergence between client and server shows up
// here rather than in front of a student.

const LONE_STAR: Campus = {
  slug: "lone-star-college-montgomery",
  name: "Lone Star College – Montgomery",
  emailMode: "block_educational",
  emailDomains: null,
  emailDeniedMessage: null,
};

const TAMU: Campus = {
  slug: "texas-am-college-station",
  name: "Texas A&M University – College Station",
  emailMode: "allowlist",
  emailDomains: ["tamu.edu"],
  emailDeniedMessage:
    "Use your Texas A&M email address (@tamu.edu) to join this campus.",
};

describe("validateCampusEmail — Lone Star keeps the shipped rule", () => {
  it("is identical to validateEducationEmail for every sample", () => {
    for (const email of [
      "someone@gmail.com",
      "someone@outlook.com",
      "zarellanocampos@my.lonestar.edu",
      "aggie@tamu.edu",
      "someone@dept.ac.uk",
      "someone@uni.edu.au",
      "edu@example.org",
    ]) {
      expect(validateCampusEmail(LONE_STAR, email).valid).toBe(
        validateEducationEmail(email).valid
      );
    }
  });

  it("still shows the original blocked-email message", () => {
    expect(validateCampusEmail(LONE_STAR, "a@my.lonestar.edu").reason).toBe(
      "Please use another email. Do not use your university or college email."
    );
  });
});

describe("validateCampusEmail — Texas A&M accepts only @tamu.edu", () => {
  it("accepts the approved domain, case- and whitespace-insensitively", () => {
    for (const email of ["aggie@tamu.edu", "  Aggie@TAMU.EDU  "]) {
      expect(validateCampusEmail(TAMU, email).valid).toBe(true);
    }
  });

  it("rejects subdomains, sibling campuses and look-alike domains", () => {
    for (const email of [
      "aggie@email.tamu.edu",
      "aggie@exchange.tamu.edu",
      "aggie@tamug.edu",
      "aggie@tamuc.edu",
      "aggie@nottamu.edu",
      "aggie@tamu.edu.attacker.com",
    ]) {
      expect(validateCampusEmail(TAMU, email).valid).toBe(false);
    }
  });

  it("rejects personal and other-university addresses", () => {
    for (const email of ["a@gmail.com", "a@outlook.com", "a@uh.edu"]) {
      expect(validateCampusEmail(TAMU, email).valid).toBe(false);
    }
  });

  it("uses the campus's own message, not the Lone Star one", () => {
    expect(validateCampusEmail(TAMU, "a@gmail.com").reason).toBe(
      TAMU.emailDeniedMessage
    );
  });
});

describe("validateCampusEmail fails closed", () => {
  it("refuses when no campus has been chosen", () => {
    expect(validateCampusEmail(null, "a@gmail.com").valid).toBe(false);
  });

  it("refuses malformed addresses on either campus", () => {
    for (const campus of [LONE_STAR, TAMU]) {
      for (const email of ["", "noatsign", "a@", "a@b"]) {
        expect(validateCampusEmail(campus, email).valid).toBe(false);
      }
    }
  });
});

describe("toCampuses drops rows it cannot trust", () => {
  it("keeps a well-formed row and maps it to camelCase", () => {
    expect(
      toCampuses([
        {
          slug: "texas-am-college-station",
          name: "Texas A&M University – College Station",
          email_mode: "allowlist",
          email_domains: ["tamu.edu"],
          email_denied_message: "msg",
        },
      ])
    ).toEqual([
      {
        slug: "texas-am-college-station",
        name: "Texas A&M University – College Station",
        emailMode: "allowlist",
        emailDomains: ["tamu.edu"],
        emailDeniedMessage: "msg",
      },
    ]);
  });

  it("drops rows with an unrecognised mode rather than trusting them", () => {
    expect(
      toCampuses([
        {
          slug: "x",
          name: "X",
          email_mode: "something_new",
          email_domains: null,
          email_denied_message: null,
        },
      ])
    ).toEqual([]);
  });

  it("drops rows missing a slug or a name, and tolerates null input", () => {
    expect(
      toCampuses([
        {
          slug: null,
          name: "X",
          email_mode: "allowlist",
          email_domains: ["x.com"],
          email_denied_message: null,
        },
      ])
    ).toEqual([]);
    expect(toCampuses(null)).toEqual([]);
  });
});

describe("isStrongPassword", () => {
  // Synthetic values only — never a credential that belongs to a real account,
  // test or otherwise, so this file stays safe to read in a public diff.
  it("requires 8+ characters, an uppercase letter and a number", () => {
    expect(isStrongPassword("Password1")).toBe(true);
    expect(isStrongPassword("Abcdefg9")).toBe(true);
    expect(isStrongPassword("Xx1!aaaaaa")).toBe(true);
  });

  it("rejects passwords missing any single requirement", () => {
    expect(isStrongPassword("Pass1")).toBe(false); // too short
    expect(isStrongPassword("password1")).toBe(false); // no uppercase
    expect(isStrongPassword("Password")).toBe(false); // no number
    expect(isStrongPassword("")).toBe(false);
  });
});

describe("support mailto", () => {
  it("addresses the same inbox and subject as the mobile Help item", () => {
    expect(SUPPORT_EMAIL).toBe("zylvana.arellano.campos@gmail.com");
    expect(SUPPORT_SUBJECT).toBe("We Glue Support");
  });

  it("builds a mailto URL with an encoded subject", () => {
    expect(supportMailtoUrl()).toBe(
      `mailto:${SUPPORT_EMAIL}?subject=We%20Glue%20Support`
    );
  });
});
