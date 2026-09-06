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
  sendVerificationEmail,
  setPendingSignupEmail,
} from "../../../lib/authFlow";
import {
  getTransientPassword,
  readOnboardingState,
  resetOnboardingState,
  setTransientPassword,
  writeOnboardingState,
} from "../../../lib/onboardingState";
import { LegalModal } from "../../../components/legal/LegalModal";

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
  const [legalModalOpen, setLegalModalOpen] = useState(false);
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
    // In-memory only — never survives a full reload.
    setPassword(getTransientPassword());
    // Seed from the Activities-step preview; refreshed just below.
    setMatchCount(state.matchCount);
    if (state.pendingEmail && state.pendingEmail.includes("@")) {
      const result = validateEducationEmail(state.pendingEmail);
      setEmailFeedback({ valid: result.valid, reason: result.reason });
    }

    // Re-run the same server preview the signup batch will use, so the "+N
    // clubs" heading is the exact count the account gets after verifying (the
    // Activities-step value goes stale if the user edited interests via Back).
    // preview_club_match_count already enforces the min-2 + popular-fill rule
    // server-side, so no client Math.max fudge — if it can't be trusted the
    // heading falls back to no number rather than a wrong one.
    (async () => {
      try {
        const { data } = await createClient().rpc("preview_club_match_count", {
          p_interests: state.selectedInterests,
        });
        if (typeof data === "number" && data >= 2) {
          setMatchCount(data);
          writeOnboardingState({ matchCount: data });
        }
      } catch {
        /* keep the seeded value */
      }
    })();
  }, []);

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
    const { selectedInterests, selectedActivities, avatarChoice } = readOnboardingState();
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

      // 2. An unverified signup already owns this email. Never delete it from
      //    a client-supplied email: resend its confirmation instead. The
      //    email link is the proof of control, and the existing account stays
      //    intact until the owner verifies it.
      if (status.emailStatus === "exists_unverified") {
        const resend = await sendVerificationEmail(normalizedEmail);
        if (!resend.ok) {
          setGeneralError("cooldown" in resend ? `Please wait ${resend.cooldown} seconds before trying again.` : resend.message);
          return;
        }
        setPendingSignupEmail(normalizedEmail);
        router.push(`/onboarding/verify-email?email=${encodeURIComponent(normalizedEmail)}`);
        return;
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
            agreed_to_terms: true,
            ...(avatarChoice?.kind === "preset" && {
              avatar_choice_type: "preset",
              avatar_choice_value: avatarChoice.id,
            }),
            ...(avatarChoice?.kind === "text" && {
              avatar_choice_type: "text",
              avatar_choice_value: avatarChoice.value,
            }),
            ...(avatarChoice &&
              (avatarChoice.kind === "photo" || avatarChoice.kind === "camera") && {
                avatar_choice_type: avatarChoice.kind,
                avatar_choice_value: avatarChoice.token,
              }),
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
      <div className="flex items-center gap-2 pt-4 pl-2 sm:pt-6 sm:pl-8">
        <Image
          src="/logo.png"
          alt=""
          width={64}
          height={58}
          className="w-9 h-8 sm:w-16 sm:h-[58px]"
          priority
        />
        <span
          className="text-[17px] sm:text-[22px] font-bold text-[#0FA6A6]"
          style={{ fontFamily: "var(--font-zain)" }}
        >
          We Glue
        </span>
      </div>

      {/* Match celebration header */}
      <div className="text-center mt-3 sm:-mt-6 px-2">
        <h1 className="text-[19px] sm:text-[30px] font-bold text-[#0FA6A6] flex flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:gap-4">
          <span aria-hidden className="text-[18px] sm:text-[28px]">
            🎉
          </span>
          <span>
            {matchCount >= 2 ? (
              <>
                You matched with <span className="underline">+{matchCount}</span> clubs
              </>
            ) : (
              <>We found clubs you&apos;ll love</>
            )}
          </span>
          <span aria-hidden className="text-[18px] sm:text-[28px]">
            🎉
          </span>
        </h1>
        <p className="text-[13px] sm:text-[19px] font-semibold text-black mt-2 sm:mt-4">
          Create an account so that you can see your matches!
        </p>
      </div>

      {/* Card */}
      <div className="max-w-[406px] mx-auto mt-6 sm:mt-9 bg-[#FFFEF7] shadow-[0px_18px_60px_rgba(0,0,0,0.25)] px-6 py-8">
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

            {/* Email */}
            <label
              htmlFor="email"
              className="text-sm font-bold text-black mb-2 mt-5"
            >
              Email
            </label>
            <div className="relative">
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="yourname@email.com"
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
                  {errors.email ??
                    emailFeedback?.reason ??
                    "Please enter a valid email address."}
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

            {/* Clicking either link opens the same in-app document (Terms &
                Conditions, with the Privacy Policy as a section inside it) as
                a modal, so closing it always returns to this exact page with
                everything already typed still here. */}
            <p className="text-center text-xs text-black mt-4 leading-relaxed">
              By clicking Next, you agree to our{" "}
              <button
                type="button"
                onClick={() => setLegalModalOpen(true)}
                className="text-[#0FA6A6] font-semibold hover:underline"
              >
                Terms and Conditions
              </button>{" "}
              and{" "}
              <button
                type="button"
                onClick={() => setLegalModalOpen(true)}
                className="text-[#0FA6A6] font-semibold hover:underline"
              >
                Privacy Policy
              </button>
              .
            </p>
        </form>
      </div>

      {legalModalOpen && <LegalModal onClose={() => setLegalModalOpen(false)} />}
    </main>
  );
}
