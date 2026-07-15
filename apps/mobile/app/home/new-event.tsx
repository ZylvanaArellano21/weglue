import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { pickMedia, useWeGlueMediaFlow } from '../../lib/media/pickMedia';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useAuthStore } from '@weglue/shared';
import { createEvent, updateEvent, getEventForEdit } from '../../services/eventService';
import { getUserOfficerClubs, searchAllUsers, AppUser, UserClub } from '../../services/clubService';
import { invalidateClubDataEverywhere } from '../../lib/clubCache';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SearchBottomSheet } from '../../components/shared/SearchBottomSheet';
import { useHomeTabStore } from '../../store/homeTabStore';

type Visibility = 'everyone' | 'members' | 'specific';

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function toTimeString(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}:00`;
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

// minimumDate must be midnight, not "now" — passing the current time can make
// today itself unselectable in the calendar.
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function NewEventScreen() {
  const router = useRouter();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const { show, ToastComponent } = useToast();
  const queryClient = useQueryClient();

  // Edit mode: opened from Edit Club with an existing event to modify.
  // Same form, same pickers — saving updates instead of creating.
  const { editEventId } = useLocalSearchParams<{ editEventId?: string }>();
  const isEditMode = !!editEventId;

  // Club selection
  const [selectedClub, setSelectedClub] = useState<UserClub | null>(null);
  const [clubSelectorVisible, setClubSelectorVisible] = useState(false);
  const [clubSearch, setClubSearch] = useState('');

  // Image
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageCoverMode, setImageCoverMode] = useState<'cover' | 'contain'>('cover');

  // Text fields
  const [title, setTitle] = useState('');
  const [about, setAbout] = useState('');
  const [building, setBuilding] = useState('');
  const [room, setRoom] = useState('');

  // Date picker. iOS commits via tempDate on "Done" — the inline calendar
  // already highlights today, so tapping today never fires onChange and a
  // null eventDate would otherwise stay null (the "today won't select" bug).
  const [eventDate, setEventDate] = useState<Date | null>(null);
  const [tempDate, setTempDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Time pickers
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [showTimePicker, setShowTimePicker] = useState<'start' | 'end' | null>(null);
  const [tempTime, setTempTime] = useState<Date>(new Date());

  // Visibility
  const [visibility, setVisibility] = useState<Visibility>('everyone');

  // Specific users
  const [specificUsers, setSpecificUsers] = useState<AppUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<AppUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [userSelectorVisible, setUserSelectorVisible] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  // Hosting-by can only be a club where the current user is an officer — never
  // a club they merely joined (task 5). Sourced from the real club_members role.
  const { data: officerClubs = [], isLoading: loadingClubs } = useQuery<UserClub[]>({
    queryKey: ['officerClubs', userId],
    queryFn: () => getUserOfficerClubs(userId!),
    enabled: !!userId,
  });

  // Prefill every field from the existing event when editing.
  const [editLoaded, setEditLoaded] = useState(false);
  const { data: editEvent } = useQuery({
    queryKey: ['eventForEdit', editEventId],
    queryFn: () => getEventForEdit(editEventId!),
    enabled: isEditMode,
    staleTime: 0,
  });

  useEffect(() => {
    if (!editEvent || editLoaded) return;
    setSelectedClub({ id: editEvent.club_id, name: editEvent.club_name, avatar_url: null });
    setTitle(editEvent.title);
    setAbout(editEvent.description ?? '');
    setBuilding(editEvent.building ?? '');
    setRoom(editEvent.room ?? '');
    setImageUri(editEvent.cover_image_url);
    setImageUrl(editEvent.cover_image_url);
    setEventDate(new Date(`${editEvent.event_date}T00:00:00`));
    const [sh, sm] = editEvent.start_time.split(':').map(Number);
    const [eh, em] = editEvent.end_time.split(':').map(Number);
    const start = new Date();
    start.setHours(sh || 0, sm || 0, 0, 0);
    const end = new Date();
    end.setHours(eh || 0, em || 0, 0, 0);
    setStartTime(start);
    setEndTime(end);
    setVisibility(editEvent.visibility);
    setEditLoaded(true);
  }, [editEvent, editLoaded]);

  const filteredClubs = officerClubs.filter((c) =>
    c.name.toLowerCase().includes(clubSearch.toLowerCase()),
  );

  // Selection is durably uploaded before it counts as chosen, so a cancel
  // mid-flow never leaves a dangling local URI in the form state.
  const uploadSelectedEventImage = async (uri: string) => {
    setImageUri(uri);
    setUploading(true);
    try {
      const uploaded = await uploadEventImage(userId!, uri);
      setImageUrl(uploaded);
    } catch {
      show('Failed to upload image. Try again.', 'error');
      setImageUri(null);
    } finally {
      setUploading(false);
    }
  };

  const handlePickImage = async () => {
    // Android: shared We Glue flow. Single "add image" tap → 'choose' shows
    // Take Photo / Photo Library first, then camera or picker + confirm
    // preview. iOS keeps its existing library-only path. Event 4:5 preserved.
    if (useWeGlueMediaFlow) {
      const picked = await pickMedia({ source: 'choose', aspect: [4, 5], allowsEditing: true, quality: 0.8 });
      if (picked) await uploadSelectedEventImage(picked.uri);
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      show('Photo library access is required to add an event image.', 'error');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 5],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      await uploadSelectedEventImage(result.assets[0].uri);
    }
  };

  const handleUserSearch = useCallback(async (q: string) => {
    setUserSearch(q);
    setSearchingUsers(true);
    try {
      const results = await searchAllUsers(q);
      setUserSearchResults(results.filter((u) => u.id !== userId));
    } catch {
      // silent
    } finally {
      setSearchingUsers(false);
    }
  }, [userId]);

  const openUserSelector = () => {
    setUserSelectorVisible(true);
  };

  const toggleUser = (user: AppUser) => {
    setSpecificUsers((prev) => {
      const exists = prev.some((u) => u.id === user.id);
      return exists ? prev.filter((u) => u.id !== user.id) : [...prev, user];
    });
  };

  const allRequiredFilled =
    !!selectedClub &&
    !!imageUri &&
    !!imageUrl &&
    title.trim().length > 0 &&
    about.trim().length > 0 &&
    eventDate !== null &&
    startTime !== null &&
    endTime !== null &&
    building.trim().length > 0 &&
    room.trim().length > 0 &&
    (visibility !== 'specific' || specificUsers.length > 0);

  const handleSubmit = async () => {
    if (!userId || !allRequiredFilled) return;

    setSubmitting(true);
    try {
      if (isEditMode && editEventId) {
        await updateEvent(userId, editEventId, {
          title: title.trim(),
          description: about.trim(),
          cover_image_url: imageUrl,
          event_date: toDateString(eventDate!),
          start_time: toTimeString(startTime!),
          end_time: toTimeString(endTime!),
          building: building.trim(),
          room: room.trim(),
          visibility,
          specific_user_ids:
            visibility === 'specific' ? specificUsers.map((u) => u.id) : null,
        });
        // The event is embedded in many caches (club profile, Home, Calendar,
        // Weekly Events, saved/RSVP'd lists) — refetch them all so every user
        // surface shows the update immediately.
        invalidateClubDataEverywhere(queryClient);
        queryClient.invalidateQueries({ queryKey: ['homeEventsFeed'] });
        queryClient.invalidateQueries({ queryKey: ['eventForEdit', editEventId] });
        queryClient.invalidateQueries({ queryKey: ['ownThisWeekEvents'] });
        queryClient.invalidateQueries({ queryKey: ['userWeeklyEvents'] });
        show('Event updated! 🎉');
        setTimeout(() => router.back(), 700);
        return;
      }

      const newEventId = await createEvent(userId, {
        club_id: selectedClub!.id,
        title: title.trim(),
        description: about.trim(),
        cover_image_url: imageUrl ?? undefined,
        event_date: toDateString(eventDate!),
        start_time: toTimeString(startTime!),
        end_time: toTimeString(endTime!),
        building: building.trim(),
        room: room.trim(),
        visibility,
        specific_user_ids:
          visibility === 'specific' ? specificUsers.map((u) => u.id) : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed', userId] });
      useHomeTabStore.getState().setActiveTab('events');
      // Land Home → Events exactly on the new small event card (located by
      // ID once the refreshed feed contains it) instead of the detail screen.
      useHomeTabStore.getState().setPendingScrollEventId(newEventId);
      show('Event posted! 🎉');
      setTimeout(() => router.replace('/(tabs)'), 1000);
    } catch (err: unknown) {
      console.error('[new-event] save failed', err);
      show(
        isEditMode ? 'Failed to update event. Please try again.' : 'Failed to create event. Please try again.',
        'error',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ── Date picker handlers (Android shows natively, iOS uses modal) ─────────
  const openDatePicker = () => {
    setTempDate(eventDate ?? new Date());
    setShowDatePicker(true);
  };

  const onDateChange = (_: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (selected) setEventDate(selected);
      return;
    }
    if (selected) setTempDate(selected);
  };

  const confirmDatePicker = () => {
    setEventDate(tempDate);
    setShowDatePicker(false);
  };

  const onTimeChange = (_: DateTimePickerEvent, selected?: Date) => {
    if (selected) setTempTime(selected);
    if (Platform.OS === 'android') {
      setShowTimePicker(null);
      if (selected) {
        if (showTimePicker === 'start') setStartTime(selected);
        else setEndTime(selected);
      }
    }
  };

  const confirmTimePicker = () => {
    if (showTimePicker === 'start') setStartTime(tempTime);
    else setEndTime(tempTime);
    setShowTimePicker(null);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top', 'bottom']}>
      {ToastComponent}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 14,
          }}
        >
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
            activeOpacity={0.7}
            hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
          >
            <Ionicons name="chevron-back" size={26} color="#111827" />
          </TouchableOpacity>
          <Text
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              textAlign: 'center',
              fontSize: 18,
              fontWeight: '700',
              color: '#111827',
              fontFamily: 'Zain_700Bold',
            }}
          >
            {isEditMode ? 'Edit Event' : 'New Event'}
          </Text>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hosting by */}
          <View style={{ marginBottom: 16 }}>
            <Text style={labelStyle}>
              Hosting by: @{' '}
              <Text
                onPress={() => {
                  // The hosting club is fixed when editing an existing event.
                  if (isEditMode) return;
                  setClubSearch('');
                  setClubSelectorVisible(true);
                }}
                style={{ color: '#0FA6A6', fontFamily: 'Inter_600SemiBold' }}
              >
                {selectedClub ? selectedClub.name : 'add club'}
              </Text>
            </Text>
          </View>

          {/* Add image */}
          <Text style={labelStyle}>Add image:</Text>
          <TouchableOpacity
            onPress={handlePickImage}
            activeOpacity={0.8}
            disabled={uploading}
            style={{ marginBottom: 16 }}
          >
            <View
              style={{
                width: '100%',
                aspectRatio: 4 / 5,
                backgroundColor: '#E5E7EB',
                borderRadius: 12,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {imageUri ? (
                <Image
                  source={{ uri: imageUri }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode={imageCoverMode}
                />
              ) : (
                <Ionicons name="image-outline" size={56} color="#9CA3AF" />
              )}
              {uploading && (
                <View
                  style={{
                    position: 'absolute',
                    backgroundColor: 'rgba(0,0,0,0.4)',
                    width: '100%',
                    height: '100%',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ActivityIndicator color="#fff" />
                </View>
              )}
              {/* (+) button — always visible top right */}
              <View
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: '#0FA6A6',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="add" size={18} color="#fff" />
              </View>
              {/* Resize toggle — bottom left, only when image selected */}
              {imageUri && (
                <TouchableOpacity
                  onPress={() =>
                    setImageCoverMode((prev) => (prev === 'cover' ? 'contain' : 'cover'))
                  }
                  activeOpacity={0.8}
                  style={{
                    position: 'absolute',
                    bottom: 10,
                    left: 10,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: 'rgba(255,255,255,0.92)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name={imageCoverMode === 'cover' ? 'scan-outline' : 'contract-outline'}
                    size={16}
                    color="#6B7280"
                  />
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>

          {/* Event name */}
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Name of the event..."
            style={inputStyle}
            placeholderTextColor="#9CA3AF"
            maxLength={120}
            returnKeyType="next"
          />

          {/* About */}
          <TextInput
            value={about}
            onChangeText={setAbout}
            placeholder="About this event..."
            style={[inputStyle, { height: 100, textAlignVertical: 'top', paddingTop: 12 }]}
            placeholderTextColor="#9CA3AF"
            multiline
            maxLength={1000}
          />

          {/* Date + Time — two-column row */}
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
            {/* Date column */}
            <View style={{ flex: 1 }}>
              <Text style={[labelStyle, { fontSize: 12 }]}>Date:</Text>
              <TouchableOpacity
                onPress={openDatePicker}
                activeOpacity={0.7}
                style={[inputStyle, { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 0 }]}
              >
                <Ionicons name="calendar-outline" size={16} color={eventDate ? '#111827' : '#9CA3AF'} />
                <Text
                  style={{
                    fontSize: 13,
                    color: eventDate ? '#111827' : '#9CA3AF',
                    fontFamily: 'Inter_400Regular',
                    flex: 1,
                  }}
                  numberOfLines={1}
                >
                  {eventDate ? formatDate(eventDate) : 'Select...'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Time column */}
            <View style={{ flex: 1 }}>
              <Text style={[labelStyle, { fontSize: 12 }]}>Time:</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <TouchableOpacity
                  onPress={() => {
                    setTempTime(startTime ?? new Date());
                    setShowTimePicker('start');
                  }}
                  activeOpacity={0.7}
                  style={[inputStyle, { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 0 }]}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      color: startTime ? '#111827' : '#9CA3AF',
                      fontFamily: 'Inter_400Regular',
                    }}
                  >
                    {startTime ? formatTime(startTime) : '--:--'}
                  </Text>
                </TouchableOpacity>
                <Text style={{ fontSize: 14, color: '#9CA3AF' }}>-</Text>
                <TouchableOpacity
                  onPress={() => {
                    setTempTime(endTime ?? new Date());
                    setShowTimePicker('end');
                  }}
                  activeOpacity={0.7}
                  style={[inputStyle, { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 0 }]}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      color: endTime ? '#111827' : '#9CA3AF',
                      fontFamily: 'Inter_400Regular',
                    }}
                  >
                    {endTime ? formatTime(endTime) : '--:--'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Android date picker (shows immediately when showDatePicker=true) */}
          {Platform.OS === 'android' && showDatePicker && (
            <DateTimePicker
              value={eventDate ?? new Date()}
              mode="date"
              minimumDate={startOfToday()}
              onChange={onDateChange}
            />
          )}

          {/* Android time picker */}
          {Platform.OS === 'android' && showTimePicker !== null && (
            <DateTimePicker
              value={tempTime}
              mode="time"
              is24Hour={false}
              onChange={onTimeChange}
            />
          )}

          {/* Building & Room */}
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 0 }}>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>Building:</Text>
              <TextInput
                value={building}
                onChangeText={setBuilding}
                placeholder="Building"
                placeholderTextColor="#9CA3AF"
                style={inputStyle}
                returnKeyType="next"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>Room:</Text>
              <TextInput
                value={room}
                onChangeText={setRoom}
                placeholder="Room"
                placeholderTextColor="#9CA3AF"
                style={inputStyle}
                returnKeyType="done"
              />
            </View>
          </View>

          {/* Visibility */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 20 }}>
            <Ionicons name="eye-outline" size={22} color="#0FA6A6" style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={[labelStyle, { marginBottom: 10 }]}>View:</Text>
              {(
                [
                  { value: 'everyone', label: 'Everyone', desc: 'Appears on all home feeds' },
                  { value: 'members', label: 'Members', desc: 'Only club members see this' },
                  { value: 'specific', label: 'Only these members', desc: 'Pick specific people' },
                ] as { value: Visibility; label: string; desc: string }[]
              ).map(({ value, label, desc }) => (
                <View key={value}>
                  <TouchableOpacity
                    onPress={() => setVisibility(value)}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 10,
                      backgroundColor: '#fff',
                      borderRadius: 10,
                      paddingVertical: 12,
                      paddingHorizontal: 12,
                      borderWidth: 1,
                      borderColor: visibility === value ? '#0FA6A6' : '#E5E7EB',
                    }}
                  >
                    <View
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        borderWidth: 2,
                        borderColor: visibility === value ? '#0FA6A6' : '#9CA3AF',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {visibility === value && (
                        <View
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 5,
                            backgroundColor: '#0FA6A6',
                          }}
                        />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 14,
                          color: '#374151',
                          fontFamily: 'Inter_500Medium',
                        }}
                      >
                        {label}
                      </Text>
                      <Text
                        style={{
                          fontSize: 11,
                          color: '#9CA3AF',
                          fontFamily: 'Inter_400Regular',
                          marginTop: 1,
                        }}
                      >
                        {desc}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {/* User search panel — only for "specific" */}
                  {value === 'specific' && visibility === 'specific' && (
                    <View style={{ marginBottom: 10 }}>
                      {/* Selected user chips */}
                      {specificUsers.length > 0 && (
                        <View
                          style={{
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                            gap: 8,
                            marginBottom: 10,
                          }}
                        >
                          {specificUsers.map((user) => (
                            <View
                              key={user.id}
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                backgroundColor: '#0FA6A6',
                                borderRadius: 20,
                                paddingHorizontal: 10,
                                paddingVertical: 5,
                                gap: 5,
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: '#fff',
                                  fontFamily: 'Inter_500Medium',
                                }}
                              >
                                @{user.username}
                              </Text>
                              <TouchableOpacity
                                onPress={() =>
                                  setSpecificUsers((prev) =>
                                    prev.filter((u) => u.id !== user.id),
                                  )
                                }
                                hitSlop={{ top: 6, left: 6, right: 6, bottom: 6 }}
                                activeOpacity={0.7}
                              >
                                <Ionicons name="close-circle" size={14} color="#fff" />
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>
                      )}

                      <TouchableOpacity
                        onPress={openUserSelector}
                        activeOpacity={0.7}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          backgroundColor: '#fff',
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: '#E5E7EB',
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                        }}
                      >
                        <Ionicons name="person-add-outline" size={18} color="#9CA3AF" />
                        <Text
                          style={{
                            fontSize: 14,
                            color: '#9CA3AF',
                            fontFamily: 'Inter_400Regular',
                          }}
                        >
                          Add people...
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </View>
        </ScrollView>

        {/* Post it button */}
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: 16,
            backgroundColor: '#FEFCF0',
            borderTopWidth: 1,
            borderTopColor: 'rgba(0,0,0,0.05)',
          }}
        >
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={submitting || !allRequiredFilled}
            activeOpacity={0.85}
            style={{
              backgroundColor: submitting || !allRequiredFilled ? '#9CA3AF' : '#0FA6A6',
              borderRadius: 28,
              paddingVertical: 16,
              alignItems: 'center',
            }}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text
                style={{
                  color: '#fff',
                  fontSize: 16,
                  fontWeight: '700',
                  fontFamily: 'Zain_700Bold',
                }}
              >
                {isEditMode ? 'Save changes' : 'Post it'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* iOS Date Picker Modal */}
      {Platform.OS === 'ios' && showDatePicker && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowDatePicker(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
            <SafeAreaView style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 }} edges={['bottom']}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingHorizontal: 20,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: '#E5E7EB',
                }}
              >
                <TouchableOpacity onPress={() => setShowDatePicker(false)} activeOpacity={0.7}>
                  <Text style={{ color: '#6B7280', fontSize: 16, fontFamily: 'Inter_500Medium' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={confirmDatePicker}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: '#0FA6A6', fontSize: 16, fontFamily: 'Inter_600SemiBold' }}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="inline"
                minimumDate={startOfToday()}
                onChange={onDateChange}
                style={{ alignSelf: 'center' }}
                themeVariant="light"
                accentColor="#0FA6A6"
              />
            </SafeAreaView>
          </View>
        </Modal>
      )}

      {/* iOS Time Picker Modal */}
      {Platform.OS === 'ios' && showTimePicker !== null && (
        <Modal
          transparent
          animationType="slide"
          onRequestClose={() => setShowTimePicker(null)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
            <SafeAreaView style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 }} edges={['bottom']}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingHorizontal: 20,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: '#E5E7EB',
                }}
              >
                <TouchableOpacity onPress={() => setShowTimePicker(null)} activeOpacity={0.7}>
                  <Text style={{ color: '#6B7280', fontSize: 16, fontFamily: 'Inter_500Medium' }}>Cancel</Text>
                </TouchableOpacity>
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: '600',
                    color: '#111827',
                    fontFamily: 'Inter_600SemiBold',
                  }}
                >
                  {showTimePicker === 'start' ? 'Start Time' : 'End Time'}
                </Text>
                <TouchableOpacity onPress={confirmTimePicker} activeOpacity={0.7}>
                  <Text style={{ color: '#0FA6A6', fontSize: 16, fontFamily: 'Inter_600SemiBold' }}>Done</Text>
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
                accentColor="#0FA6A6"
              />
            </SafeAreaView>
          </View>
        </Modal>
      )}

      {/* Select Club — keyboard-safe bottom sheet */}
      <SearchBottomSheet<UserClub>
        visible={clubSelectorVisible}
        title="Select Club"
        searchPlaceholder="Search clubs..."
        data={filteredClubs}
        keyExtractor={(c) => c.id}
        onSearch={(q) => setClubSearch(q)}
        onSelect={(club) => {
          setSelectedClub(club);
          setClubSelectorVisible(false);
        }}
        onClose={() => setClubSelectorVisible(false)}
        loading={loadingClubs}
        emptyText="No clubs found."
        renderItem={(club, isSelected) => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 14,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: isSelected ? 'rgba(15,166,166,0.08)' : '#fff',
              marginBottom: 8,
              borderWidth: 1,
              borderColor: isSelected ? '#0FA6A6' : '#E5E7EB',
            }}
          >
            <Text style={{ flex: 1, fontSize: 15, color: '#111827', fontFamily: 'Inter_500Medium' }}>
              @{club.name}
            </Text>
            {isSelected && <Ionicons name="checkmark-circle" size={20} color="#0FA6A6" />}
          </View>
        )}
      />

      {/* Add People — keyboard-safe bottom sheet, multi-select */}
      <SearchBottomSheet<AppUser>
        visible={userSelectorVisible}
        title="Add People"
        searchPlaceholder="Search by name or username..."
        data={userSearchResults}
        keyExtractor={(u) => u.id}
        onSearch={handleUserSearch}
        onSelect={toggleUser}
        onClose={() => setUserSelectorVisible(false)}
        loading={searchingUsers}
        emptyText="No users found."
        multiSelect
        selectedItems={specificUsers}
        renderItem={(user, isSelected) => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 12,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: isSelected ? 'rgba(15,166,166,0.08)' : '#fff',
              marginBottom: 8,
              borderWidth: 1,
              borderColor: isSelected ? '#0FA6A6' : '#E5E7EB',
              gap: 10,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, color: '#111827', fontFamily: 'Inter_600SemiBold' }}>
                {user.full_name}
              </Text>
              <Text style={{ fontSize: 12, color: '#6B7280', fontFamily: 'Inter_400Regular' }}>
                @{user.username}
              </Text>
            </View>
            {isSelected && <Ionicons name="checkmark-circle" size={20} color="#0FA6A6" />}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

async function uploadEventImage(userId: string, uri: string): Promise<string> {
  const filename = `${userId}/events/${Date.now()}.jpg`;
  const response = await fetch(uri);
  const blob = await response.blob();
  const arrayBuffer = await new Response(blob).arrayBuffer();

  const { data, error } = await supabase.storage
    .from('posts')
    .upload(filename, new Uint8Array(arrayBuffer), { contentType: 'image/jpeg', upsert: false });

  if (error || !data) throw error ?? new Error('Upload failed');

  const {
    data: { publicUrl },
  } = supabase.storage.from('posts').getPublicUrl(data.path);
  return publicUrl;
}

const labelStyle = {
  fontSize: 14,
  fontWeight: '600' as const,
  color: '#374151',
  fontFamily: 'Inter_600SemiBold',
  marginBottom: 6,
};

const inputStyle = {
  backgroundColor: '#fff',
  borderRadius: 12,
  borderWidth: 1,
  borderColor: '#E5E7EB',
  paddingHorizontal: 14,
  paddingVertical: 12,
  fontSize: 14,
  color: '#111827',
  fontFamily: 'Inter_400Regular',
  marginBottom: 14,
};
