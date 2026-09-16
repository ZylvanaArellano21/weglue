import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import {
  type Campus,
  retryIdempotent,
  toCampuses,
  useOnboardingStore,
  validateCampusEmail,
} from "@weglue/shared";
import { useToast } from "../../components/Toast";
import { LegalModal } from "../../components/shared/LegalModal";
import {
  CONFIRM_EMAIL_REDIRECT,
  checkSignupStatus,
  friendlyEmailSendError,
  sendVerificationEmail,
  setPendingSignupEmail,
} from "../../lib/authFlow";

export default function OnboardingSignupScreen() {
  const router = useRouter();
  const {
    matchCount,
    selectedCampusSlug,
    selectedInterests,
    selectedActivities,
    avatarChoice,
    setMatchCount,
    setPendingUsername,
    setPendingEmail,
    setPendingPassword,
    reset: resetOnboarding,
    pendingUsername,
    pendingEmail,
  } = useOnboardingStore();
  const { show, ToastComponent } = useToast();

  // preview_club_match_count already enforces the min-2 + popular-fill rule
  // server-side, so the heading shows the real count with no client fudge; if
  // it's < 2 (can't be trusted) the heading drops the number instead of lying.
  const displayMatchCount = matchCount;

  // The campus chosen on the first onboarding step. Its row carries the email
  // rule this account must satisfy, so the form cannot be evaluated — or
  // submitted — until it resolves.
  const [campus, setCampus] = useState<Campus | null>(null);
  const [campusChecked, setCampusChecked] = useState(false);

  // Resolve the campus, then refresh the match preview scoped to it. The
  // Activities-step value goes stale if the user edited interests via Back, so
  // "+N clubs" is re-read here and equals what the account actually gets —
  // counted within the chosen campus, never across campuses.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Signup is campus-scoped now: without a valid, still-active campus there
      // is no email rule to apply and no membership to create, so the flow
      // returns to the picker rather than letting the backend reject the
      // account later with nothing on screen to explain why.
      let resolved: Campus | null = null;
      if (selectedCampusSlug) {
        try {
          const rows = await retryIdempotent(async () => {
            const { data, error } = await supabase.rpc("list_active_campuses");
            if (error) throw error;
            return data;
          });
          resolved =
            toCampuses(rows).find((c) => c.slug === selectedCampusSlug) ?? null;
        } catch {
          resolved = null;
        }
      }
      if (cancelled) return;
      if (!resolved) {
        router.replace("/onboarding/choose-university");
        return;
      }
      setCampus(resolved);
      setCampusChecked(true);

      try {
        const { data } = await supabase.rpc("preview_club_match_count", {
          p_interests: selectedInterests,
          p_university_slug: resolved.slug,
        });
        if (!cancelled && typeof data === "number" && data >= 2) {
          setMatchCount(data);
        }
      } catch {
        /* keep the seeded value */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCampusSlug, selectedInterests, setMatchCount, router]);

  // Restore username/email from store so back navigation preserves the form
  const [username, setUsername] = useState(pendingUsername);
  const [email, setEmail] = useState(pendingEmail);
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Verified duplicate email — rendered as an inline error with a tappable
  // "Try to log in." link instead of a plain string.
  const [emailExistsVerified, setEmailExistsVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState<{ valid: boolean; reason?: string } | null>(null);
  const [legalModalOpen, setLegalModalOpen] = useState(false);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!username.trim()) errs.username = "Username is required.";
    if (!email.trim()) {
      errs.email = "Email is required.";
    } else {
      const emailCheck = validateCampusEmail(campus, email.trim());
      if (!emailCheck.valid) errs.email = emailCheck.reason!;
    }
    if (!password) {
      errs.password = "Password is required.";
    } else if (password.length < 8) {
      errs.password = "Password must be at least 8 characters.";
    } else if (!/[A-Z]/.test(password)) {
      errs.password = "Password must include at least 1 capital letter.";
    } else if (!/[0-9]/.test(password)) {
      errs.password = "Password must include at least 1 number.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleEmailChange(text: string) {
    setEmail(text);
    // Always clear the server-side "already taken" error when the user edits the field
    if (errors.email) setErrors((prev) => { const next = { ...prev }; delete next.email; return next; });
    if (emailExistsVerified) setEmailExistsVerified(false);
    if (!text.includes("@")) {
      setEmailFeedback(null);
      return;
    }
    const result = validateCampusEmail(campus, text.trim());
    setEmailFeedback({ valid: result.valid, reason: result.reason });
  }

  async function handleNext() {
    // Defence in depth: the mount effect already routes back to the picker when
    // no campus resolved, so reaching here without one should be impossible.
    if (!campus) return;
    if (!validate()) return;
    setLoading(true);
    setEmailExistsVerified(false);

    const cleanUsername = username.trim().replace(/^@/, "");
    const normalizedEmail = email.trim().toLowerCase();

    try {
      // 1. Ask the backend what state this email/username is in. This is the
      //    only safe way to distinguish a verified duplicate (block, point to
      //    login) from an abandoned unverified signup (silently resume).
      const status = await checkSignupStatus(normalizedEmail, cleanUsername);

      if (status.kind === "rate_limited") {
        show("Too many attempts. Wait a few minutes and try again.", "error");
        return;
      }
      if (status.kind === "error") {
        show("Something went wrong. Please try again.", "error");
        return;
      }

      if (status.emailStatus === "exists_verified") {
        setEmailExistsVerified(true);
        return;
      }

      if (status.usernameStatus === "taken") {
        setErrors((prev) => ({ ...prev, username: "This username is already taken." }));
        return;
      }

      // 2. An unverified signup already owns this email. Never delete it from
      //    a client-supplied email: resend its confirmation instead. The
      //    email link is the proof of control, and the existing account stays
      //    intact until the owner verifies it.
      if (status.emailStatus === "exists_unverified") {
        const resend = await sendVerificationEmail(normalizedEmail);
        if (!resend.ok) {
          show("cooldown" in resend ? `Please wait ${resend.cooldown} seconds before trying again.` : resend.message, "error");
          return;
        }
        await setPendingSignupEmail(normalizedEmail);
        router.push({ pathname: "/auth/verify-email", params: { email: normalizedEmail } });
        return;
      }

      // The survey answers travel in the user's OWN signup metadata. Email
      // confirmation is ON, so there is no session yet — the auth trigger
      // (migration 042) is what persists the interests, the activities and the
      // ranked recommendation batch, server-side, at the moment the account is
      // created. That is what makes the match count survive verifying on a
      // different device, reinstalling, or closing the app before verifying.
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            username: cleanUsername,
            full_name: cleanUsername,
            // The campus this account belongs to. The auth trigger resolves the
            // slug and writes profiles.university_id from it, and the backend
            // rejects the signup outright if it is missing, unknown or
            // inactive — there is deliberately no default campus.
            university_slug: campus.slug,
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
          emailRedirectTo: CONFIRM_EMAIL_REDIRECT,
        },
      });

      if (error) {
        const code = (error.code ?? "").toLowerCase();
        const body = error.message.toLowerCase();
        if (code === "user_already_exists" || body.includes("already registered") || body.includes("already exists")) {
          // Race: became verified between the probe and signUp.
          setEmailExistsVerified(true);
        } else {
          show(friendlyEmailSendError(error), "error");
        }
        return;
      }

      // Supabase returns a fake success (no error, identities=[]) when a
      // verified email already exists, to avoid user enumeration.
      if (!data.session && data.user?.identities?.length === 0) {
        setEmailExistsVerified(true);
        return;
      }

      setPendingUsername(cleanUsername);
      setPendingEmail(normalizedEmail);
      setPendingPassword(password);
      await setPendingSignupEmail(normalizedEmail);

      // Confirm Email is the only next step, whether or not a session came
      // back. There is no profile-picture step and no club catalog any more.
      router.push({
        pathname: "/auth/verify-email",
        params: { email: normalizedEmail, from: "signup" },
      });
    } finally {
      setLoading(false);
    }
  }

  // On a campus that accepts only its own domain, show it in the placeholder;
  // every other campus keeps the original hint unchanged.
  const emailPlaceholder =
    campus?.emailMode === "allowlist" && campus.emailDomains?.[0]
      ? `yourname@${campus.emailDomains[0]}`
      : "yourname@email.com";

  // Nothing renders until the campus resolves: the email field's rule comes
  // from it, and a form shown under the wrong rule would validate wrongly.
  if (!campusChecked) {
    return (
      <SafeAreaView style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#0FA6A6" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {ToastComponent}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back arrow */}
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Text style={styles.backArrow}>‹</Text>
            </TouchableOpacity>
          </View>

          {/* Match celebration header */}
          <View style={styles.header}>
            <View style={styles.partyRow}>
              <Text style={styles.partyEmoji}>🎉</Text>
              <Text style={styles.matchedText}>
                {displayMatchCount >= 2 ? 'You matched with' : "We found clubs you'll love"}
              </Text>
              <Text style={styles.partyEmoji}>🎉</Text>
            </View>
            {displayMatchCount >= 2 && (
              <Text style={styles.matchCount}>+{displayMatchCount} clubs</Text>
            )}
            <Text style={styles.createText}>
              Create an account so that you can see your matches!!!
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {/* Username */}
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={[styles.input, !!errors.username && styles.inputError]}
              placeholder=""
              placeholderTextColor="rgba(0,0,0,0.3)"
              value={username}
              onChangeText={(v) => {
                setUsername(v);
                if (errors.username) setErrors((prev) => { const next = { ...prev }; delete next.username; return next; });
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {!!errors.username && <Text style={styles.errorText}>{errors.username}</Text>}

            {/* Email */}
            <Text style={[styles.label, { marginTop: 16 }]}>Email</Text>
            <View style={{ position: "relative" }}>
              <TextInput
                style={[
                  styles.input,
                  (!!errors.email || emailExistsVerified || (emailFeedback !== null && !emailFeedback.valid)) && styles.inputError,
                  emailFeedback?.valid && !emailExistsVerified && styles.inputValid,
                ]}
                placeholder={emailPlaceholder}
                placeholderTextColor="rgba(0,0,0,0.3)"
                value={email}
                onChangeText={handleEmailChange}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
              {emailFeedback?.valid && (
                <View style={styles.inputCheckmark} pointerEvents="none">
                  <Text style={{ color: "#0FA6A6", fontSize: 16, fontWeight: "700" }}>✓</Text>
                </View>
              )}
            </View>
            {emailExistsVerified ? (
              <Text style={styles.errorText}>
                You already have an account.{" "}
                <Text
                  style={styles.errorLink}
                  onPress={() => router.replace("/auth/login")}
                >
                  Try to log in.
                </Text>
              </Text>
            ) : (
              (!!errors.email || (emailFeedback !== null && !emailFeedback.valid && !errors.email)) && (
                <Text style={styles.errorText}>
                  {errors.email || emailFeedback?.reason || "Please enter a valid email address"}
                </Text>
              )
            )}

            {/* Password */}
            <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
            <TextInput
              style={[styles.input, !!errors.password && styles.inputError]}
              placeholder="Min.8 characters"
              placeholderTextColor="rgba(0,0,0,0.3)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
            />
            {!!errors.password ? (
              <Text style={styles.errorText}>{errors.password}</Text>
            ) : null}
            <View style={styles.hintRow}>
              <Text style={[styles.hintItem, password.length === 0 ? styles.hintGray : password.length >= 8 ? styles.hintGreen : styles.hintRed]}>
                Min. 8 characters
              </Text>
              <Text style={[styles.hintItem, password.length === 0 ? styles.hintGray : /[A-Z]/.test(password) ? styles.hintGreen : styles.hintRed]}>
                1 capital letter
              </Text>
              <Text style={[styles.hintItem, password.length === 0 ? styles.hintGray : /[0-9]/.test(password) ? styles.hintGreen : styles.hintRed]}>
                1 number
              </Text>
            </View>

            {/* Next button */}
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                { marginTop: 24 },
                (loading || (emailFeedback !== null && !emailFeedback.valid) || Object.keys(errors).length > 0) && styles.primaryBtnDisabled,
              ]}
              onPress={handleNext}
              disabled={loading || (emailFeedback !== null && !emailFeedback.valid) || Object.keys(errors).length > 0}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#FEFCF0" />
              ) : (
                <Text style={styles.primaryBtnText}>Next</Text>
              )}
            </TouchableOpacity>

            {/* Log in link */}
            <TouchableOpacity
              onPress={() => router.replace("/auth/login")}
              style={{ alignSelf: "center", marginTop: 16 }}
            >
              <Text style={styles.footerText}>
                Already have an account?{" "}
                <Text style={styles.tealLink}>Log in</Text>
              </Text>
            </TouchableOpacity>

            {/* Legal notice — clicking either link opens the same in-app
                document (Terms & Conditions, with the Privacy Policy as a
                section inside it) as a modal, so closing it always returns to
                this exact screen with everything already typed still here. */}
            <Text style={styles.legalText}>
              By clicking Next, you agree to our{" "}
              <Text style={styles.tealLink} onPress={() => setLegalModalOpen(true)}>
                Terms and Conditions
              </Text>{" "}
              and{" "}
              <Text style={styles.tealLink} onPress={() => setLegalModalOpen(true)}>
                Privacy Policy
              </Text>
              .
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <LegalModal visible={legalModalOpen} onClose={() => setLegalModalOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FEFCF0" },
  loadingContainer: { alignItems: "center", justifyContent: "center" },
  topBar: { paddingHorizontal: 20, paddingTop: 8 },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  backArrow: { fontSize: 30, color: "#000", lineHeight: 36 },
  // width/maxWidth/alignSelf are a no-op on phone (screens are already
  // narrower than 480) but cap and center this column on iPad/Android
  // tablet instead of stretching edge-to-edge.
  header: { alignItems: "center", paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24, width: "100%", maxWidth: 480, alignSelf: "center" },
  partyRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  partyEmoji: { fontSize: 24 },
  matchedText: { fontSize: 24, fontWeight: "700", color: "#0FA6A6" },
  matchCount: {
    fontSize: 36,
    fontWeight: "700",
    color: "#0FA6A6",
    textDecorationLine: "underline",
    marginBottom: 12,
  },
  createText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#000",
    textAlign: "center",
    lineHeight: 24,
  },
  form: { paddingHorizontal: 24, paddingBottom: 40, width: "100%", maxWidth: 480, alignSelf: "center" },
  label: { fontSize: 14, fontWeight: "600", color: "#000", marginBottom: 6 },
  input: {
    backgroundColor: "#FEFCF0",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.2)",
    borderRadius: 10,
    height: 53,
    paddingHorizontal: 16,
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  inputError: { borderColor: "#F02719" },
  inputValid: { borderColor: "#0FA6A6" },
  errorLink: {
    fontSize: 11,
    color: "#0FA6A6",
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  inputCheckmark: {
    position: "absolute",
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  primaryBtnDisabled: { opacity: 0.5 },
  errorText: { fontSize: 11, color: "#F02719", marginTop: 4, marginLeft: 4 },
  primaryBtn: {
    height: 52,
    backgroundColor: "#0FA6A6",
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  primaryBtnText: { color: "#FEFCF0", fontSize: 16, fontWeight: "600" },
  hintRow: { flexDirection: "row", gap: 12, marginTop: 6, marginLeft: 4, flexWrap: "wrap" },
  hintItem: { fontSize: 11, fontWeight: "500" },
  hintGray: { color: "#9CA3AF" },
  hintRed: { color: "#F02719" },
  hintGreen: { color: "#0FA6A6" },
  tealLink: { fontSize: 12, color: "#0FA6A6", fontWeight: "600" },
  footerText: { fontSize: 12, color: "#5F5D5D" },
  legalText: {
    fontSize: 12,
    color: "#000",
    textAlign: "center",
    marginTop: 16,
    lineHeight: 18,
  },
});
