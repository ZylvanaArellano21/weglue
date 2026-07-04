/**
 * Account Center Screen
 *
 * DATA LAYER — Cursor (Step 2) renders the UI. Do not change the hooks or props below.
 *
 * Sections:
 *
 * 1. Change Username
 *    usernameInput           string               — controlled input value
 *    usernameAvailability    UsernameAvailability | null  — { available, message }
 *    isCheckingUsername      boolean
 *    onChangeUsername        () => void           — calls mutateAsync
 *    isChangingUsername      boolean
 *    changeUsernameError     Error | null
 *    changeUsernameResult    ChangeUsernameResult | null  — { success, message, next_available_at? }
 *    Cooldown error message format: "You can change your username again on [Month Day, Year]."
 *
 * 2. Change Email
 *    emailInput              string               — controlled input value
 *    onChangeEmail           () => void           — calls mutateAsync
 *    isChangingEmail         boolean
 *    changeEmailError        Error | null
 *    changeEmailResult       ChangeEmailResult | null     — { success, message }
 *    Validates: .edu / .edu.au / .ac.uk / .ac.in / .edu.sg suffix required
 *    Cooldown error message format: "You can change your email again on [Month Day, Year]."
 *
 * 3. Change Password
 *    newPasswordInput        string
 *    confirmPasswordInput    string
 *    onChangePassword        () => void           — calls mutateAsync
 *    isChangingPassword      boolean
 *    changePasswordError     Error | null
 *    changePasswordResult    ChangePasswordResult | null  — { success, message }
 *
 * 4. Delete Account — two-step confirmation
 *    confirmStep             0 | 1 | 2
 *    advanceToStep1          () => void           — show first confirmation prompt
 *    advanceToStep2          () => void           — show second confirmation prompt
 *    resetConfirmation       () => void           — cancel
 *    executeDeletion         () => Promise<void>  — only call when confirmStep === 2
 *    isDeleting              boolean
 *    deletionError           Error | null
 *    Step 0: "Delete Account" button
 *    Step 1: warning sheet — "This will permanently delete all your data. Are you sure?"
 *    Step 2: final confirmation — "Type DELETE to confirm" or second tap
 *    On success: user is signed out and routed to welcome screen automatically (handled by auth guard)
 */

import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@weglue/shared';
import {
  useChangeUsername,
  useChangeEmail,
  useChangePassword,
  useDeleteAccount,
  useUsernameAvailability,
} from '../../hooks/useAccountCenter';

export default function AccountCenterScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;

  const [usernameInput, setUsernameInput] = useState('');
  const [emailInput, setEmailInput]       = useState('');
  const [newPasswordInput, setNewPassword]       = useState('');
  const [confirmPasswordInput, setConfirmPassword] = useState('');

  const { availability: usernameAvailability, checking: isCheckingUsername } =
    useUsernameAvailability(userId, usernameInput);

  const changeUsernameMutation = useChangeUsername(userId);
  const changeEmailMutation    = useChangeEmail(userId);
  const changePasswordMutation = useChangePassword();
  const deleteAccountHook      = useDeleteAccount(userId);

  const onChangeUsername = () => changeUsernameMutation.mutateAsync(usernameInput);
  const onChangeEmail    = () => changeEmailMutation.mutateAsync(emailInput);
  const onChangePassword = () =>
    changePasswordMutation.mutateAsync({
      newPassword: newPasswordInput,
      confirmPassword: confirmPasswordInput,
    });

  // ─── Cursor: render full Account Center UI here ───────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FDFBEF' }}>
      <Text style={{ padding: 20, fontSize: 16, color: '#111' }}>Account Center</Text>
    </SafeAreaView>
  );
}
