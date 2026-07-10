import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { supabase } from '../../lib/supabase';
import {
  useChangeUsername,
  useChangeEmail,
  useChangePassword,
  useDeleteAccount,
  useUsernameAvailability,
} from '../../hooks/useAccountCenter';
import { useOwnProfile } from '../../hooks/useOwnProfile';
import { SUPPORT_EMAIL } from '../../lib/support';
import { ProfileScreenHeader } from '../../components/profile/ProfileScreenHeader';
import { ProfileConfirmationModal } from '../../components/profile/ProfileConfirmationModal';
import { profileColors, profileFonts, profileShadow } from '../../components/profile/profileTheme';

export default function AccountCenterScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const currentEmail = session?.user.email ?? '';
  const { data: ownProfile } = useOwnProfile(userId);
  const currentUsername = ownProfile?.username;

  const [usernameInput, setUsernameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [newPasswordInput, setNewPassword] = useState('');
  const [confirmPasswordInput, setConfirmPassword] = useState('');

  const { availability: usernameAvailability, checking: isCheckingUsername } =
    useUsernameAvailability(userId, usernameInput);

  const changeUsernameMutation = useChangeUsername(userId);
  const changeEmailMutation = useChangeEmail(userId);
  const changePasswordMutation = useChangePassword();
  const {
    confirmStep,
    advanceToStep1,
    advanceToStep2,
    resetConfirmation,
    executeDeletion,
    isDeleting,
    deletionError,
  } = useDeleteAccount(userId);

  const [usernameMsg, setUsernameMsg] = useState<string | null>(null);
  const [emailMsg, setEmailMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);

  // ── Fast verified-email detection ──────────────────────────────────────────
  // The displayed email comes straight from the auth session, so it never
  // changes before verification. Once the user verifies the new address
  // (usually in their mail app), this sync runs on screen focus and on app
  // foreground: it asks GoTrue for the current user and, if the email changed,
  // refreshes the session — onAuthStateChange in the root layout then updates
  // the store and this screen re-renders with the new email in under a second.
  const syncingEmailRef = useRef(false);
  const syncVerifiedEmail = useCallback(async () => {
    if (syncingEmailRef.current) return;
    syncingEmailRef.current = true;
    try {
      const { data } = await supabase.auth.getUser();
      const freshEmail = data.user?.email;
      const { data: current } = await supabase.auth.getSession();
      if (freshEmail && current.session && current.session.user.email !== freshEmail) {
        await supabase.auth.refreshSession();
        setEmailMsg({ text: 'Your email was updated successfully.', isError: false });
      }
    } catch {
      // Background sync only — never surface errors for this.
    } finally {
      syncingEmailRef.current = false;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void syncVerifiedEmail();
    }, [syncVerifiedEmail]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active') void syncVerifiedEmail();
    });
    return () => sub.remove();
  }, [syncVerifiedEmail]);

  useEffect(() => {
    if (changeUsernameMutation.data && !changeUsernameMutation.data.success) {
      setUsernameMsg(changeUsernameMutation.data.message);
    } else if (changeUsernameMutation.data?.success) {
      setUsernameMsg('Username updated successfully.');
      setUsernameInput('');
    }
  }, [changeUsernameMutation.data]);

  useEffect(() => {
    if (changeEmailMutation.data && !changeEmailMutation.data.success) {
      setEmailMsg({ text: changeEmailMutation.data.message, isError: true });
    } else if (changeEmailMutation.data?.success) {
      setEmailMsg({
        text: 'Verification sent. Your email will update after you verify it.',
        isError: false,
      });
      setEmailInput('');
    }
  }, [changeEmailMutation.data]);

  useEffect(() => {
    if (changePasswordMutation.data && !changePasswordMutation.data.success) {
      setPasswordMsg(changePasswordMutation.data.message);
    } else if (changePasswordMutation.data?.success) {
      setPasswordMsg('Password updated successfully.');
      setNewPassword('');
      setConfirmPassword('');
    }
  }, [changePasswordMutation.data]);

  const onChangeUsername = async () => {
    setUsernameMsg(null);
    const result = await changeUsernameMutation.mutateAsync(usernameInput);
    if (!result.success) setUsernameMsg(result.message);
  };

  const onChangeEmail = async () => {
    setEmailMsg(null);
    try {
      const result = await changeEmailMutation.mutateAsync(emailInput);
      if (!result.success) setEmailMsg({ text: result.message, isError: true });
    } catch {
      // changeEmail returns typed results, but keep a belt-and-suspenders
      // catch so an unexpected throw can never leave the button stuck.
      setEmailMsg({ text: 'Something went wrong. Please try again.', isError: true });
    }
  };

  const onChangePassword = async () => {
    setPasswordMsg(null);
    const result = await changePasswordMutation.mutateAsync({
      newPassword: newPasswordInput,
      confirmPassword: confirmPasswordInput,
    });
    if (!result.success) setPasswordMsg(result.message);
  };

  const handleFinalDelete = async () => {
    try {
      await executeDeletion();
      // Data + auth record are gone and the local session is cleared —
      // land on the welcome screen with a clean slate.
      router.replace('/welcome');
    } catch {
      // deletionError surfaced below
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileScreenHeader title="Account Center" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Email */}
        <Text style={styles.sectionLabel}>Email</Text>
        <Text style={styles.currentValue}>{currentEmail}</Text>
        <Text style={styles.note}>We Glue requires a valid .edu email address.</Text>
        <TextInput
          style={styles.input}
          value={emailInput}
          onChangeText={setEmailInput}
          placeholder="New .edu email"
          placeholderTextColor={profileColors.textLight}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {emailMsg && (
          <Text style={[styles.feedback, emailMsg.isError && styles.feedbackError]}>
            {emailMsg.text}
          </Text>
        )}
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={onChangeEmail}
          disabled={changeEmailMutation.isPending || !emailInput.trim()}
          activeOpacity={0.85}
        >
          {changeEmailMutation.isPending ? (
            <ActivityIndicator color={profileColors.bg} />
          ) : (
            <Text style={styles.actionBtnText}>Change Email</Text>
          )}
        </TouchableOpacity>

        <View style={styles.divider} />

        {/* Username */}
        <Text style={styles.sectionLabel}>Username</Text>
        {currentUsername ? (
          <Text style={styles.currentValue}>@{currentUsername}</Text>
        ) : null}
        <TextInput
          style={styles.input}
          value={usernameInput}
          onChangeText={setUsernameInput}
          placeholder="New username"
          placeholderTextColor={profileColors.textLight}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {isCheckingUsername && (
          <Text style={styles.hint}>Checking availability…</Text>
        )}
        {usernameAvailability && usernameInput.trim() && !isCheckingUsername && (
          <Text
            style={[
              styles.hint,
              { color: usernameAvailability.available ? profileColors.teal : profileColors.alertRed },
            ]}
          >
            {usernameAvailability.available ? 'Available' : 'Already taken'}
          </Text>
        )}
        {usernameMsg && (
          <Text style={[styles.feedback, usernameMsg.includes('again on') && styles.feedbackError]}>
            {usernameMsg}
          </Text>
        )}
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={onChangeUsername}
          disabled={changeUsernameMutation.isPending || !usernameInput.trim()}
          activeOpacity={0.85}
        >
          {changeUsernameMutation.isPending ? (
            <ActivityIndicator color={profileColors.bg} />
          ) : (
            <Text style={styles.actionBtnText}>Change Username</Text>
          )}
        </TouchableOpacity>

        <View style={styles.divider} />

        {/* Password */}
        <Text style={styles.sectionLabel}>Change Password</Text>
        <TextInput
          style={styles.input}
          value={newPasswordInput}
          onChangeText={setNewPassword}
          placeholder="New password"
          placeholderTextColor={profileColors.textLight}
          secureTextEntry
        />
        <TextInput
          style={[styles.input, { marginTop: 10 }]}
          value={confirmPasswordInput}
          onChangeText={setConfirmPassword}
          placeholder="Confirm password"
          placeholderTextColor={profileColors.textLight}
          secureTextEntry
        />
        <Text style={styles.note}>
          At least 8 characters with one uppercase letter and one number.
        </Text>
        {passwordMsg && (
          <Text
            style={[
              styles.feedback,
              passwordMsg.includes('match') || passwordMsg.includes('must') ? styles.feedbackError : undefined,
            ]}
          >
            {passwordMsg}
          </Text>
        )}
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={onChangePassword}
          disabled={changePasswordMutation.isPending}
          activeOpacity={0.85}
        >
          {changePasswordMutation.isPending ? (
            <ActivityIndicator color={profileColors.bg} />
          ) : (
            <Text style={styles.actionBtnText}>Change Password</Text>
          )}
        </TouchableOpacity>

        <View style={styles.divider} />

        {/* Delete */}
        <Text style={styles.sectionLabel}>Delete Account</Text>
        <Text style={styles.deleteWarning}>
          Permanently delete your account and all associated data. This cannot be undone.
        </Text>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={advanceToStep1}
          activeOpacity={0.85}
        >
          <Text style={styles.deleteBtnText}>Delete Account</Text>
        </TouchableOpacity>

        {deletionError && (
          <Text style={styles.feedbackError}>
            {`Could not delete account. Please try again or contact ${SUPPORT_EMAIL}.`}
          </Text>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      <ProfileConfirmationModal
        visible={confirmStep === 1}
        title="Are you sure you want to delete your account?"
        message="This is the first step. You will need to confirm again before anything is deleted."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={advanceToStep2}
        onCancel={resetConfirmation}
      />

      <ProfileConfirmationModal
        visible={confirmStep === 2}
        title="Delete your account permanently?"
        message={
          'This will permanently remove your profile, posts, saved events, club memberships, messages, and all other data tied to your account. This action cannot be undone.\n\nYou will be signed out immediately.'
        }
        confirmLabel="Yes, delete my account"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleFinalDelete}
        onCancel={resetConfirmation}
        loading={isDeleting}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: profileColors.bg },
  scroll: { padding: 20 },
  sectionLabel: {
    fontFamily: profileFonts.semiBold,
    fontSize: 13,
    color: profileColors.textMuted,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  currentValue: {
    fontFamily: profileFonts.medium,
    fontSize: 15,
    color: profileColors.textDark,
    marginBottom: 8,
  },
  note: {
    fontFamily: profileFonts.regular,
    fontSize: 12,
    color: profileColors.textMuted,
    marginBottom: 10,
    lineHeight: 17,
  },
  input: {
    backgroundColor: profileColors.white,
    borderWidth: 1,
    borderColor: profileColors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontFamily: profileFonts.regular,
    fontSize: 15,
    color: profileColors.textDark,
    marginBottom: 8,
  },
  hint: {
    fontFamily: profileFonts.regular,
    fontSize: 12,
    color: profileColors.textMuted,
    marginBottom: 8,
  },
  feedback: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.teal,
    marginBottom: 8,
  },
  feedbackError: {
    color: profileColors.alertRed,
    fontFamily: profileFonts.regular,
    fontSize: 13,
    marginBottom: 8,
  },
  actionBtn: {
    height: 48,
    backgroundColor: profileColors.teal,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    ...profileShadow,
  },
  actionBtnText: {
    fontFamily: profileFonts.semiBold,
    fontSize: 15,
    color: profileColors.bg,
  },
  divider: {
    height: 1,
    backgroundColor: profileColors.border,
    marginVertical: 28,
  },
  deleteWarning: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textMuted,
    lineHeight: 19,
    marginBottom: 14,
  },
  deleteBtn: {
    height: 48,
    backgroundColor: profileColors.alertRed,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    ...profileShadow,
  },
  deleteBtnText: {
    fontFamily: profileFonts.semiBold,
    fontSize: 15,
    color: profileColors.white,
  },
});
