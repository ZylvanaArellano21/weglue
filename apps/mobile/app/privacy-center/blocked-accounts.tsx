import { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { ProfileScreenHeader } from '../../components/profile/ProfileScreenHeader';
import { Avatar } from '../../components/shared/Avatar';
import { profileColors, profileFonts } from '../../components/profile/profileTheme';
import { useBlockedUsers, useUnblockUser } from '../../hooks/useBlocking';
import {
  confirmUnblock,
  blockFailedAlert,
  BLOCKED_EMPTY_TITLE,
  BLOCKED_EMPTY_BODY,
} from '../../lib/blockPrompts';
import type { BlockedUser } from '../../services/blockService';

// ─── Settings → Blocked Accounts (iOS + Android, one implementation) ─────────
//
// PRIVACY PROPERTY OF THIS SCREEN: it is the ONLY place a block is ever
// visible, and it shows only blocks the signed-in student OWNS. That is not a
// UI decision — `get_my_blocked_users()` scopes to auth.uid() inside the
// function body, and the `user_blocks` SELECT policy is `blocker_id =
// auth.uid()`, so there is no request this screen could make that would reveal
// who has blocked the viewer.
//
// Rows deliberately do NOT link to the blocked profile: that route resolves to
// the neutral unavailable state anyway, so a tap would look broken.

export default function BlockedAccountsScreen() {
  const router = useRouter();
  const { session } = useAuthStore();
  const userId = session?.user.id;

  const { data, isLoading, isError, refetch, isRefetching } = useBlockedUsers(userId);
  const unblock = useUnblockUser(userId);

  const onUnblock = useCallback(
    (item: BlockedUser) => {
      confirmUnblock({
        username: item.username,
        fullName: item.full_name,
        onConfirm: () => {
          unblock.mutate(item.user_id, {
            onError: () => blockFailedAlert('unblock'),
          });
        },
      });
    },
    [unblock],
  );

  const renderItem = useCallback(
    ({ item }: { item: BlockedUser }) => {
      // Disable only the row being submitted, so one in-flight unblock cannot
      // freeze the whole list.
      const pending = unblock.isPending && unblock.variables === item.user_id;
      return (
        <View style={styles.row}>
          <Avatar uri={item.avatar_url} size={44} username={item.username} />
          <View style={styles.rowText}>
            <Text style={styles.rowName} numberOfLines={1}>
              {item.full_name?.trim() || item.username}
            </Text>
            <Text style={styles.rowHandle} numberOfLines={1}>
              @{item.username}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => onUnblock(item)}
            disabled={pending}
            activeOpacity={0.7}
            style={[styles.unblockBtn, pending && styles.unblockBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={`Unblock ${item.username}`}
          >
            {pending ? (
              <ActivityIndicator size="small" color={profileColors.teal} />
            ) : (
              <Text style={styles.unblockText}>Unblock</Text>
            )}
          </TouchableOpacity>
        </View>
      );
    },
    [onUnblock, unblock.isPending, unblock.variables],
  );

  return (
    <SafeAreaView style={styles.container}>
      <ProfileScreenHeader title="Blocked Accounts" onBack={() => router.back()} />

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={profileColors.teal} />
        </View>
      ) : isError ? (
        // Honest failure with a retry, never an empty list that would imply
        // "you have blocked nobody" when the request simply failed.
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Couldn’t load your blocked accounts</Text>
          <Text style={styles.emptyBody}>Check your connection and try again.</Text>
          <TouchableOpacity onPress={() => refetch()} style={styles.retryBtn} activeOpacity={0.7}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.user_id}
          renderItem={renderItem}
          contentContainerStyle={
            (data ?? []).length === 0 ? styles.emptyContainer : styles.listContainer
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={profileColors.teal}
            />
          }
          ListHeaderComponent={
            (data ?? []).length > 0 ? (
              <Text style={styles.listHeader}>
                People you’ve blocked can’t message you or find your profile. They aren’t told.
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>{BLOCKED_EMPTY_TITLE}</Text>
              <Text style={styles.emptyBody}>{BLOCKED_EMPTY_BODY}</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: profileColors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  listContainer: { padding: 20, paddingBottom: 40 },
  emptyContainer: { flexGrow: 1 },
  listHeader: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textMuted,
    marginBottom: 16,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  rowText: { flex: 1 },
  rowName: {
    fontFamily: profileFonts.bold,
    fontSize: 15,
    color: profileColors.textDark,
  },
  rowHandle: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textMuted,
    marginTop: 1,
  },
  unblockBtn: {
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: profileColors.teal,
  },
  unblockBtnDisabled: { opacity: 0.5 },
  unblockText: {
    fontFamily: profileFonts.bold,
    fontSize: 13,
    color: profileColors.teal,
  },
  emptyTitle: {
    fontFamily: profileFonts.bold,
    fontSize: 16,
    color: profileColors.textDark,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textMuted,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 19,
  },
  retryBtn: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: profileColors.teal,
  },
  retryText: { fontFamily: profileFonts.bold, fontSize: 14, color: profileColors.white },
});
