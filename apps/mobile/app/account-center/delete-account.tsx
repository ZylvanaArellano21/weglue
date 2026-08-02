import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { useDeleteAccount } from '../../hooks/useAccountCenter';
import {
  isDeletionConfirmed,
  DELETE_CONFIRMATION_WORD,
} from '../../lib/deletionConfirmation';
import { resetToWelcome } from '../../lib/sessionCleanup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAndroidKeyboardHeight } from '../../lib/useAndroidKeyboardHeight';
import { ProfileScreenHeader } from '../../components/profile/ProfileScreenHeader';
import { profileColors, profileFonts, profileShadow } from '../../components/profile/profileTheme';

// ─── Permanent account deletion (App Store Guideline 5.1.1(v)) ───────────────
//
// Self-service and terminal: no support email, no web form, no waiting period,
// no deactivation. Two deliberate steps on ONE screen — an explanation the user
// must accept, then the word DELETE typed by hand — so the destructive button
// can never be reached by a stray tap, and the whole flow is legible in a single
// screen recording for App Review.
//
// Nothing local is touched until the SERVER confirms the account is gone. If the
// call fails, the account and session are exactly as they were and the user can
// simply try again — see hooks/useAccountCenter.

/** Exactly what is destroyed, and what deliberately survives, in the user's words. */
const DELETED_CATEGORIES = [
  'Your profile, username, email and account details',
  'Your posts, photos, comments and likes',
  'Your messages and group memberships',
  'Your club memberships, officer roles and RSVPs',
  'Your saved events, interests and activities',
  'Your followers, following and Gluemate connections',
  'Your notifications, notification settings and devices',
];

