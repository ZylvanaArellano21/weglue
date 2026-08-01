import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  restrictionCopy,
  formatSuspensionEnd,
  type AccessStatePayload,
} from '../../lib/accessState';
import {
  DELETE_CONFIRMATION_WORD,
  isDeletionConfirmed,
} from '../../lib/deletionConfirmation';
import { deleteOwnAccount } from '../../services/accountService';

// ─── Restricted-account shell (iOS + Android, identical) ────────────────────
//
// Day 10B2. Rendered by the root layout INSTEAD of the navigator when the
// signed-in account is suspended or platform-blocked. Because it REPLACES the
// <Stack> rather than covering it, no student screen ever mounts: no tabs, no
// feed, no recommendation query, no realtime channel, no push host. A cached
// student screen cannot be reached, let alone interacted with.
//
// WHAT IT CONTAINS, AND WHY EACH ITEM IS HERE
//   • a GENERIC explanation                — the internal reason is never sent
//     to the client and could not be rendered here even by mistake
//   • the suspension end date, when one exists
//   • the public support contact
//   • Privacy Policy, Terms, Community Guidelines — store-policy pages that
//     must resolve for any signed-in account
//   • DELETE ACCOUNT — a store-compliance requirement. A restricted student
//     must never lose the ability to delete their own account, which is why
//     migration 058 deliberately leaves delete_own_account_atomic ungated and
//     why no Auth `banned_until` is used anywhere in this feature.
//   • Sign out
//
// There is no Platform.OS branch here. iOS and Android run the same code.

const SUPPORT_FALLBACK = 'info@weglue.app';
const LEGAL = {
  privacy: 'https://weglue.app/privacy-policy',
  terms: 'https://weglue.app/terms',
  guidelines: 'https://weglue.app/community-guidelines',
};

export function RestrictedAccountShell({
  payload,
  onSignOut,
  onDeleted,
}: {
  payload: AccessStatePayload | null;
  onSignOut: () => Promise<void> | void;
  /** Tear down the session after the server confirms the account is gone. */
  onDeleted: () => Promise<void> | void;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const copy = restrictionCopy(payload);
  const until = formatSuspensionEnd(copy.until);
  const support = payload?.support_email || SUPPORT_FALLBACK;

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  }

  // Deletion runs INLINE rather than by navigating.
  //
  // This shell is rendered INSTEAD of the <Stack>, so there is no navigator to
  // push onto — a router.push here would silently do nothing, which is exactly
  // the kind of dead "Delete my account" button App Store Guideline 5.1.1(v)
  // exists to prevent. The same typed-confirmation gate and the same
  // deleteOwnAccount() edge-function call are reused, so a restricted student
  // deletes through precisely the path everyone else does.
  async function handleDelete() {
    if (deleting || !isDeletionConfirmed(confirmText)) return;
    setDeleting(true);
    try {
      await deleteOwnAccount();
      await onDeleted();
    } catch {
      Alert.alert(
        'Could not delete your account',
        'Something went wrong. Please check your connection and try again.',
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>🔒</Text>
        </View>

        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>

        {until && (
          <View style={styles.untilBox}>
            <Text style={styles.untilLabel}>Access returns on</Text>
            <Text style={styles.untilValue}>{until}</Text>
          </View>
        )}

        <Text style={styles.contact}>
          If you think this is a mistake, contact us at{' '}
          <Text style={styles.link} onPress={() => Linking.openURL(`mailto:${support}`)}>
            {support}
          </Text>
          .
        </Text>

        <View style={styles.links}>
          <TouchableOpacity onPress={() => Linking.openURL(LEGAL.privacy)}>
            <Text style={styles.linkRow}>Privacy Policy</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL(LEGAL.terms)}>
            <Text style={styles.linkRow}>Terms of Use</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL(LEGAL.guidelines)}>
            <Text style={styles.linkRow}>Community Guidelines</Text>
          </TouchableOpacity>
        </View>

        {/* Account deletion stays available. This is deliberate and required:
            a restricted account must never become one the student cannot leave. */}
        {!deleteOpen ? (
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => setDeleteOpen(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={styles.deleteText}>Delete my account</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.deleteBox}>
            <Text style={styles.deleteTitle}>Delete your account permanently?</Text>
            <Text style={styles.deleteBody}>
              This cannot be undone. Type {DELETE_CONFIRMATION_WORD} to confirm.
            </Text>
            <TextInput
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deleting}
              placeholder={DELETE_CONFIRMATION_WORD}
              placeholderTextColor="#9CA3AF"
              style={styles.deleteInput}
            />
            <TouchableOpacity
              style={[
                styles.deleteConfirmBtn,
                (!isDeletionConfirmed(confirmText) || deleting) && styles.disabled,
              ]}
              onPress={handleDelete}
              disabled={!isDeletionConfirmed(confirmText) || deleting}
              activeOpacity={0.7}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.deleteConfirmText}>Delete permanently</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setDeleteOpen(false);
                setConfirmText('');
              }}
              disabled={deleting}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={handleSignOut}
          disabled={signingOut}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          {signingOut ? (
            <ActivityIndicator size="small" color="#111827" />
          ) : (
            <Text style={styles.signOutText}>Sign out</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FEFCF0' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  badge: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  badgeText: { fontSize: 26 },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    lineHeight: 27,
  },
  body: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 21,
    color: '#6B7280',
    textAlign: 'center',
  },
  untilBox: {
    marginTop: 18,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  untilLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#9CA3AF' },
  untilValue: { marginTop: 4, fontSize: 15, fontWeight: '600', color: '#111827' },
  contact: {
    marginTop: 20,
    fontSize: 13,
    lineHeight: 20,
    color: '#6B7280',
    textAlign: 'center',
  },
  link: { color: '#0FA6A6', fontWeight: '600' },
  links: { marginTop: 22, gap: 10, alignItems: 'center' },
  linkRow: { fontSize: 13, color: '#0FA6A6', fontWeight: '600' },
  deleteBtn: {
    marginTop: 28,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#F02719',
    alignItems: 'center',
  },
  deleteText: { fontSize: 14, fontWeight: '700', color: '#F02719' },
  signOutBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
  },
  signOutText: { fontSize: 14, fontWeight: '700', color: '#111827' },
  deleteBox: {
    marginTop: 28,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    gap: 10,
  },
  deleteTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  deleteBody: { fontSize: 13, lineHeight: 19, color: '#6B7280' },
  deleteInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  deleteConfirmBtn: {
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: '#F02719',
    alignItems: 'center',
  },
  deleteConfirmText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  disabled: { opacity: 0.5 },
  cancelText: { fontSize: 13, color: '#6B7280', textAlign: 'center', paddingVertical: 4 },
});
