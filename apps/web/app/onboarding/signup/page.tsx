"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { validateEducationEmail } from "@weglue/shared";
import { createClient } from "../../../lib/supabase/client";
import {
  checkPassword,
  checkSignupStatus,
  confirmEmailRedirect,
  friendlyEmailSendError,
  passwordError,
  replacePendingSignup,
  setPendingSignupEmail,
} from "../../../lib/authFlow";
import {
  getTransientPassword,
  readOnboardingState,
  resetOnboardingState,
  setTransientPassword,
  writeOnboardingState,
} from "../../../lib/onboardingState";
import { recordSignupConsent } from "../../actions/auth";

const inputClass = (invalid: boolean, valid?: boolean) =>
  `w-full bg-[#FEFCF0] border rounded-[10px] h-[53px] px-4 text-sm font-semibold text-black placeholder:text-black/30 outline-none focus:border-[#0FA6A6] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] transition-colors ${
    invalid ? "border-[#F02719]" : valid ? "border-[#0FA6A6]" : "border-black/20"
  }`;

export default function SignupPage(): JSX.Element | null {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isOfAge, setIsOfAge] = useState(false);
  const [matchCount, setMatchCount] = useState(2);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [emailExistsVerified, setEmailExistsVerified] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState<{
    valid: boolean;
    reason?: string;
  } | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  // Restore flow state (survey selections, match count, form fields,
  // checkboxes) after refresh, Back navigation, or the Terms round-trip.
  useEffect(() => {
    const state = readOnboardingState();
    setUsername(state.pendingUsername);
    setEmail(state.pendingEmail);
    setAgreedToTerms(state.agreedToTerms);
    setIsOfAge(state.isOfAge);
    // In-memory only — survives the Terms round-trip, never a full reload.
    setPassword(getTransientPassword());
    // The heading may never claim fewer than two matches; the server tops the
    // real batch up to at least two whenever eligible clubs exist.
    setMatchCount(Math.max(state.matchCount, 2));
    if (state.pendingEmail && state.pendingEmail.includes("@")) {
      const result = validateEducationEmail(state.pendingEmail);
      setEmailFeedback({ valid: result.valid, reason: result.reason });
    }
  }, []);

  function requireLegalConfirmations(): boolean {
    const errs: Record<string, string> = {};
    if (!agreedToTerms) errs.terms = "You must agree to the Terms and Conditions.";
    if (!isOfAge) errs.age = "You must confirm you are 13 years of age or older.";
    if (Object.keys(errs).length > 0) {
      setErrors((prev) => ({ ...prev, ...errs }));
      return false;
    }
    return true;
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!username.trim()) errs.username = "Username is required.";
    if (!email.trim()) {
      errs.email = "Email is required.";
    } else {
      const emailCheck = validateEducationEmail(email.trim());
      if (!emailCheck.valid) errs.email = emailCheck.reason!;
    }
    const pwError = passwordError(password);
    if (pwError) errs.password = pwError;
    if (!agreedToTerms) errs.terms = "You must agree to the Terms and Conditions.";
    if (!isOfAge) errs.age = "You must confirm you are 13 years of age or older.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleUsernameChange(v: string) {
    setUsername(v);
    writeOnboardingState({ pendingUsername: v });
    if (errors.username)
      setErrors((prev) => {
        const next = { ...prev };
        delete next.username;
        return next;
      });
  }

  function handleEmailChange(v: string) {
    setEmail(v);
    writeOnboardingState({ pendingEmail: v });
    if (errors.email)
      setErrors((prev) => {
        const next = { ...prev };
        delete next.email;
        return next;
      });
    if (emailExistsVerified) setEmailExistsVerified(false);
    if (!v.includes("@")) {
      setEmailFeedback(null);
      return;
    }
    const result = validateEducationEmail(v.trim());
    setEmailFeedback({ valid: result.valid, reason: result.reason });
  }

  async function handleNext(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current || loading) return;
    if (!validate()) return;

    submittingRef.current = true;
    setLoading(true);
    setGeneralError(null);
    setEmailExistsVerified(false);

    const cleanUsername = username.trim().replace(/^@/, "");
    const normalizedEmail = email.trim().toLowerCase();
    const { selectedInterests, selectedActivities } = readOnboardingState();
    const supabase = createClient();

    try {
      // 1. Ask the backend what state this email/username is in — the only
      //    safe way to distinguish a verified duplicate (block, point to
      //    login) from an abandoned unverified signup (silently resume).
      const status = await checkSignupStatus(normalizedEmail, cleanUsername);

      if (status.kind === "rate_limited") {
        setGeneralError("Too many attempts. Wait a few minutes and try again.");
        return;
      }
      if (status.kind === "error") {
        setGeneralError("Something went wrong. Please try again.");
        return;
      }
      if (status.emailStatus === "exists_verified") {
        setEmailExistsVerified(true);
        return;
      }
      if (status.usernameStatus === "taken") {
        setErrors((prev) => ({
          ...prev,
          username: "This username is already taken. Try another one.",
        }));
        return;
      }

      // 2. Abandoned unverified signup with this email — replace it so the
      //    NEW password/username take effect.
      if (status.emailStatus === "exists_unverified") {
        const replaced = await replacePendingSignup(normalizedEmail);
        if (replaced === "exists_verified") {
          setEmailExistsVerified(true);
          return;
        }
        if (replaced === "rate_limited") {
          setGeneralError("Too many attempts. Wait a few minutes and try again.");
          return;
        }
        if (replaced === "error") {
          setGeneralError("Something went wrong. Please try again.");
          return;
        }
      }

      // 3. The survey answers travel in the user's OWN signup metadata. Email
      //    confirmation is ON, so there is no session yet — the auth trigger
      //    (migration 042/047) persists the interests, the activities, and the
      //    ranked recommendation batch server-side at account creation.
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            username: cleanUsername,
            full_name: cleanUsername,
            interests: selectedInterests,
            activities: selectedActivities,
          },
          emailRedirectTo: confirmEmailRedirect(),
        },
      });

      if (error) {
        const code = (error.code ?? "").toLowerCase();
        const body = error.message.toLowerCase();
        if (
          code === "user_already_exists" ||
          body.includes("already registered") ||
          body.includes("already exists")
        ) {
          setEmailExistsVerified(true);
        } else if (code === "email_address_invalid") {
          // GoTrue's deliverability check (DNS/MX) rejected the address.
          setErrors((prev) => ({
            ...prev,
            email: "That email address can't receive mail. Double-check it.",
          }));
        } else {
          setGeneralError(friendlyEmailSendError(error));
        }
        return;
      }

      // Supabase returns a fake success (no error, identities=[]) when a
      // verified email already exists, to avoid user enumeration.
      if (!data.session && data.user?.identities?.length === 0) {
        setEmailExistsVerified(true);
        return;
      }

      if (data.user) {
        void recordSignupConsent(data.user.id);
      }

      writeOnboardingState({
        pendingUsername: cleanUsername,
        pendingEmail: normalizedEmail,
      });
      setPendingSignupEmail(normalizedEmail);

      router.push(
        `/onboarding/verify-email?email=${encodeURIComponent(normalizedEmail)}`
      );
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  const pw = checkPassword(password);
  const hintColor = (ok: boolean) =>
    password.length === 0 ? "text-[#9CA3AF]" : ok ? "text-[#0FA6A6]" : "text-[#F02719]";

  return (
    <main className="min-h-screen bg-[#FEFCF0] px-4 pb-10">
      {/* Brand top-left */}
      <div className="flex items-center gap-2 pt-6 pl-4 sm:pl-8">
        <Image src="/logo.png" alt="" width={64} height={58} priority />
        <span
          className="text-[22px] font-bold text-[#0FA6A6]"
          style={{ fontFamily: "var(--font-zain)" }}
        >
          We Glue
        </span>
      </div>

      {/* Match celebration header */}
      <div className="text-center -mt-6">
        <h1 className="text-[30px] font-bold text-[#0FA6A6] flex items-center justify-center gap-4">
          <span aria-hidden className="text-[28px]">
            🎉
          </span>
          <span>
            You matched with <span className="underline">+{matchCount}</span> clubs
          </span>
          <span aria-hidden className="text-[28px]">
            🎉
          </span>
        </h1>
        <p className="text-[19px] font-semibold text-black mt-4">
          Create an account so that you can see your matches!
        </p>
      </div>

      {/* Card */}
      <div className="max-w-[406px] mx-auto mt-9 bg-[#FFFEF7] shadow-[0px_18px_60px_rgba(0,0,0,0.25)] px-6 py-8">
        <form onSubmit={handleNext} className="flex flex-col" noValidate>
          {/* Username */}
          <label htmlFor="username" className="text-sm font-bold text-black mb-2">
            Username
          </label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            placeholder="Create a username"
            value={username}
            onChange={(e) => handleUsernameChange(e.target.value)}
            className={inputClass(!!errors.username)}
            aria-invalid={!!errors.username}
            aria-describedby={errors.username ? "username-error" : undefined}
          />
          {errors.username && (
            <p id="username-error" className="text-xs text-[#F02719] mt-1.5">
              {errors.username}
            </p>
          )}

            {/* School Email */}
            <label
              htmlFor="email"
              className="text-sm font-bold text-black mb-2 mt-5"
            >
              School Email
            </label>
            <div className="relative">
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@school.edu"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                className={inputClass(
                  !!errors.email ||
                    emailExistsVerified ||
                    (emailFeedback !== null && !emailFeedback.valid),
                  emailFeedback?.valid && !emailExistsVerified
                )}
                aria-invalid={
                  !!errors.email ||
                  emailExistsVerified ||
                  (emailFeedback !== null && !emailFeedback.valid)
                }
                aria-describedby="email-error"
              />
              {emailFeedback?.valid && !emailExistsVerified && (
                <span
                  aria-hidden
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#0FA6A6] font-bold"
                >
                  ✓
                </span>
              )}
            </div>
            <p id="email-error" aria-live="polite" className="text-xs mt-1.5">
              {emailExistsVerified ? (
                <span className="text-[#F02719]">
                  An account already exists with this email.{" "}
                  <Link
                    href={`/login?prefillEmail=${encodeURIComponent(email.trim().toLowerCase())}`}
                    className="text-[#0FA6A6] font-semibold underline"
                  >
                    Log in
                  </Link>{" "}
                  instead.
                </span>
              ) : errors.email ||
                (emailFeedback !== null && !emailFeedback.valid) ? (
                <span className="text-[#F02719]">
                  {errors.email ?? "Use a valid school email ending in .edu."}
                </span>
              ) : null}
            </p>

            {/* Password */}
            <label
              htmlFor="password"
              className="text-sm font-bold text-black mb-2 mt-4"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Min.8 characters"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setTransientPassword(e.target.value);
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.password;
                    return next;
                  });
                }}
                className={`${inputClass(!!errors.password)} pr-16`}
                aria-invalid={!!errors.password}
                aria-describedby="password-rules"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-black hover:opacity-70"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {errors.password && (
              <p className="text-xs text-[#F02719] mt-1.5">{errors.password}</p>
            )}
            <div
              id="password-rules"
              className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5"
            >
              <span className={`text-[11px] font-medium ${hintColor(pw.minLength)}`}>
                Min. 8 characters
              </span>
              <span className={`text-[11px] font-medium ${hintColor(pw.hasCapital)}`}>
                1 capital letter
              </span>
              <span className={`text-[11px] font-medium ${hintColor(pw.hasNumber)}`}>
                1 number
              </span>
            </div>

            <LegalCheckboxes
              agreedToTerms={agreedToTerms}
              isOfAge={isOfAge}
              errors={errors}
              onTermsChange={(v) => {
                setAgreedToTerms(v);
                writeOnboardingState({ agreedToTerms: v });
                setErrors((prev) => {
                  const next = { ...prev };
                  delete next.terms;
                  return next;
                });
              }}
              onAgeChange={(v) => {
                setIsOfAge(v);
                writeOnboardingState({ isOfAge: v });
                setErrors((prev) => {
                  const next = { ...prev };
                  delete next.age;
                  return next;
                });
              }}
            />

            {generalError && (
              <p aria-live="assertive" className="text-[13px] text-[#F02719] mt-4">
                {generalError}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-[52px] bg-[#0FA6A6] text-[#FEFCF0] font-semibold text-base rounded-full shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors disabled:opacity-60 flex items-center justify-center mt-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              {loading ? (
                <span
                  aria-hidden
                  className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"
                />
              ) : (
                "Next"
              )}
            </button>

            <p className="text-center text-xs font-semibold text-black mt-5">
              Already have an account?{" "}
              <Link
                href="/login"
                className="text-[#0FA6A6] hover:underline"
              >
                Log in
              </Link>
            </p>
        </form>
      </div>
    </main>
  );
}

