import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  FlatList,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import {
  useUserProfile,
  useUserPosts,
  useUserWeeklyEvents,
  useUserClubsList,
  useUserGluematesList,
  useFollowMutation,
} from '../../hooks/useUserProfile';
import { Avatar } from '../../components/shared/Avatar';
import { Skeleton } from '../../components/shared/SkeletonLoader';
import { openReportFlow } from '../../components/shared/ReportButton';
import { InterestsLine } from '../../components/profile/InterestsLine';
import { OfficerClubTags } from '../../components/profile/OfficerClubTags';
import { ShowMoreSheet } from '../../components/profile/ShowMoreSheet';
import { useToast } from '../../components/Toast';
import type { UserWeeklyEvent } from '../../services/followService';
import { openDirectChatWith } from '../../lib/chatNavigation';
import { openProfile } from '../../lib/profileNavigation';
import { CarouselBadge } from '../../components/shared/PhotoCarousel';
import { useDidIBlock, useBlockUser, useUnblockUser } from '../../hooks/useBlocking';
import {
  confirmBlock,
  confirmUnblock,
  blockFailedAlert,
  blockSucceededAlert,
  UNAVAILABLE_TITLE,
  UNAVAILABLE_BODY,
  YOU_BLOCKED_TITLE,
  YOU_BLOCKED_BODY,
} from '../../lib/blockPrompts';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_ITEM_SIZE = (SCREEN_WIDTH - 32 - 8) / 3;