export default function DeleteAccountScreen() {
  const router = useRouter();
  const { session } = useAuthStore();
  const userId = session?.user.id;

  const [step, setStep] = useState<1 | 2>(1);
  const [confirmText, setConfirmText] = useState('');

  const { executeDeletion, isDeleting, deletionError, resetDeletionError } =
    useDeleteAccount(userId);

  // Android edge-to-edge does not resize the content view when the IME opens,
  // so the confirmation field would sit behind the keyboard. iOS keeps its
  // KeyboardAvoidingView padding path and is untouched by this.
  const { height: androidKeyboardHeight } = useAndroidKeyboardHeight();

  const confirmed = isDeletionConfirmed(confirmText);
  const canDelete = confirmed && !isDeleting;

  function handleCancel() {
    if (isDeleting) return;
    router.back();
  }

  function handleContinue() {
    resetDeletionError();
    setStep(2);
  }

  async function handlePermanentDelete() {
    if (!canDelete) return;
    try {
      // Resolves only once the server has confirmed the deletion; the shared
      // teardown (session, caches, push token, sidebar state) has already run
      // inside it.
      await executeDeletion(confirmText);
      await AsyncStorage.setItem('weglue-account-deletion-success', '1');
      // Welcome becomes the only screen in the stack — no Back path, no iOS
      // swipe-back and no Android Back into anything authenticated.
      resetToWelcome(router);
    } catch {
      // Deletion failed: account and session are untouched and the user stays
      // here. deletionError renders below with a retry-able message.
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileScreenHeader title="Delete Account" onBack={handleCancel} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: 40 + androidKeyboardHeight },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title} accessibilityRole="header">
            Delete your account?
          </Text>

          <Text style={styles.body}>
            This permanently deletes your We Glue account and associated personal
            data, including your profile, posts, comments, messages, photos,
            RSVPs, memberships, connections, notifications and account
            information. This action cannot be undone.
          </Text>

          <Text style={styles.sectionLabel}>What gets deleted</Text>
          <View style={styles.list}>
            {DELETED_CATEGORIES.map((item) => (
              <View key={item} style={styles.listRow}>
                <Text style={styles.bullet} accessibilityElementsHidden>
                  •
                </Text>
                <Text style={styles.listText}>{item}</Text>
              </View>
            ))}
          </View>

          {/* Honesty clause: the copy above must not claim more than the server
              actually does. Messages you sent in conversations other people are
              still part of stay in those threads, permanently detached from
              you — anything else would delete other people's history too. */}
          <Text style={styles.note}>
            Messages you sent in conversations that other people are still part
            of remain in those conversations, permanently disconnected from you
            and no longer linked to your name or profile. We keep the minimum
            safety records required to handle abuse reports, with your name and
            email removed from them.
          </Text>

          <Text style={styles.warning}>
            You will be signed out immediately. You will not be able to sign in
            with this account again, and it cannot be restored.
          </Text>

          {step === 1 ? (
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={handleCancel}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Cancel and keep my account"
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.continueBtn}
                onPress={handleContinue}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Continue to the final deletion confirmation"
              >
                <Text style={styles.continueBtnText}>Continue</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.confirmBlock}>
              <Text style={styles.confirmPrompt} nativeID="delete-confirm-label">
                Type {DELETE_CONFIRMATION_WORD} to confirm.
              </Text>
              <TextInput
                style={[styles.input, confirmed && styles.inputConfirmed]}
                value={confirmText}
                onChangeText={(v) => {
                  setConfirmText(v);
                  if (deletionError) resetDeletionError();
                }}
                placeholder={DELETE_CONFIRMATION_WORD}
                placeholderTextColor={profileColors.textLight}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                editable={!isDeleting}
                accessibilityLabel={`Type ${DELETE_CONFIRMATION_WORD} to confirm permanent deletion`}
                accessibilityLabelledBy="delete-confirm-label"
              />

              {deletionError && (
                <Text
                  style={styles.errorText}
                  accessibilityLiveRegion="assertive"
                  accessibilityRole="alert"
                >
                  We couldn&apos;t delete your account. Your account is unchanged
                  — check your connection and try again.
                </Text>
              )}

              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={handleCancel}
                  disabled={isDeleting}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel and keep my account"
                >
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.deleteBtn, !canDelete && styles.deleteBtnDisabled]}
                  onPress={handlePermanentDelete}
                  disabled={!canDelete}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canDelete, busy: isDeleting }}
                  accessibilityLabel="Permanently delete account"
                  accessibilityHint={
                    confirmed
                      ? 'Deletes your account and all associated data. This cannot be undone.'
                      : `Type ${DELETE_CONFIRMATION_WORD} above to enable this button.`
                  }
                >
                  {isDeleting ? (
                    <ActivityIndicator color={profileColors.white} />
                  ) : (
                    <Text style={styles.deleteBtnText}>Permanently Delete Account</Text>
                  )}
                </TouchableOpacity>
              </View>

              {isDeleting && (
                <Text style={styles.progressText} accessibilityLiveRegion="polite">
                  Deleting your account…
                </Text>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: profileColors.bg },
  flex: { flex: 1 },
  scroll: { padding: 20 },
  title: {
    fontFamily: profileFonts.displayBold,
    fontSize: 24,
    color: profileColors.textDark,
    marginBottom: 12,
  },
  body: {
    fontFamily: profileFonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: profileColors.textDark,
    marginBottom: 22,
  },
  sectionLabel: {
    fontFamily: profileFonts.semiBold,
    fontSize: 13,
    color: profileColors.textMuted,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  list: { marginBottom: 18 },
  listRow: { flexDirection: 'row', marginBottom: 6 },
  bullet: {
    fontFamily: profileFonts.regular,
    fontSize: 14,
    color: profileColors.textMuted,
    width: 16,
  },
  listText: {
    flex: 1,
    fontFamily: profileFonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: profileColors.textDark,
  },
  note: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: profileColors.textMuted,
    marginBottom: 18,
  },
  warning: {
    fontFamily: profileFonts.semiBold,
    fontSize: 14,
    lineHeight: 20,
    color: profileColors.alertRed,
    marginBottom: 24,
  },
  actions: { gap: 12 },
  secondaryBtn: {
    height: 48,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: profileColors.border,
    backgroundColor: profileColors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontFamily: profileFonts.semiBold,
    fontSize: 15,
    color: profileColors.textDark,
  },
  continueBtn: {
    height: 48,
    borderRadius: 40,
    backgroundColor: profileColors.teal,
    alignItems: 'center',
    justifyContent: 'center',
    ...profileShadow,
  },
  continueBtnText: {
    fontFamily: profileFonts.semiBold,
    fontSize: 15,
    color: profileColors.bg,
  },
  confirmBlock: { marginTop: 4 },
  confirmPrompt: {
    fontFamily: profileFonts.semiBold,
    fontSize: 15,
    color: profileColors.textDark,
    marginBottom: 10,
  },
  input: {
    backgroundColor: profileColors.white,
    borderWidth: 1,
    borderColor: profileColors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontFamily: profileFonts.semiBold,
    fontSize: 16,
    letterSpacing: 1.5,
    color: profileColors.textDark,
    marginBottom: 16,
  },
  inputConfirmed: { borderColor: profileColors.alertRed },
  errorText: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: profileColors.alertRed,
    marginBottom: 14,
  },
  deleteBtn: {
    height: 48,
    borderRadius: 40,
    backgroundColor: profileColors.alertRed,
    alignItems: 'center',
    justifyContent: 'center',
    ...profileShadow,
  },
  // Contrast is deliberately kept readable when disabled: a destructive action
  // that fades to unreadable grey reads as "broken" rather than "not yet armed".
  deleteBtnDisabled: { opacity: 0.45 },
  deleteBtnText: {
    fontFamily: profileFonts.semiBold,
    fontSize: 15,
    color: profileColors.white,
  },
  progressText: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textMuted,
    textAlign: 'center',
    marginTop: 14,
  },
});
