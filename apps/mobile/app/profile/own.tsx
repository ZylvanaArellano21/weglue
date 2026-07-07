import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import {
  useOwnProfile,
  useOwnClubsList,
  useOwnGluematesList,
  useOwnThisWeekEvents,
  useOwnPosts,
  useRemoveEventRsvp,
} from '../../hooks/useOwnProfile';
import { Avatar } from '../../components/shared/Avatar';
import { ProfileScreenHeader } from '../../components/profile/ProfileScreenHeader';
import { InterestsLine } from '../../components/profile/InterestsLine';
import { ShowMoreSheet } from '../../components/profile/ShowMoreSheet';
import { SwipeableDeleteRow } from '../../components/profile/SwipeableDeleteRow';
import { ProfileConfirmationModal } from '../../components/profile/ProfileConfirmationModal';
import { profileColors, profileFonts, profileCardShadow } from '../../components/profile/profileTheme';
import type { CalendarEvent, CalendarSection } from '../../services/calendarService';
import type { UserPost } from '../../services/followService';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_ITEM_SIZE = (SCREEN_WIDTH - 32 - 8) / 3;
const ROLES_CAP = 2;

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

function flattenSections(sections: CalendarSection[] | undefined): CalendarEvent[] {
  return (sections ?? []).flatMap((s) => s.data);
}