function LegalCheckboxes({
  agreedToTerms,
  isOfAge,
  errors,
  onTermsChange,
  onAgeChange,
}: {
  agreedToTerms: boolean;
  isOfAge: boolean;
  errors: Record<string, string>;
  onTermsChange: (v: boolean) => void;
  onAgeChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2.5 mt-5">
      <div>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={agreedToTerms}
            onChange={(e) => onTermsChange(e.target.checked)}
            className="mt-0.5 accent-[#0FA6A6] w-4 h-4 shrink-0"
            aria-invalid={!!errors.terms}
            aria-describedby={errors.terms ? "terms-error" : undefined}
          />
          <span className="text-xs text-black leading-relaxed">
            I agree to the{" "}
            {/* Same-tab internal route; the form state survives the round-trip
                via sessionStorage. */}
            <Link href="/terms" className="text-[#0FA6A6] font-semibold underline">
              Terms and Conditions
            </Link>
            .
          </span>
        </label>
        {errors.terms && (
          <p id="terms-error" className="text-xs text-[#F02719] mt-1 ml-[26px]">
            {errors.terms}
          </p>
        )}
      </div>

      <div>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={isOfAge}
            onChange={(e) => onAgeChange(e.target.checked)}
            className="mt-0.5 accent-[#0FA6A6] w-4 h-4 shrink-0"
            aria-invalid={!!errors.age}
            aria-describedby={errors.age ? "age-error" : undefined}
          />
          <span className="text-xs text-black leading-relaxed">
            I confirm I am 13 years of age or older.
          </span>
        </label>
        {errors.age && (
          <p id="age-error" className="text-xs text-[#F02719] mt-1 ml-[26px]">
            {errors.age}
          </p>
        )}
      </div>
    </div>
  );
}
