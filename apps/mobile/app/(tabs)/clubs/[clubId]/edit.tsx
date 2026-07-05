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
  Pressable,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useOfficerStore } from '../../../../store/officerStore';
import { useClubProfile } from '../../../../hooks/useClubProfile';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Skeleton } from '../../../../components/shared/SkeletonLoader';
import { useToast } from '../../../../components/Toast';
import { Avatar } from '../../../../components/shared/Avatar';
import * as ImagePicker from 'expo-image-picker';
import {
  updateClubProfile,
  updateClubGoals,
  addOfficer,
  removeOfficer,
  deleteClubPhoto,
  uploadClubPhoto,
  type UpdateClubInput,
} from '../../../../services/clubService';
import { uploadImageToBucket } from '../../../../lib/imageUpload';
import type { ClubOfficer, ClubPhoto, ClubUpcomingEvent } from '../../../../services/clubService';

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

// ─── Day Picker ───────────────────────────────────────────────────────────────
function DayPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
        style={{
          backgroundColor: '#fff',
          borderRadius: 12,
          borderWidth: 1,
          borderColor: '#E5E7EB',
          paddingHorizontal: 14,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text
          style={{
            fontSize: 15,
            color: value ? '#111827' : '#9CA3AF',
            fontFamily: 'Inter_400Regular',
          }}
        >
          {value || 'Select day...'}
        </Text>
        <Ionicons name="chevron-down" size={18} color="#9CA3AF" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', paddingHorizontal: 32 }}
          onPress={() => setOpen(false)}
        >
          <Pressable
            onPress={() => {}}
            style={{ backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' }}
          >
            {DAYS_OF_WEEK.map((day) => (
              <TouchableOpacity
                key={day}
                onPress={() => { onChange(day); setOpen(false); }}
                activeOpacity={0.7}
                style={{
                  paddingHorizontal: 20,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: '#F3F4F6',
                  backgroundColor: value === day ? 'rgba(15,166,166,0.08)' : '#fff',
                }}
              >
                <Text
                  style={{
                    fontSize: 15,
                    color: value === day ? '#0FA6A6' : '#374151',
                    fontFamily: value === day ? 'Inter_600SemiBold' : 'Inter_400Regular',
                  }}
                >
                  {day}
                </Text>
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
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
  const [meetingDay, setMeetingDay] = useState('');
  const [meetingTimeStart, setMeetingTimeStart] = useState('');
  const [meetingTimeEnd, setMeetingTimeEnd] = useState('');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingBuilding, setMeetingBuilding] = useState('');
  const [meetingRoom, setMeetingRoom] = useState('');
  const [officers, setOfficers] = useState<ClubOfficer[]>([]);
  const [photos, setPhotos] = useState<ClubPhoto[]>([]);
  const [events, setEvents] = useState<ClubUpcomingEvent[]>([]);

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
    setMeetingDay(club.meeting_day ?? '');
    setMeetingTimeStart(club.meeting_time_start ?? '');
    setMeetingTimeEnd(club.meeting_time_end ?? '');
    setMeetingLocation(club.meeting_location ?? '');
    setMeetingBuilding(club.meeting_building ?? '');
    setMeetingRoom(club.meeting_room ?? '');
    setOfficers(club.officers);
    setPhotos(club.photos);
    setEvents(club.upcoming_events);
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
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Photos access needed',
        'Please enable photo library access in Settings to update club images.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: type === 'banner' ? [16, 9] : [1, 1],
      quality: 0.85,
    });

    if (result.canceled || !result.assets[0]) return;
    const localUri = result.assets[0].uri;

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
      const updates: UpdateClubInput = {
        name: name.trim(),
        description: about.trim(),
        avatar_url: avatarUri ?? undefined,
        banner_url: bannerUri ?? undefined,
        meeting_day: meetingDay || null,
        meeting_time_start: meetingTimeStart || null,
        meeting_time_end: meetingTimeEnd || null,
        meeting_location: meetingLocation || null,
        meeting_building: meetingBuilding || null,
        meeting_room: meetingRoom || null,
      };
      await Promise.all([
        updateClubProfile(clubId!, updates),
        updateClubGoals(clubId!, goals),
      ]);
      queryClient.invalidateQueries({ queryKey: ['clubProfile', clubId, userId] });
      // Club banner/avatar are also embedded in Home feed event cards and
      // club discovery/listing screens — separate query caches that won't
      // pick up the change until invalidated directly.
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed'] });
      queryClient.invalidateQueries({ queryKey: ['discoveryClubs'] });
      queryClient.invalidateQueries({ queryKey: ['ownClubs'] });
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
              await removeOfficer(clubId!, officer.user_id!);
              setOfficers((prev) => prev.filter((o) => o.id !== officer.id));
              queryClient.invalidateQueries({ queryKey: ['clubProfile', clubId, userId] });
            } catch {
              Alert.alert('Error', 'Could not remove officer. Try again.');
            }
          },
        },
      ],
    );
  }

  async function handleHidePhoto(photo: ClubPhoto) {
    Alert.alert(
      'Hide photo?',
      'This photo will be hidden from the club profile. The original post is not deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Hide',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteClubPhoto(photo.id);
              setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
            } catch {
              Alert.alert('Error', 'Could not hide photo. Try again.');
            }
          },
        },
      ],
    );
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

        {/* ── Meeting Schedule ───────────────────────────── */}
        <SectionTitle title="Meeting Schedule" />
        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontSize: 13, color: '#374151', fontFamily: 'Inter_500Medium', marginBottom: 6 }}>
            Day
          </Text>
          <DayPicker value={meetingDay} onChange={(v) => { setMeetingDay(v); markDirty(); }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <InputField
              label="Start Time (HH:MM)"
              value={meetingTimeStart}
              onChangeText={(v) => { setMeetingTimeStart(v); markDirty(); }}
              placeholder="09:00"
              maxLength={5}
            />
          </View>
          <View style={{ flex: 1 }}>
            <InputField
              label="End Time (HH:MM)"
              value={meetingTimeEnd}
              onChangeText={(v) => { setMeetingTimeEnd(v); markDirty(); }}
              placeholder="10:00"
              maxLength={5}
            />
          </View>
        </View>
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
                      pathname: '/(tabs)/clubs/[clubId]/events/[eventId]',
                      params: { clubId: clubId!, eventId: event.id },
                    })
                  }
                  activeOpacity={0.7}
                  style={{ padding: 6 }}
                >
                  <Ionicons name="pencil-outline" size={18} color="#6B7280" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    Alert.alert('Delete Event?', 'This will permanently delete the event.', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => setEvents((prev) => prev.filter((e) => e.id !== event.id)),
                      },
                    ]);
                  }}
                  activeOpacity={0.7}
                  style={{ padding: 6 }}
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
                    onPress={() => handleHidePhoto(photo)}
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

        {/* Add Officer button */}
        <TouchableOpacity
          onPress={() => show('Add officer — select from members list', 'info')}
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
    </SafeAreaView>
  );
}
