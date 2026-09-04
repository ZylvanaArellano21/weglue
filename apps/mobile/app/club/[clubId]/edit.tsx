import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Image,
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useAuthStore } from '@weglue/shared';
import { useOfficerStore } from '../../../store/officerStore';
import { useClubProfile } from '../../../hooks/useClubProfile';
import { useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '../../../components/shared/SkeletonLoader';
import { useToast } from '../../../components/Toast';
import { Avatar } from '../../../components/shared/Avatar';
import { AddOfficerSheet } from '../../../components/club/AddOfficerSheet';
import { pickImageForFeature } from '../../../lib/media/pickMedia';
import {
  updateClubProfile,
  updateClubGoals,
  addOfficer,
  removeOfficer,
  removePostFromClub,
  deleteClubPhotoEverywhere,
  deleteClubPost,
  type UpdateClubInput,
  type UniversityUser,
} from '../../../services/clubService';
import { deleteEvent } from '../../../services/eventService';
import { uploadImageToBucket } from '../../../lib/imageUpload';
import { invalidateClubDataEverywhere } from '../../../lib/clubCache';
import {
  parseMeetingSchedule,
  formatTime12h,
  toDbTime,
  dbTimeToDate,
  type MeetingSlot,
} from '../../../lib/meetingSchedule';
import type { ClubOfficer, ClubPhoto, ClubUpcomingEvent } from '../../../services/clubService';

export type EditClubParams = {
  clubId: string;
};

const SCREEN_WIDTH = Dimensions.get('window').width;
const PHOTO_SIZE = (SCREEN_WIDTH - 48 - 8) / 3;

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const CREAM = '#FEFCF0';
const TEAL = '#0FA6A6';
const MUTED = '#5F5D5D';
const INK = '#000000';

const INPUT_STYLE = {
  backgroundColor: '#fff',
  borderRadius: 12,
  borderWidth: 1,
  borderColor: '#E5E7EB',
  paddingHorizontal: 14,
  paddingVertical: 12,
  fontSize: 15,
  color: INK,
  fontFamily: 'Inter_400Regular',
} as const;

// ─── Section heading ──────────────────────────────────────────────────────────
function SectionTitle({ title }: { title: string }) {
  return (
    <Text
      style={{
        fontSize: 13,
        fontWeight: '700',
        color: '#9CA3AF',
        fontFamily: 'Inter_700Bold',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        marginTop: 28,
        marginBottom: 10,
      }}
    >
      {title}
    </Text>
  );
}

// ─── Input Field ──────────────────────────────────────────────────────────────
function InputField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text
        style={{
          fontSize: 13,
          color: '#374151',
          fontFamily: 'Inter_500Medium',
          marginBottom: 6,
        }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        multiline={multiline}
        maxLength={maxLength}
        style={{
          backgroundColor: '#fff',
          borderRadius: 12,
          borderWidth: 1,
          borderColor: '#E5E7EB',
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 15,
          color: INK,
          fontFamily: 'Inter_400Regular',
          minHeight: multiline ? 80 : undefined,
          textAlignVertical: multiline ? 'top' : undefined,
        }}
      />
    </View>
  );
}