export default function OwnProfileScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data: profile, isLoading: profileLoading } = useOwnProfile(userId);
  const { data: clubs } = useOwnClubsList(userId, true);
  const { data: gluemates } = useOwnGluematesList(userId, true);
  const { data: thisWeek } = useOwnThisWeekEvents(userId);
  const { data: postsData, fetchNextPage, hasNextPage, isFetchingNextPage } = useOwnPosts(userId);
  const removeRsvp = useRemoveEventRsvp(userId);

  const [activeTab, setActiveTab] = useState<ProfileTab>('posts');
  const [rolesSheetOpen, setRolesSheetOpen] = useState(false);
  const [clubsSheetOpen, setClubsSheetOpen] = useState(false);
  const [gluematesSheetOpen, setGluematesSheetOpen] = useState(false);
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);

  const onEditProfile = () => router.push('/profile/edit-profile' as any);
  const onEditInterests = () => router.push('/profile/edit-interests' as any);
  const onEditActivities = () => router.push('/profile/edit-activities' as any);
  const onEditProfilePic = () => router.push('/profile/edit-profile-pic' as any);

  const allPosts = postsData?.pages.flatMap((p) => p) ?? [];
  const weekEvents = flattenSections(thisWeek);

  const interests = profile?.interests ?? [];
  const roles = profile?.club_roles ?? [];
  const showMoreRoles = roles.length > ROLES_CAP;
  const visibleRoles = roles.slice(0, ROLES_CAP);

  const handleConfirmRemoveRsvp = async () => {
    if (!deleteEventId) return;
    await removeRsvp.mutateAsync(deleteEventId);
    setDeleteEventId(null);
  };

  if (profileLoading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator size="large" color={profileColors.teal} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileScreenHeader title="Your Profile" onBack={() => router.back()} />

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.body}>
          {/* Avatar + stats */}
          <View style={styles.profileRow}>
            <TouchableOpacity onPress={onEditProfilePic} activeOpacity={0.8}>
              <Avatar uri={profile?.avatar_url} size={72} username={profile?.username} />
            </TouchableOpacity>
            <View style={styles.statsCol}>
              <Text style={styles.name}>{profile?.full_name}</Text>
              <View style={styles.statsRow}>
                <TouchableOpacity
                  style={styles.stat}
                  onPress={() => setClubsSheetOpen(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.statValue}>{profile?.clubs_count ?? 0}</Text>
                  <Text style={styles.statLabel}>Clubs</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.stat}
                  onPress={() => setGluematesSheetOpen(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.statValue}>{profile?.gluemates_count ?? 0}</Text>
                  <Text style={styles.statLabel}>Gluemates</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Interests — first 5, inline Show more / Show less */}
          <InterestsLine interests={interests} />

          {/* Officer roles */}
          {roles.length > 0 && (
            <View style={styles.rolesSection}>
              {visibleRoles.map((role) => (
                <TouchableOpacity
                  key={role.club_id}
                  onPress={() =>
                    router.push({
                      pathname: '/(tabs)/clubs/[clubId]',
                      params: { clubId: role.club_id },
                    } as any)
                  }
                  activeOpacity={0.7}
                  style={styles.roleRow}
                >
                  <Text style={styles.roleClub}>@{role.club_name}</Text>
                  <Text style={styles.roleTitle}>{role.role_title}</Text>
                </TouchableOpacity>
              ))}
              {showMoreRoles && (
                <TouchableOpacity onPress={() => setRolesSheetOpen(true)} activeOpacity={0.7}>
                  <Text style={styles.showMore}>Show more</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Edit Profile */}
          <TouchableOpacity style={styles.editBtn} onPress={onEditProfile} activeOpacity={0.85}>
            <Text style={styles.editBtnText}>Edit Profile</Text>
          </TouchableOpacity>

          {/* Tabs */}
          <View style={styles.tabs}>
            {(['posts', 'weekly_events'] as ProfileTab[]).map((tab) => (
              <TouchableOpacity
                key={tab}
                onPress={() => setActiveTab(tab)}
                activeOpacity={0.7}
                style={[
                  styles.tab,
                  activeTab === tab && styles.tabActive,
                ]}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                  {tab === 'posts' ? 'Posts' : 'Weekly Events'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Posts grid */}
          {activeTab === 'posts' && (
            <View style={styles.tabContent}>
              {allPosts.length === 0 ? (
                <Text style={styles.empty}>No posts yet.</Text>
              ) : (
                <View style={styles.grid}>
                  {allPosts.map((post: UserPost) =>
                    post.image_url ? (
                      <TouchableOpacity
                        key={post.id}
                        activeOpacity={0.85}
                        onPress={() =>
                          router.push({
                            pathname: '/profile/post-viewer',
                            params: { userId: userId!, postId: post.id },
                          } as any)
                        }
                      >
                        <Image
                          source={{ uri: post.image_url }}
                          style={styles.gridItem}
                          resizeMode="cover"
                        />
                      </TouchableOpacity>
                    ) : null,
                  )}
                </View>
              )}
              {hasNextPage && (
                <TouchableOpacity
                  onPress={() => fetchNextPage()}
                  style={styles.loadMore}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? (
                    <ActivityIndicator color={profileColors.teal} />
                  ) : (
                    <Text style={styles.showMore}>Load more</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Weekly events — swipe to delete */}
          {activeTab === 'weekly_events' && (
            <View style={styles.tabContent}>
              {weekEvents.length === 0 ? (
                <Text style={styles.empty}>No upcoming events this week.</Text>
              ) : (
                weekEvents.map((event) => (
                  <SwipeableDeleteRow
                    key={event.id}
                    onDelete={() => setDeleteEventId(event.id)}
                  >
                    <WeeklyEventCard
                      event={event}
                      onPress={() =>
                        // Generic event-detail screen: takes an eventId and its
                        // back arrow returns here (the calendar variant expects
                        // date/initialEventId and routes back to the Calendar tab).
                        router.push({
                          pathname: '/home/event-detail',
                          params: { eventId: event.id },
                        } as any)
                      }
                    />
                  </SwipeableDeleteRow>
                ))
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Roles sheet */}
      <ShowMoreSheet
        visible={rolesSheetOpen}
        title="Officer Roles"
        onClose={() => setRolesSheetOpen(false)}
      >
        {roles.map((role) => (
          <View key={role.club_id} style={styles.sheetRoleRow}>
            <Text style={styles.roleClub}>@{role.club_name}</Text>
            <Text style={styles.roleTitle}>{role.role_title}</Text>
          </View>
        ))}
      </ShowMoreSheet>

      {/* Clubs sheet */}
      <ShowMoreSheet
        visible={clubsSheetOpen}
        title="Your Clubs"
        onClose={() => setClubsSheetOpen(false)}
      >
        {(clubs ?? []).length === 0 && (
          <Text style={styles.empty}>No clubs yet.</Text>
        )}
        {(clubs ?? []).map((club) => (
          <TouchableOpacity
            key={club.club_id}
            onPress={() => {
              setClubsSheetOpen(false);
              router.push({
                pathname: '/(tabs)/clubs/[clubId]',
                params: { clubId: club.club_id },
              } as any);
            }}
            style={styles.sheetRoleRow}
          >
            <Text style={styles.roleClub}>{club.club_name}</Text>
            <Text style={styles.roleTitle}>{club.role}</Text>
          </TouchableOpacity>
        ))}
      </ShowMoreSheet>

      {/* Gluemates sheet */}
      <ShowMoreSheet
        visible={gluematesSheetOpen}
        title="Gluemates"
        onClose={() => setGluematesSheetOpen(false)}
      >
        {(gluemates ?? []).map((mate) => (
          <TouchableOpacity
            key={mate.user_id}
            onPress={() => {
              setGluematesSheetOpen(false);
              router.push({ pathname: '/profile/[userId]', params: { userId: mate.user_id } } as any);
            }}
            style={styles.sheetMateRow}
          >
            <Avatar uri={mate.avatar_url} size={36} username={mate.username} />
            <View>
              <Text style={styles.mateName}>{mate.full_name}</Text>
              <Text style={styles.mateUsername}>@{mate.username}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ShowMoreSheet>

      <ProfileConfirmationModal
        visible={deleteEventId !== null}
        title="Remove event?"
        message="If you delete this, your attendance will be removed as well."
        confirmLabel="Continue"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleConfirmRemoveRsvp}
        onCancel={() => setDeleteEventId(null)}
        loading={removeRsvp.isPending}
      />
    </SafeAreaView>
  );
}

function WeeklyEventCard({
  event,
  onPress,
}: {
  event: CalendarEvent;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.eventCard}>
      <View style={styles.eventThumb}>
        {event.cover_image_url ? (
          <Image source={{ uri: event.cover_image_url }} style={styles.eventThumbImg} />
        ) : (
          <Ionicons name="calendar-outline" size={24} color={profileColors.textLight} />
        )}
      </View>
      <View style={styles.eventInfo}>
        <Text style={styles.eventTitle} numberOfLines={1}>
          {event.emoji ? `${event.emoji} ` : ''}{event.title}
        </Text>
        <Text style={styles.eventClub} numberOfLines={1}>{event.club.name}</Text>
        <Text style={styles.eventMeta}>{formatDate(event.event_date)}</Text>
        <Text style={styles.eventMeta}>
          {formatTime(event.start_time)} - {formatTime(event.end_time)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={profileColors.textLight} style={{ marginRight: 12 }} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: profileColors.bg },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: profileColors.bg,
  },
  body: { paddingHorizontal: 16, paddingBottom: 32 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 16 },
  statsCol: { flex: 1 },
  name: {
    fontFamily: profileFonts.bold,
    fontSize: 17,
    color: profileColors.textDark,
    marginBottom: 8,
  },
  statsRow: { flexDirection: 'row', gap: 28 },
  stat: { alignItems: 'center' },
  statValue: {
    fontFamily: profileFonts.bold,
    fontSize: 17,
    color: profileColors.textDark,
  },
  statLabel: {
    fontFamily: profileFonts.regular,
    fontSize: 12,
    color: profileColors.textLight,
  },
  showMore: {
    fontFamily: profileFonts.medium,
    fontSize: 13,
    color: profileColors.teal,
    marginTop: 4,
  },
  rolesSection: { marginBottom: 16 },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  roleClub: {
    fontFamily: profileFonts.semiBold,
    fontSize: 13,
    color: profileColors.teal,
  },
  roleTitle: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textLight,
  },
  editBtn: {
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 1.5,
    borderColor: profileColors.teal,
    alignItems: 'center',
    marginBottom: 20,
  },
  editBtnText: {
    fontFamily: profileFonts.semiBold,
    fontSize: 15,
    color: profileColors.teal,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: profileColors.border,
    marginBottom: 12,
  },
  tab: {
    paddingBottom: 10,
    marginRight: 20,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: profileColors.textDark },
  tabText: {
    fontFamily: profileFonts.regular,
    fontSize: 15,
    color: profileColors.textLight,
  },
  tabTextActive: {
    fontFamily: profileFonts.bold,
    color: profileColors.textDark,
  },
  tabContent: { minHeight: 120 },
  empty: {
    textAlign: 'center',
    color: profileColors.textLight,
    fontFamily: profileFonts.regular,
    paddingVertical: 32,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  gridItem: {
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
    borderRadius: 6,
    backgroundColor: profileColors.border,
  },
  loadMore: { padding: 12, alignItems: 'center' },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    ...profileCardShadow,
  },
  eventThumb: {
    width: 70,
    height: 70,
    backgroundColor: profileColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventThumbImg: { width: 70, height: 70 },
  eventInfo: { flex: 1, paddingHorizontal: 12, paddingVertical: 10 },
  eventTitle: {
    fontFamily: profileFonts.bold,
    fontSize: 14,
    color: profileColors.textDark,
    marginBottom: 2,
  },
  eventClub: {
    fontFamily: profileFonts.medium,
    fontSize: 12,
    color: profileColors.teal,
    marginBottom: 4,
  },
  eventMeta: {
    fontFamily: profileFonts.regular,
    fontSize: 11,
    color: profileColors.textMuted,
  },
  sheetRoleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  sheetMateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  mateName: {
    fontFamily: profileFonts.semiBold,
    fontSize: 14,
    color: profileColors.textDark,
  },
  mateUsername: {
    fontFamily: profileFonts.regular,
    fontSize: 12,
    color: profileColors.textMuted,
  },
});
