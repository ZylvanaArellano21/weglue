import { describe, expect, it } from "vitest";
import { validateEducationEmail } from "@weglue/shared";
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