// ─── Image Picker Row ─────────────────────────────────────────────────────────
function ImagePickerRow({
  label,
  uri,
  height,
  borderRadius,
  onPick,
  uploading,
}: {
  label: string;
  uri: string | null;
  height: number;
  borderRadius: number;
  onPick: () => void;
  uploading?: boolean;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 13, color: '#374151', fontFamily: 'Inter_500Medium', marginBottom: 6 }}>
        {label}
      </Text>
      <TouchableOpacity onPress={onPick} activeOpacity={0.8}>
        <View
          style={{
            width: '100%',
            height,
            borderRadius,
            backgroundColor: '#E5E7EB',
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {uri ? (
            <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : null}
          {uploading ? (
            <View
              style={{
                ...StyleSheet_absoluteFillObject,
                backgroundColor: 'rgba(0,0,0,0.4)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ActivityIndicator size="large" color="#fff" />
            </View>
          ) : (
            <View
              style={{
                position: 'absolute',
                bottom: 8,
                right: 8,
                backgroundColor: 'rgba(0,0,0,0.5)',
                borderRadius: 20,
                padding: 6,
              }}
            >
              <Ionicons name="camera-outline" size={18} color="#fff" />
            </View>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
}

// absoluteFill inline
const StyleSheet_absoluteFillObject = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

// ─── Learning Outcome Row ─────────────────────────────────────────────────────
function GoalInputRow({
  value,
  index,
  isAddRow,
  onChangeText,
  onRemove,
}: {
  value: string;
  index: number;
  isAddRow: boolean;
  onChangeText: (v: string) => void;
  onRemove?: () => void;
}) {
  const hasValue = value.trim().length > 0;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 3,
          backgroundColor: hasValue ? TEAL : 'transparent',
          borderWidth: hasValue ? 0 : 1.5,
          borderColor: TEAL,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {hasValue ? <Ionicons name="checkmark" size={12} color={CREAM} /> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={isAddRow ? 'Add another outcome...' : `Outcome ${index + 1}...`}
        placeholderTextColor={MUTED}
        maxLength={200}
        style={{ ...INPUT_STYLE, flex: 1, paddingVertical: 10 }}
      />
      {!isAddRow && onRemove ? (
        <TouchableOpacity onPress={onRemove} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close-circle" size={22} color={MUTED} />
        </TouchableOpacity>
      ) : (
        <View style={{ width: 22 }} />
      )}
    </View>
  );
}

// ─── Multi-day Meeting Schedule Editor ───────────────────────────────────────
// Clubs meet on multiple days: tap day chips to select days, then set each
// day's start/end with the same scroll-style (spinner) time picker used when
// creating events. Times always display as "1:00 PM" — never 13:00:00.
const DEFAULT_START = '15:00:00';
const DEFAULT_END = '16:00:00';

function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: MeetingSlot[];
  onChange: (next: MeetingSlot[]) => void;
}) {
  const [picker, setPicker] = useState<{ day: string; field: 'start' | 'end' } | null>(null);
  const [tempTime, setTempTime] = useState<Date>(new Date());

  const selectedDays = new Set(schedule.map((s) => s.day));

  function toggleDay(day: string) {
    if (selectedDays.has(day)) {
      onChange(schedule.filter((s) => s.day !== day));
    } else {
      // New days copy the last row's times so multi-day clubs with one
      // shared time only pick it once.
      const template = schedule[schedule.length - 1];
      const next = [
        ...schedule,
        { day, start: template?.start ?? DEFAULT_START, end: template?.end ?? DEFAULT_END },
      ];
      next.sort((a, b) => DAYS_OF_WEEK.indexOf(a.day) - DAYS_OF_WEEK.indexOf(b.day));
      onChange(next);
    }
  }

  function openPicker(day: string, field: 'start' | 'end') {
    const slot = schedule.find((s) => s.day === day);
    setTempTime(dbTimeToDate(field === 'start' ? slot?.start ?? DEFAULT_START : slot?.end ?? DEFAULT_END));
    setPicker({ day, field });
  }

  function commitTime(selected: Date) {
    if (!picker) return;
    onChange(
      schedule.map((s) =>
        s.day === picker.day ? { ...s, [picker.field]: toDbTime(selected) } : s,
      ),
    );
  }

  const onTimeChange = (_: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setPicker(null);
      if (selected) commitTime(selected);
      return;
    }
    if (selected) setTempTime(selected);
  };

  return (
    <View>
      {/* Day chips */}
      <Text style={{ fontSize: 13, color: '#374151', fontFamily: 'Inter_500Medium', marginBottom: 6 }}>
        Days
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {DAYS_OF_WEEK.map((day) => {
          const selected = selectedDays.has(day);
          return (
            <TouchableOpacity
              key={day}
              onPress={() => toggleDay(day)}
              activeOpacity={0.75}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 20,
                borderWidth: 1.5,
                borderColor: selected ? TEAL : '#E5E7EB',
                backgroundColor: selected ? 'rgba(15,166,166,0.1)' : '#fff',
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  color: selected ? TEAL : '#374151',
                  fontFamily: selected ? 'Inter_600SemiBold' : 'Inter_400Regular',
                }}
              >
                {day.slice(0, 3)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* One time row per selected day */}
      {schedule.length === 0 ? (
        <Text style={{ fontSize: 13, color: '#9CA3AF', fontFamily: 'Inter_400Regular', marginBottom: 14 }}>
          Select the days your club meets.
        </Text>
      ) : (
        schedule.map((slot) => (
          <View
            key={slot.day}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              marginBottom: 10,
            }}
          >
            <Text
              style={{
                width: 86,
                fontSize: 14,
                color: '#111827',
                fontFamily: 'Inter_600SemiBold',
              }}
            >
              {slot.day}
            </Text>
            <TouchableOpacity
              onPress={() => openPicker(slot.day, 'start')}
              activeOpacity={0.7}
              style={{ ...INPUT_STYLE, flex: 1, paddingVertical: 10, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 14, color: '#111827', fontFamily: 'Inter_400Regular' }}>
                {formatTime12h(slot.start) || 'Start'}
              </Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 14, color: '#9CA3AF' }}>-</Text>
            <TouchableOpacity
              onPress={() => openPicker(slot.day, 'end')}
              activeOpacity={0.7}
              style={{ ...INPUT_STYLE, flex: 1, paddingVertical: 10, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 14, color: '#111827', fontFamily: 'Inter_400Regular' }}>
                {formatTime12h(slot.end) || 'End'}
              </Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      {/* Android native spinner */}
      {Platform.OS === 'android' && picker !== null && (
        <DateTimePicker value={tempTime} mode="time" is24Hour={false} onChange={onTimeChange} />
      )}

      {/* iOS spinner modal — same design as event creation */}
      {Platform.OS === 'ios' && picker !== null && (
        <Modal transparent animationType="slide" onRequestClose={() => setPicker(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
            <SafeAreaView
              style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 }}
              edges={['bottom']}
            >
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingHorizontal: 20,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: '#E5E7EB',
                }}
              >
                <TouchableOpacity onPress={() => setPicker(null)} activeOpacity={0.7}>
                  <Text style={{ color: '#6B7280', fontSize: 16, fontFamily: 'Inter_500Medium' }}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827', fontFamily: 'Inter_600SemiBold' }}>
                  {picker.day} · {picker.field === 'start' ? 'Start Time' : 'End Time'}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    commitTime(tempTime);
                    setPicker(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: TEAL, fontSize: 16, fontFamily: 'Inter_600SemiBold' }}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempTime}
                mode="time"
                display="spinner"
                is24Hour={false}
                onChange={onTimeChange}
                style={{ alignSelf: 'center' }}
                themeVariant="light"
                accentColor={TEAL}
              />
            </SafeAreaView>
          </View>
        </Modal>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function EditClubScreen() {
  const { clubId } = useLocalSearchParams<EditClubParams>();
  const { session } = useAuthStore();
  const userId = session?.user.id ?? '';
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show, ToastComponent } = useToast();
  const { officerClubIds } = useOfficerStore();

  const isOfficer = !!clubId && officerClubIds.includes(clubId);

  const { data: club, isLoading } = useClubProfile(clubId, userId);

  // ── Form state ────────────────────────────────────────────────────────────
  const [bannerUri, setBannerUri] = useState<string | null>(null);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [goals, setGoals] = useState<string[]>(['']);
  const [schedule, setSchedule] = useState<MeetingSlot[]>([]);
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingBuilding, setMeetingBuilding] = useState('');
  const [meetingRoom, setMeetingRoom] = useState('');
  const [officers, setOfficers] = useState<ClubOfficer[]>([]);
  const [photos, setPhotos] = useState<ClubPhoto[]>([]);
  const [events, setEvents] = useState<ClubUpcomingEvent[]>([]);
  const [pastEvents, setPastEvents] = useState<ClubUpcomingEvent[]>([]);
  const [addOfficerVisible, setAddOfficerVisible] = useState(false);

  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Populate form from club data
  useEffect(() => {
    if (!club) return;
    setBannerUri(club.banner_url);
    setAvatarUri(club.avatar_url);
    setName(club.name);
    setAbout(club.description ?? '');
    setGoals(club.goals.map((g) => g.goal_text).concat(''));
    setSchedule(
      parseMeetingSchedule(
        club.meeting_schedule,
        club.meeting_day,
        club.meeting_time_start,
        club.meeting_time_end,
      ),
    );
    setMeetingLocation(club.meeting_location ?? '');
    setMeetingBuilding(club.meeting_building ?? '');
    setMeetingRoom(club.meeting_room ?? '');
    setOfficers(club.officers);
    setPhotos(club.photos);
    setEvents(club.upcoming_events);
    setPastEvents(club.past_events);
  }, [club?.id]);

  // Guard: non-officers cannot access
  useEffect(() => {
    if (clubId && officerClubIds.length > 0 && !isOfficer) {
      Alert.alert('Access Denied', 'Only officers can edit club settings.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    }
  }, [isOfficer, officerClubIds.length]);

  function markDirty() {
    if (!hasChanges) setHasChanges(true);
  }

  function handleBackPress() {
    if (hasChanges) {
      Alert.alert(
        'Unsaved changes',
        'You have unsaved changes. Discard them?',
        [
          { text: 'Keep Editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => router.back() },
        ],
      );
    } else {
      router.back();
    }
  }

  async function pickImage(type: 'banner' | 'avatar') {
    const aspect: [number, number] = type === 'banner' ? [16, 9] : [1, 1];

    // One "change image" tap → Take Photo / Photo Library, then the in-app
    // crop/zoom/reposition step at the banner 16:9 / avatar 1:1 ratio. Same on
    // iOS and Android; the OS editor is never used.
    const picked = await pickImageForFeature({
      source: 'choose',
      aspect,
      quality: 0.85,
      onDenied: () =>
        Alert.alert(
          'Photos access needed',
          'Please enable photo library access in Settings to update club images.',
        ),
    });
    if (!picked?.uri) return;
    const localUri = picked.uri;

    if (type === 'banner') {
      setUploadingBanner(true);
      try {
        const uploadedUrl = await uploadImageToBucket(
          'club-covers',
          `${clubId}/${Date.now()}.jpg`,
          localUri,
          1600,
        );
        setBannerUri(uploadedUrl);
        markDirty();
      } catch {
        Alert.alert('Upload failed', 'Could not upload banner image. Please try again.');
      } finally {
        setUploadingBanner(false);
      }
    } else {
      setUploadingAvatar(true);
      try {
        const uploadedUrl = await uploadImageToBucket(
          'club-avatars',
          `${clubId}/${Date.now()}.jpg`,
          localUri,
          800,
        );
        setAvatarUri(uploadedUrl);
        markDirty();
      } catch {
        Alert.alert('Upload failed', 'Could not upload profile picture. Please try again.');
      } finally {
        setUploadingAvatar(false);
      }
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Club name required', 'Please enter a club name.');
      return;
    }
    setSaving(true);
    try {
      // Legacy single-day columns mirror the first schedule row so older
      // builds keep rendering a schedule; meeting_schedule is authoritative.
      const firstSlot = schedule[0] ?? null;
      const updates: UpdateClubInput = {
        name: name.trim(),
        description: about.trim(),
        avatar_url: avatarUri ?? undefined,
        banner_url: bannerUri ?? undefined,
        meeting_day: firstSlot?.day ?? null,
        meeting_time_start: firstSlot?.start ?? null,
        meeting_time_end: firstSlot?.end ?? null,
        meeting_location: meetingLocation || null,
        meeting_building: meetingBuilding || null,
        meeting_room: meetingRoom || null,
        meeting_schedule: schedule.length > 0 ? schedule : null,
      };
      await Promise.all([
        updateClubProfile(clubId!, updates),
        updateClubGoals(clubId!, goals),
      ]);
      // Club avatar/banner/name are embedded in many separate query caches
      // (Club Tab, Home cards, Discovery, Search, Calendar, Saved, chats…);
      // invalidate them all so every screen refreshes without an app restart.
      invalidateClubDataEverywhere(queryClient);
      show('Club saved!', 'success');
      setHasChanges(false);
    } catch {
      Alert.alert('Error', 'Failed to save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveOfficer(officer: ClubOfficer) {
    if (!officer.user_id) return;
    Alert.alert(
      `Remove ${officer.display_name}?`,
      'They will be downgraded to a regular member.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              // remove_club_officer RPC: atomic demotion + display-row delete
              // + Officers-chat revocation (trigger) + notification. Only
              // update the UI after the server confirms.
              await removeOfficer(clubId!, officer.user_id!);
              setOfficers((prev) => prev.filter((o) => o.id !== officer.id));
              queryClient.invalidateQueries({ queryKey: ['clubProfile', clubId] });
              queryClient.invalidateQueries({ queryKey: ['myChats'] });
              queryClient.invalidateQueries({ queryKey: ['chatDetails'] });
              queryClient.invalidateQueries({ queryKey: ['officerClubs'] });
              // The role badge on their personal profile reads club_officers.
              queryClient.invalidateQueries({ queryKey: ['userProfile'] });
              queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
            } catch {
              Alert.alert('Error', 'Could not remove officer. Try again.');
            }
          },
        },
      ],
    );
  }

  // Refreshes every surface a photo change touches: club profile preview,
  // See-all grid + viewer, Home posts, and the poster's profile grids.
  function invalidatePhotoQueries() {
    queryClient.invalidateQueries({ queryKey: ['clubProfile'] });
    queryClient.invalidateQueries({ queryKey: ['clubPhotoFeed'] });
    queryClient.invalidateQueries({ queryKey: ['homePostsFeed'] });
    queryClient.invalidateQueries({ queryKey: ['userPostsFeed'] });
    queryClient.invalidateQueries({ queryKey: ['userPosts'] });
    queryClient.invalidateQueries({ queryKey: ['ownPosts'] });
    // Post detail + shared-message cards resolve the same post by id — the
    // removed club tag must disappear from every rendering.
    queryClient.invalidateQueries({ queryKey: ['postDetail'] });
  }

  function handlePhotoOptions(photo: ClubPhoto) {
    const clubName = club?.name ?? 'this club';

    if (photo.source === 'club_authored' && photo.post_id) {
      // A post the club published from its own profile. Its club identity IS
      // its authorship — any officer deletes the whole post.
      Alert.alert(
        `Delete this ${clubName} post?`,
        `This removes the post everywhere — Home and ${clubName}’s Photos that Glue. It can’t be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete post',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteClubPost(photo.post_id!);
                setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
                invalidatePhotoQueries();
                show('Post deleted.');
              } catch {
                Alert.alert('Error', 'Could not delete the post. Try again.');
              }
            },
          },
        ],
      );
      return;
    }

    if (photo.source === 'tagged_post' && photo.post_id) {
      // A student's tagged post: officers remove it from THIS CLUB only.
      // The post, caption, image, owner, likes, comments and shares stay
      // everywhere else — only this club's tag disappears app-wide.
      Alert.alert(
        `Remove this post from ${clubName}?`,
        `The post will remain on the creator’s profile and anywhere it was shared, but the ${clubName} tag will be removed.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove from club',
            style: 'destructive',
            onPress: async () => {
              try {
                await removePostFromClub(photo.post_id!, clubId!);
                setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
                invalidatePhotoQueries();
                show(`Post removed from ${clubName}.`);
              } catch {
                Alert.alert('Error', 'Could not remove the post from this club. Try again.');
              }
            },
          },
        ],
      );
      return;
    }

    // Officer-uploaded photo: no post behind it — deleting removes only the
    // club_photos row.
    Alert.alert(
      'Remove this photo?',
      `This photo will be removed from ${clubName}’s Photos that Glue.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove photo',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteClubPhotoEverywhere(photo.id);
              setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
              invalidatePhotoQueries();
              show('Photo removed.');
            } catch {
              Alert.alert('Error', 'Could not remove the photo. Try again.');
            }
          },
        },
      ],
    );
  }

  function handleDeleteEvent(event: ClubUpcomingEvent) {
    Alert.alert(
      'Delete this event?',
      `"${event.title}" will be permanently removed for everyone — club profile, Home, Calendar, Weekly Events, and all RSVPs. Chats where it was shared will show "This event is no longer available."`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteEvent(userId, event.id);
              setEvents((prev) => prev.filter((e) => e.id !== event.id));
              setPastEvents((prev) => prev.filter((e) => e.id !== event.id));
              // Ghost-event prevention: every cache that lists events refetches.
              invalidateClubDataEverywhere(queryClient);
              queryClient.invalidateQueries({ queryKey: ['homeEventsFeed'] });
              queryClient.invalidateQueries({ queryKey: ['ownThisWeekEvents'] });
              queryClient.invalidateQueries({ queryKey: ['userWeeklyEvents'] });
              // Shared-event cards + any open detail screen re-resolve the id
              // and render "This event is no longer available."
              queryClient.invalidateQueries({ queryKey: ['eventDetail'] });
              show('Event deleted.');
            } catch {
              Alert.alert('Error', 'Could not delete the event. Try again.');
            }
          },
        },
      ],
    );
  }

  async function handleAddOfficer(user: UniversityUser, roleTitle: string) {
    await addOfficer(clubId!, user.id, roleTitle);
    // The RPC + DB triggers handle membership, both group chats, and all
    // three notifications; refetch everything that displays officer state.
    queryClient.invalidateQueries({ queryKey: ['clubProfile', clubId] });
    queryClient.invalidateQueries({ queryKey: ['clubMembers'] });
    queryClient.invalidateQueries({ queryKey: ['myChats'] });
    queryClient.invalidateQueries({ queryKey: ['officerClubs'] });
    queryClient.invalidateQueries({ queryKey: ['userProfile'] });
    setOfficers((prev) => {
      if (prev.some((o) => o.user_id === user.id)) {
        return prev.map((o) =>
          o.user_id === user.id ? { ...o, role_title: roleTitle } : o,
        );
      }
      return [
        ...prev,
        {
          id: `pending-${user.id}`,
          user_id: user.id,
          display_name: user.full_name || user.username,
          role_title: roleTitle,
          avatar_url: user.avatar_url,
        },
      ];
    });
    show(`${user.full_name || user.username} is now ${roleTitle}! 🎉`);
  }

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={{ marginRight: 12 }}>
            <Ionicons name="chevron-back" size={26} color="#111827" />
          </TouchableOpacity>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827', fontFamily: 'Zain_700Bold', flex: 1 }}>
            Edit Club
          </Text>
        </View>
        <View style={{ padding: 16, gap: 16 }}>
          <Skeleton width="100%" height={140} borderRadius={12} />
          <Skeleton width="100%" height={48} borderRadius={12} />
          <Skeleton width="100%" height={100} borderRadius={12} />
          <Skeleton width="100%" height={48} borderRadius={12} />
          <Skeleton width="100%" height={48} borderRadius={12} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {ToastComponent}

      {/* ── Header ───────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#F3F4F6',
        }}
      >
        <TouchableOpacity onPress={handleBackPress} activeOpacity={0.7} style={{ marginRight: 12 }}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <Text
          style={{ flex: 1, fontSize: 18, fontWeight: '700', color: '#111827', fontFamily: 'Zain_700Bold' }}
        >
          Edit Club
        </Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving || uploadingBanner || uploadingAvatar}
          activeOpacity={0.8}
          style={{
            backgroundColor: '#0FA6A6',
            borderRadius: 20,
            paddingHorizontal: 18,
            paddingVertical: 9,
          }}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#fff', fontFamily: 'Inter_600SemiBold' }}>
              Save
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60, paddingTop: 8 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Banner Image ───────────────────────────────── */}
        <SectionTitle title="Club Banner" />
        <ImagePickerRow
          label=""
          uri={bannerUri}
          height={140}
          borderRadius={12}
          onPick={() => pickImage('banner')}
          uploading={uploadingBanner}
        />

        {/* ── Profile Picture ────────────────────────────── */}
        <SectionTitle title="Profile Picture" />
        <View style={{ alignItems: 'flex-start' }}>
          <TouchableOpacity onPress={() => pickImage('avatar')} activeOpacity={0.8}>
            <View style={{ position: 'relative' }}>
              <Avatar uri={avatarUri} size={80} username={club?.name ?? ''} />
              <View
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  backgroundColor: '#0FA6A6',
                  borderRadius: 14,
                  padding: 5,
                  borderWidth: 2,
                  borderColor: '#FEFCF0',
                }}
              >
                {uploadingAvatar ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="pencil" size={12} color="#fff" />
                )}
              </View>
            </View>
          </TouchableOpacity>
        </View>

        {/* ── Club Name ──────────────────────────────────── */}
        <SectionTitle title="Club Name" />
        <InputField
          label=""
          value={name}
          onChangeText={(v) => { setName(v); markDirty(); }}
          placeholder="Club name..."
          maxLength={80}
        />

        {/* ── About ──────────────────────────────────────── */}
        <SectionTitle title="About" />
        <InputField
          label=""
          value={about}
          onChangeText={(v) => { setAbout(v); markDirty(); }}
          placeholder="Describe your club..."
          multiline
          maxLength={1000}
        />

        {/* ── Learning Outcomes ──────────────────────────── */}
        <SectionTitle title="Learning Outcomes" />
        {goals.map((goal, idx) => {
          const isAddRow = idx === goals.length - 1 && !goal.trim();
          return (
            <GoalInputRow
              key={idx}
              value={goal}
              index={idx}
              isAddRow={isAddRow}
              onChangeText={(v) => {
                const updated = [...goals];
                updated[idx] = v;
                if (idx === goals.length - 1 && v.length > 0) updated.push('');
                setGoals(updated);
                markDirty();
              }}
              onRemove={
                idx < goals.length - 1
                  ? () => {
                      setGoals(goals.filter((_, i) => i !== idx));
                      markDirty();
                    }
                  : undefined
              }
            />
          );
        })}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            const last = goals[goals.length - 1];
            if (last?.trim()) {
              setGoals([...goals, '']);
              markDirty();
            }
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, marginBottom: 8 }}
        >
          <Ionicons name="add-circle-outline" size={18} color={TEAL} />
          <Text style={{ fontSize: 14, color: TEAL, fontFamily: 'Inter_600SemiBold' }}>
            Add another outcome
          </Text>
        </TouchableOpacity>

        {/* ── Meeting Schedule — multiple days, per-day times via the
            scroll-style time picker; one shared Building/Room ───────── */}
        <SectionTitle title="Meeting Schedule" />
        <ScheduleEditor
          schedule={schedule}
          onChange={(next) => { setSchedule(next); markDirty(); }}
        />
        <View style={{ height: 6 }} />
        <InputField
          label="Building"
          value={meetingBuilding}
          onChangeText={(v) => { setMeetingBuilding(v); markDirty(); }}
          placeholder="e.g. Building F"
        />
        <InputField
          label="Room"
          value={meetingRoom}
          onChangeText={(v) => { setMeetingRoom(v); markDirty(); }}
          placeholder="e.g. Room 219"
        />

        {/* ── Upcoming Events ────────────────────────────── */}
        {events.length > 0 && (
          <>
            <SectionTitle title="Upcoming Events" />
            {events.map((event) => (
              <View
                key={event.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: '#fff',
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 8,
                  gap: 10,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.05,
                  shadowRadius: 3,
                  elevation: 1,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827', fontFamily: 'Inter_600SemiBold' }} numberOfLines={1}>
                    {event.emoji ? `${event.emoji} ` : ''}{event.title}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#9CA3AF', fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                    {event.event_date}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() =>
                    router.push({
                      pathname: '/home/new-event',
                      params: { editEventId: event.id },
                    } as any)
                  }
                  activeOpacity={0.7}
                  style={{ padding: 6 }}
                  accessibilityLabel={`Edit ${event.title}`}
                >
                  <Ionicons name="pencil-outline" size={18} color="#6B7280" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDeleteEvent(event)}
                  activeOpacity={0.7}
                  style={{ padding: 6 }}
                  accessibilityLabel={`Delete ${event.title}`}
                >
                  <Ionicons name="trash-outline" size={18} color="#F02719" />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {/* ── Past Events — delete only (past events are history:
            they can be removed, never edited) ─────────────── */}
        {pastEvents.length > 0 && (
          <>
            <SectionTitle title="Past Events" />
            {pastEvents.map((event) => (
              <View
                key={event.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: '#fff',
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 8,
                  gap: 10,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.05,
                  shadowRadius: 3,
                  elevation: 1,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827', fontFamily: 'Inter_600SemiBold' }} numberOfLines={1}>
                    {event.emoji ? `${event.emoji} ` : ''}{event.title}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#9CA3AF', fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                    {event.event_date}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleDeleteEvent(event)}
                  activeOpacity={0.7}
                  style={{ padding: 6 }}
                  accessibilityLabel={`Delete ${event.title}`}
                >
                  <Ionicons name="trash-outline" size={18} color="#F02719" />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {/* ── Photos that Glue ───────────────────────────── */}
        {photos.length > 0 && (
          <>
            <SectionTitle title="Photos that Glue" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
              {photos.map((photo) => (
                <View key={photo.id} style={{ position: 'relative' }}>
                  <Image
                    source={{ uri: photo.url }}
                    style={{
                      width: PHOTO_SIZE,
                      height: PHOTO_SIZE,
                      borderRadius: 8,
                      backgroundColor: '#E5E7EB',
                    }}
                    resizeMode="cover"
                  />
                  <TouchableOpacity
                    onPress={() => handlePhotoOptions(photo)}
                    activeOpacity={0.8}
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      backgroundColor: 'rgba(0,0,0,0.55)',
                      borderRadius: 12,
                      padding: 3,
                    }}
                  >
                    <Ionicons name="close" size={12} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── Officers ───────────────────────────────────── */}
        <SectionTitle title="Officers" />
        {officers.map((officer) => (
          <View
            key={officer.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              backgroundColor: '#fff',
              borderRadius: 12,
              padding: 12,
              marginBottom: 8,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.05,
              shadowRadius: 3,
              elevation: 1,
            }}
          >
            <Avatar uri={officer.avatar_url} size={40} username={officer.display_name} />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: '600',
                  color: '#111827',
                  fontFamily: 'Inter_600SemiBold',
                }}
              >
                {officer.display_name}
              </Text>
              <Text style={{ fontSize: 12, color: '#0FA6A6', fontFamily: 'Inter_400Regular' }}>
                {officer.role_title}
              </Text>
            </View>
            {officer.user_id !== userId && (
              <TouchableOpacity
                onPress={() => handleRemoveOfficer(officer)}
                activeOpacity={0.7}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 18,
                  borderWidth: 1.5,
                  borderColor: '#F02719',
                }}
              >
                <Text style={{ fontSize: 13, color: '#F02719', fontFamily: 'Inter_500Medium' }}>
                  Remove
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

        {/* Add Officer button — opens the real assignment flow */}
        <TouchableOpacity
          onPress={() => setAddOfficerVisible(true)}
          activeOpacity={0.8}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            borderWidth: 1.5,
            borderColor: '#0FA6A6',
            borderRadius: 12,
            padding: 12,
            marginTop: 4,
            marginBottom: 20,
          }}
        >
          <Ionicons name="person-add-outline" size={18} color="#0FA6A6" />
          <Text style={{ fontSize: 14, color: '#0FA6A6', fontFamily: 'Inter_600SemiBold' }}>
            Add Officer
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <AddOfficerSheet
        visible={addOfficerVisible}
        viewerUserId={userId}
        existingOfficerIds={officers.map((o) => o.user_id).filter(Boolean) as string[]}
        onAdd={handleAddOfficer}
        onClose={() => setAddOfficerVisible(false)}
      />
    </SafeAreaView>
  );
}