type ProfileTab = 'posts' | 'weekly_events';

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function UserProfileScreen() {
  const { userId: targetUserId } = useLocalSearchParams<{ userId: string }>();
  // Selector, not `useAuthStore()`: a bare destructure re-renders this screen
  // on every unrelated store field change, not just when the session changes.
  const viewerUserId = useAuthStore((s) => s.session?.user.id);
  const router = useRouter();
  const { show, ToastComponent } = useToast();

  const [activeTab, setActiveTab] = useState<ProfileTab>('posts');
  const [clubsSheetOpen, setClubsSheetOpen] = useState(false);
  const [gluematesSheetOpen, setGluematesSheetOpen] = useState(false);

  const { data: profile, isLoading: profileLoading } = useUserProfile(targetUserId, viewerUserId);
  const { mutate: followMutate, isPending: followPending } = useFollowMutation(viewerUserId, targetUserId);

  const isOwnProfile = targetUserId === viewerUserId;

  // Any path that lands here for the signed-in user (a deep link, a push
  // notification, a missed call site) belongs on canonical Your Profile with
  // full owner controls — not this public-shaped view. `replace` so Back skips
  // straight past it.
  useEffect(() => {
    if (isOwnProfile) router.replace('/profile/own');
  }, [isOwnProfile, router]);
  const isPublic = !profile?.is_private || profile?.follow_status === 'following';
  // Hide Events privacy: the owner always sees their own weekly events.
  // Also enforced server-side (event_rsvps RLS), this only drives the UI state.
  const eventsHidden = !isOwnProfile && (profile?.hide_events ?? false);

  const { data: postsData, fetchNextPage: fetchMorePosts, hasNextPage: hasMorePosts } = useUserPosts(
    targetUserId,
    activeTab === 'posts' && isPublic,
  );
  const { data: eventsData, fetchNextPage: fetchMoreEvents, hasNextPage: hasMoreEvents } = useUserWeeklyEvents(
    targetUserId,
    activeTab === 'weekly_events' && isPublic && !eventsHidden,
  );
  // Clubs list for THIS profile's user (not the viewer)
  const { data: profileClubs } = useUserClubsList(targetUserId, clubsSheetOpen);
  // Gluemates list respects privacy: only loads for public/followed profiles.
  const { data: profileGluemates } = useUserGluematesList(
    targetUserId,
    gluematesSheetOpen && (isPublic || isOwnProfile),
  );

  const allPosts = postsData?.pages.flatMap((p) => p) ?? [];
  const allEvents = eventsData?.pages.flatMap((p) => p) ?? [];

  // Blocking. `useDidIBlock` is only meaningful for a profile the viewer can
  // actually see — if the OTHER person did the blocking, this screen never
  // renders, so the query never runs and no direction is ever disclosed.
  const { data: iBlockedThem, isLoading: blockStateLoading } = useDidIBlock(viewerUserId, targetUserId);
  const blockMutation = useBlockUser(viewerUserId);
  const unblockMutation = useUnblockUser(viewerUserId);

  const handleBlock = () => {
    confirmBlock({
      username: profile?.username,
      fullName: profile?.full_name,
      onConfirm: () =>
        blockMutation.mutate(targetUserId!, {
          onSuccess: (result) => {
            if (result.status !== 'ok') {
              blockFailedAlert('block');
              return;
            }
            blockSucceededAlert(profile?.username, profile?.full_name);
            // The profile is now unreadable to this viewer by RLS, so staying
            // here would render the unavailable state. Leave instead.
            router.back();
          },
          onError: () => blockFailedAlert('block'),
        }),
    });
  };

  const handleUnblock = () => {
    confirmUnblock({
      username: profile?.username,
      fullName: profile?.full_name,
      onConfirm: () =>
        unblockMutation.mutate(targetUserId!, {
          onError: () => blockFailedAlert('unblock'),
        }),
    });
  };

  // One overflow menu for every safety action on another student's profile.
  const openProfileMenu = () => {
    const blocked = iBlockedThem === true;
    Alert.alert(
      profile?.username ? `@${profile.username}` : 'Options',
      undefined,
      [
        {
          text: 'Report',
          onPress: () =>
            openReportFlow({
              entityType: 'user',
              entityId: targetUserId!,
              entityName: profile?.username ? `@${profile.username}` : profile?.full_name,
              // Offered only when not already blocked; blocking runs first so
              // the student is protected even if the report request fails.
              onBlock: blocked
                ? undefined
                : () =>
                    blockMutation.mutate(targetUserId!, {
                      onSuccess: () => router.back(),
                      onError: () => blockFailedAlert('block'),
                    }),
            }),
        },
        blocked
          ? { text: 'Unblock', onPress: handleUnblock }
          : { text: 'Block', style: 'destructive' as const, onPress: handleBlock },
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  };

  const handleFollow = () => {
    // Tapping "Requested" cancels the pending request; "Following"/"Gluemate"
    // unfollows; "Follow" follows (or sends a request to a private account).
    const action = profile?.follow_status === 'not_following' ? 'follow' : 'unfollow';
    followMutate(
      { action },
      {
        onSuccess: () =>
          show(
            action === 'follow'
              ? profile?.is_private
                ? 'Follow request sent!'
                : 'Following! 🎉'
              : profile?.follow_status === 'pending'
              ? 'Request canceled.'
              : 'Unfollowed.',
          ),
        onError: () => show('Something went wrong.', 'error'),
      },
    );
  };

  // Wait for the directional block state too when there is no readable profile,
  // otherwise the blocker briefly sees the generic unavailable state before the
  // Unblock affordance appears.
  if (profileLoading || (!profile && blockStateLoading)) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={26} color="#111827" />
          </TouchableOpacity>
        </View>
        <View style={{ padding: 16, gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Skeleton width={70} height={70} borderRadius={35} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton width={140} height={18} />
              <Skeleton width={100} height={14} />
            </View>
          </View>
          <Skeleton width="100%" height={44} borderRadius={22} />
        </View>
      </SafeAreaView>
    );
  }

  // OUTCOME B — the viewer CREATED the block. `current_user_blocks` is
  // directional and true only for the person who blocked, so the blocked party
  // can never reach this branch. It exists so the blocker keeps a way to undo
  // their own action when they arrive from a shared context (club member list,
  // group participant list, an old message) instead of hitting a dead end.
  // No posts, weekly events, Follow or Message controls are rendered, and RLS
  // would refuse them anyway.
  if (!profile && iBlockedThem === true) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
        {ToastComponent}
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 16 }} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ color: '#111827', fontSize: 16, fontWeight: '700', textAlign: 'center' }}>
            {YOU_BLOCKED_TITLE}
          </Text>
          <Text style={{ color: '#6B7280', fontSize: 14, marginTop: 6, textAlign: 'center' }}>
            {YOU_BLOCKED_BODY}
          </Text>
          <TouchableOpacity
            onPress={handleUnblock}
            disabled={unblockMutation.isPending}
            activeOpacity={0.85}
            style={{
              marginTop: 24,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: '#0FA6A6',
              paddingHorizontal: 22,
              paddingVertical: 10,
              opacity: unblockMutation.isPending ? 0.6 : 1,
            }}
          >
            <Text style={{ color: '#0FA6A6', fontSize: 14, fontWeight: '700' }}>
              {unblockMutation.isPending ? 'Unblocking…' : 'Unblock'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // OUTCOME A — the viewer WAS blocked, or the account is deleted, or the id
  // never existed. Deliberately identical copy for all three, so the state
  // itself cannot disclose which occurred and can never reveal that this
  // specific person blocked the viewer. No Unblock is offered, because the
  // viewer has nothing to unblock.
  if (!profile) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 16 }} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#111827', fontSize: 16, fontWeight: '700' }}>
            {UNAVAILABLE_TITLE}
          </Text>
          <Text style={{ color: '#6B7280', fontSize: 14, marginTop: 6 }}>
            {UNAVAILABLE_BODY}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const followButtonLabel =
    profile.follow_status === 'following'
      ? profile.is_gluemate
        ? 'Gluemate'
        : 'Following'
      : profile.follow_status === 'pending'
      ? 'Requested'
      : 'Follow';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {ToastComponent}
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header nav */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}>
            <Ionicons name="chevron-back" size={26} color="#111827" />
          </TouchableOpacity>
          <Text
            style={{
              flex: 1,
              fontSize: 18,
              fontWeight: '700',
              color: '#111827',
              fontFamily: 'Zain_700Bold',
              marginLeft: 8,
            }}
            numberOfLines={1}
          >
            {profile.full_name}
          </Text>
          {/* Safety menu (Report / Block) — other people's profiles only */}
          {!isOwnProfile && (
            <TouchableOpacity
              onPress={openProfileMenu}
              activeOpacity={0.7}
              hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Profile options"
            >
              <Ionicons name="ellipsis-horizontal" size={22} color="#6B7280" />
            </TouchableOpacity>
          )}
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          {/* Avatar + Stats */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 16 }}>
            <Avatar uri={profile.avatar_url} size={72} username={profile.username} />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 17,
                  fontWeight: '700',
                  color: '#111827',
                  fontFamily: 'Inter_700Bold',
                  marginBottom: 8,
                }}
              >
                {profile.full_name}
              </Text>
              <View style={{ flexDirection: 'row', gap: 28 }}>
                <TouchableOpacity
                  style={{ alignItems: 'center' }}
                  onPress={() => setClubsSheetOpen(true)}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 17, fontWeight: '700', color: '#111827', fontFamily: 'Inter_700Bold' }}>
                    {profile.clubs_count}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#9CA3AF', fontFamily: 'Inter_400Regular' }}>
                    Clubs
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ alignItems: 'center' }}
                  onPress={() => {
                    // Privacy: the gluemates list of a private account stays
                    // hidden until the viewer follows them.
                    if (isPublic || isOwnProfile) setGluematesSheetOpen(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 17, fontWeight: '700', color: '#111827', fontFamily: 'Inter_700Bold' }}>
                    {profile.gluemates_count}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#9CA3AF', fontFamily: 'Inter_400Regular' }}>
                    Gluemates
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Interests — first 5, inline Show more / Show less.
              Hidden interests come back empty from RLS, so nothing renders. */}
          <InterestsLine interests={profile.interests} />

          {/* Club Roles — up to 3, then "+N more" expands the card in place */}
          <OfficerClubTags
            roles={profile.club_roles}
            onOpenClub={(clubId) =>
              router.push({ pathname: '/club/[clubId]', params: { clubId } })
            }
          />

          {/* Action Buttons — only shown when not own profile */}
          {!isOwnProfile && (
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
              {/* Follow button */}
              <TouchableOpacity
                onPress={handleFollow}
                disabled={followPending}
                activeOpacity={0.85}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 25,
                  backgroundColor:
                    profile.follow_status === 'following' || profile.follow_status === 'pending'
                      ? 'transparent'
                      : '#0FA6A6',
                  borderWidth:
                    profile.follow_status === 'following' || profile.follow_status === 'pending' ? 1.5 : 0,
                  borderColor: '#0FA6A6',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {followPending ? (
                  <ActivityIndicator size="small" color="#0FA6A6" />
                ) : (
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '600',
                      color:
                        profile.follow_status === 'following' || profile.follow_status === 'pending'
                          ? '#0FA6A6'
                          : '#fff',
                      fontFamily: 'Inter_600SemiBold',
                    }}
                  >
                    {followButtonLabel}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Message button */}
              <TouchableOpacity
                onPress={() => { void openDirectChatWith(targetUserId!); }}
                disabled={profile.is_private && profile.follow_status !== 'following'}
                activeOpacity={0.85}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 25,
                  backgroundColor: 'transparent',
                  borderWidth: 1.5,
                  borderColor:
                    profile.is_private && profile.follow_status !== 'following' ? '#D1D5DB' : '#0FA6A6',
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: '600',
                    color:
                      profile.is_private && profile.follow_status !== 'following' ? '#9CA3AF' : '#0FA6A6',
                    fontFamily: 'Inter_600SemiBold',
                  }}
                >
                  Message
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Private Account — no tabs, lock icon. The copy tracks the
              request state: not following → invite to follow; requested →
              confirm the request was sent and what happens on accept. */}
          {profile.is_private && profile.follow_status !== 'following' && !isOwnProfile ? (
            <View style={{ alignItems: 'center', paddingVertical: 48, gap: 12 }}>
              <Ionicons name="lock-closed-outline" size={48} color="#9CA3AF" />
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: '600',
                  color: '#374151',
                  fontFamily: 'Inter_600SemiBold',
                }}
              >
                This account is private
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: '#9CA3AF',
                  textAlign: 'center',
                  fontFamily: 'Inter_400Regular',
                  paddingHorizontal: 24,
                }}
              >
                {profile.follow_status === 'pending'
                  ? "Follow request sent. You'll see their posts and events if they accept."
                  : 'Follow to see their posts and events.'}
              </Text>
            </View>
          ) : (
            <>
              {/* Tab Switcher */}
              <View
                style={{
                  flexDirection: 'row',
                  borderBottomWidth: 1,
                  borderBottomColor: '#E5E7EB',
                  marginBottom: 12,
                }}
              >
                {(['posts', 'weekly_events'] as ProfileTab[]).map((tab) => (
                  <TouchableOpacity
                    key={tab}
                    onPress={() => setActiveTab(tab)}
                    activeOpacity={0.7}
                    style={{
                      paddingBottom: 10,
                      marginRight: 20,
                      borderBottomWidth: 2,
                      borderBottomColor: activeTab === tab ? '#111827' : 'transparent',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: activeTab === tab ? '700' : '400',
                        color: activeTab === tab ? '#111827' : '#9CA3AF',
                        fontFamily: activeTab === tab ? 'Inter_700Bold' : 'Inter_400Regular',
                      }}
                    >
                      {tab === 'posts' ? 'Posts' : 'Weekly Events'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Posts Tab — 3 column grid */}
              {activeTab === 'posts' && (
                <View>
                  {allPosts.length === 0 ? (
                    <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                      <Text style={{ color: '#9CA3AF', fontSize: 14, fontFamily: 'Inter_400Regular' }}>
                        No posts yet.
                      </Text>
                    </View>
                  ) : (
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        gap: 4,
                        marginBottom: 32,
                      }}
                    >
                      {allPosts.map((post) =>
                        post.image_url ? (
                          <TouchableOpacity
                            key={post.id}
                            activeOpacity={0.85}
                            onPress={() =>
                              router.push({
                                pathname: '/profile/post-viewer',
                                params: { userId: targetUserId!, postId: post.id },
                              } as any)
                            }
                          >
                            <Image
                              source={{ uri: post.image_url }}
                              style={{
                                width: GRID_ITEM_SIZE,
                                height: GRID_ITEM_SIZE,
                                borderRadius: 6,
                                backgroundColor: '#E5E7EB',
                              }}
                              resizeMode="cover"
                            />
                            {post.image_count > 1 ? <CarouselBadge /> : null}
                          </TouchableOpacity>
                        ) : null,
                      )}
                      {hasMorePosts && (
                        <TouchableOpacity
                          onPress={() => fetchMorePosts()}
                          style={{ width: '100%', padding: 12, alignItems: 'center' }}
                        >
                          <Text style={{ color: '#0FA6A6', fontFamily: 'Inter_500Medium' }}>
                            Load more
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              )}

              {/* Weekly Events Tab */}
              {activeTab === 'weekly_events' && (
                <View style={{ marginBottom: 32 }}>
                  {eventsHidden ? (
                    <View style={{ alignItems: 'center', paddingVertical: 40, gap: 10 }}>
                      <Ionicons name="lock-closed-outline" size={36} color="#9CA3AF" />
                      <Text style={{ color: '#9CA3AF', fontSize: 14, fontFamily: 'Inter_400Regular' }}>
                        Weekly events are private.
                      </Text>
                    </View>
                  ) : allEvents.length === 0 ? (
                    <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                      <Text style={{ color: '#9CA3AF', fontSize: 14, fontFamily: 'Inter_400Regular' }}>
                        No upcoming events.
                      </Text>
                    </View>
                  ) : (
                    allEvents.map((event) => (
                      <WeeklyEventRow key={event.id} event={event} />
                    ))
                  )}
                  {hasMoreEvents && (
                    <TouchableOpacity
                      onPress={() => fetchMoreEvents()}
                      style={{ padding: 12, alignItems: 'center' }}
                    >
                      <Text style={{ color: '#0FA6A6', fontFamily: 'Inter_500Medium' }}>
                        Load more
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* Gluemates sheet — the mutual follows of THIS profile's user.
          Tapping a row opens that gluemate's profile; back returns here. */}
      <ShowMoreSheet
        visible={gluematesSheetOpen}
        title={isOwnProfile ? 'Gluemates' : `${profile.full_name}'s Gluemates`}
        onClose={() => setGluematesSheetOpen(false)}
      >
        {(profileGluemates ?? []).length === 0 ? (
          <Text style={{ color: '#9CA3AF', fontSize: 14, fontFamily: 'Inter_400Regular' }}>
            No gluemates yet.
          </Text>
        ) : (
          (profileGluemates ?? []).map((mate) => (
            <TouchableOpacity
              key={mate.user_id}
              onPress={() => {
                setGluematesSheetOpen(false);
                openProfile(router, mate.user_id, viewerUserId);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}
              activeOpacity={0.7}
            >
              <Avatar uri={mate.avatar_url} size={36} username={mate.username} />
              <View>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827', fontFamily: 'Inter_600SemiBold' }}>
                  {mate.full_name}
                </Text>
                <Text style={{ fontSize: 12, color: '#6B7280', fontFamily: 'Inter_400Regular' }}>
                  @{mate.username}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ShowMoreSheet>

      {/* Clubs sheet — the clubs THIS profile's user is part of */}
      <ShowMoreSheet
        visible={clubsSheetOpen}
        title={isOwnProfile ? 'Your Clubs' : `${profile.full_name}'s Clubs`}
        onClose={() => setClubsSheetOpen(false)}
      >
        {(profileClubs ?? []).length === 0 ? (
          <Text style={{ color: '#9CA3AF', fontSize: 14, fontFamily: 'Inter_400Regular' }}>
            No clubs yet.
          </Text>
        ) : (
          (profileClubs ?? []).map((club) => (
            <TouchableOpacity
              key={club.club_id}
              onPress={() => {
                if (!club.club_id) return;
                setClubsSheetOpen(false);
                router.push({
                  pathname: '/club/[clubId]',
                  params: { clubId: club.club_id },
                } as any);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}
            >
              <Text style={{ fontSize: 13, color: '#0FA6A6', fontWeight: '600', fontFamily: 'Inter_600SemiBold' }}>
                {club.club_name}
              </Text>
              <Text style={{ fontSize: 13, color: '#9CA3AF', fontFamily: 'Inter_400Regular' }}>
                {club.role}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </ShowMoreSheet>
    </SafeAreaView>
  );
}

function WeeklyEventRow({ event }: { event: UserWeeklyEvent }) {
  const router = useRouter();

  return (
    <TouchableOpacity
      onPress={() =>
        router.push({ pathname: '/home/event-detail', params: { eventId: event.id } })
      }
      activeOpacity={0.7}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 12,
        marginBottom: 10,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
      }}
    >
      {/* Thumbnail */}
      <View style={{ width: 70, height: 70, backgroundColor: '#E5E7EB' }}>
        {event.cover_image_url ? (
          <Image
            source={{ uri: event.cover_image_url }}
            style={{ width: 70, height: 70 }}
            resizeMode="cover"
          />
        ) : (
          <View
            style={{
              width: 70,
              height: 70,
              backgroundColor: '#E5E7EB',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="calendar-outline" size={24} color="#9CA3AF" />
          </View>
        )}
      </View>

      {/* Info */}
      <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10 }}>
        <Text
          style={{
            fontSize: 14,
            fontWeight: '700',
            color: '#111827',
            fontFamily: 'Inter_700Bold',
            marginBottom: 2,
          }}
          numberOfLines={1}
        >
          {event.emoji ? `${event.emoji} ` : ''}{event.title}
        </Text>
        <Text
          style={{
            fontSize: 12,
            color: '#0FA6A6',
            fontFamily: 'Inter_500Medium',
            marginBottom: 4,
          }}
          numberOfLines={1}
        >
          {event.club.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <Ionicons name="calendar-outline" size={11} color="#9CA3AF" />
          <Text style={{ fontSize: 11, color: '#6B7280', fontFamily: 'Inter_400Regular' }}>
            {formatDate(event.event_date)}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <Text style={{ fontSize: 11, color: '#6B7280', fontFamily: 'Inter_400Regular', paddingLeft: 15 }}>
            {formatTime(event.start_time)} - {formatTime(event.end_time)}
          </Text>
        </View>
        {event.location && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="location-outline" size={11} color="#9CA3AF" />
            <Text style={{ fontSize: 11, color: '#6B7280', fontFamily: 'Inter_400Regular' }} numberOfLines={1}>
              {event.location}
            </Text>
          </View>
        )}
      </View>

      {/* Chevron */}
      <Ionicons name="chevron-forward" size={18} color="#9CA3AF" style={{ marginRight: 12 }} />
    </TouchableOpacity>
  );
}
