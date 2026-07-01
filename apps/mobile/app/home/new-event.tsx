import { useState, useCallback } from 'react';
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
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useAuthStore } from '@weglue/shared';
import { createEvent } from '../../services/eventService';
import { getAllClubs, searchAllUsers, AppUser, UserClub } from '../../services/clubService';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useQuery } from '@tanstack/react-query';

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

export default function NewEventScreen() {
  const router = useRouter();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const { show, ToastComponent } = useToast();

  // Club selection
  const [selectedClub, setSelectedClub] = useState<UserClub | null>(null);
  const [clubSelectorVisible, setClubSelectorVisible] = useState(false);
  const [clubSearch, setClubSearch] = useState('');

  // Image
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Text fields
  const [title, setTitle] = useState('');
  const [about, setAbout] = useState('');
  const [building, setBuilding] = useState('');
  const [room, setRoom] = useState('');

  // Date picker
  const [eventDate, setEventDate] = useState<Date | null>(null);
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

  const { data: allClubs = [], isLoading: loadingClubs } = useQuery<UserClub[]>({
    queryKey: ['allClubs'],
    queryFn: getAllClubs,
  });

  const filteredClubs = allClubs.filter((c) =>
    c.name.toLowerCase().includes(clubSearch.toLowerCase()),
  );

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      show('Photo library access is required to add an event image.', 'error');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
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

  const openUserSelector = async () => {
    setUserSearch('');
    setUserSelectorVisible(true);
    setSearchingUsers(true);
    try {
      const results = await searchAllUsers('');
      setUserSearchResults(results.filter((u) => u.id !== userId));
    } catch {
      // silent
    } finally {
      setSearchingUsers(false);
    }
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
      await createEvent(userId, {
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
      show('Event posted! 🎉');
      setTimeout(() => router.replace('/(tabs)'), 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create event.';
      show(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Date picker handlers (Android shows natively, iOS uses modal) ─────────
  const onDateChange = (_: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selected) setEventDate(selected);
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
            onPress={() => router.replace('/(tabs)')}
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
            New Event
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
                height: 160,
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
                  resizeMode="cover"
                />
              ) : (
                <Ionicons name="image-outline" size={42} color="#9CA3AF" />
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
              {!imageUri && (
                <View
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    borderWidth: 2,
                    borderColor: '#0FA6A6',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#FEFCF0',
                  }}
                >
                  <Ionicons name="add" size={18} color="#0FA6A6" />
                </View>
              )}
            </View>
          </TouchableOpacity>

          {/* Event name */}
          <Text style={labelStyle}>Name of the event...</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            style={inputStyle}
            placeholderTextColor="#9CA3AF"
            maxLength={120}
            returnKeyType="next"
          />

          {/* About */}
          <Text style={labelStyle}>About:</Text>
          <TextInput
            value={about}
            onChangeText={setAbout}
            style={[inputStyle, { height: 100, textAlignVertical: 'top', paddingTop: 12 }]}
            placeholderTextColor="#9CA3AF"
            multiline
            maxLength={1000}
          />

          {/* Date */}
          <Text style={labelStyle}>Date:</Text>
          <TouchableOpacity
            onPress={() => setShowDatePicker(true)}
            activeOpacity={0.7}
            style={[inputStyle, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}
          >
            <Ionicons name="calendar-outline" size={18} color={eventDate ? '#111827' : '#9CA3AF'} />
            <Text
              style={{
                fontSize: 14,
                color: eventDate ? '#111827' : '#9CA3AF',
                fontFamily: 'Inter_400Regular',
                flex: 1,
              }}
            >
              {eventDate ? formatDate(eventDate) : 'Select date...'}
            </Text>
          </TouchableOpacity>

          {/* Android date picker (shows immediately when showDatePicker=true) */}
          {Platform.OS === 'android' && showDatePicker && (
            <DateTimePicker
              value={eventDate ?? new Date()}
              mode="date"
              minimumDate={new Date()}
              onChange={onDateChange}
            />
          )}

          {/* Time row */}
          <Text style={labelStyle}>Time:</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <TouchableOpacity
              onPress={() => {
                setTempTime(startTime ?? new Date());
                setShowTimePicker('start');
              }}
              activeOpacity={0.7}
              style={[
                inputStyle,
                {
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 0,
                },
              ]}
            >
              <Ionicons name="time-outline" size={16} color={startTime ? '#111827' : '#9CA3AF'} />
              <Text
                style={{
                  fontSize: 14,
                  color: startTime ? '#111827' : '#9CA3AF',
                  fontFamily: 'Inter_400Regular',
                }}
              >
                {startTime ? formatTime(startTime) : 'Start'}
              </Text>
            </TouchableOpacity>

            <Text style={{ fontSize: 16, color: '#9CA3AF' }}>–</Text>

            <TouchableOpacity
              onPress={() => {
                setTempTime(endTime ?? new Date());
                setShowTimePicker('end');
              }}
              activeOpacity={0.7}
              style={[
                inputStyle,
                {
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 0,
                },
              ]}
            >
              <Ionicons name="time-outline" size={16} color={endTime ? '#111827' : '#9CA3AF'} />
              <Text
                style={{
                  fontSize: 14,
                  color: endTime ? '#111827' : '#9CA3AF',
                  fontFamily: 'Inter_400Regular',
                }}
              >
                {endTime ? formatTime(endTime) : 'End'}
              </Text>
            </TouchableOpacity>
          </View>

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
                style={inputStyle}
                returnKeyType="next"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>Room:</Text>
              <TextInput
                value={room}
                onChangeText={setRoom}
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
                                backgroundColor: 'rgba(15,166,166,0.1)',
                                borderRadius: 20,
                                paddingHorizontal: 10,
                                paddingVertical: 5,
                                borderWidth: 1,
                                borderColor: '#0FA6A6',
                                gap: 5,
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: '#0FA6A6',
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
                                <Ionicons name="close-circle" size={14} color="#0FA6A6" />
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
              borderRadius: 16,
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
                  fontFamily: 'Inter_700Bold',
                }}
              >
                Post it
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
                  onPress={() => setShowDatePicker(false)}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: '#0FA6A6', fontSize: 16, fontFamily: 'Inter_600SemiBold' }}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={eventDate ?? new Date()}
                mode="date"
                display="inline"
                minimumDate={new Date()}
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

      {/* Club Selector Modal */}
      <Modal
        visible={clubSelectorVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setClubSelectorVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <SafeAreaView
            style={{
              backgroundColor: '#FEFCF0',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: '75%',
            }}
            edges={['bottom']}
          >
            <View style={{ padding: 20 }}>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '700',
                  color: '#111827',
                  fontFamily: 'Zain_700Bold',
                  textAlign: 'center',
                  marginBottom: 14,
                }}
              >
                Select Club
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: '#fff',
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: '#E5E7EB',
                  paddingHorizontal: 12,
                  gap: 8,
                }}
              >
                <Ionicons name="search-outline" size={18} color="#9CA3AF" />
                <TextInput
                  value={clubSearch}
                  onChangeText={setClubSearch}
                  placeholder="Search clubs..."
                  placeholderTextColor="#9CA3AF"
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    fontSize: 14,
                    color: '#111827',
                    fontFamily: 'Inter_400Regular',
                  }}
                  autoFocus
                />
              </View>
            </View>

            {loadingClubs ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <ActivityIndicator color="#0FA6A6" />
              </View>
            ) : (
              <FlatList
                data={filteredClubs}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
                ListEmptyComponent={
                  <Text
                    style={{
                      color: '#9CA3AF',
                      textAlign: 'center',
                      fontFamily: 'Inter_400Regular',
                      paddingVertical: 20,
                    }}
                  >
                    No clubs found.
                  </Text>
                }
                renderItem={({ item: club }) => (
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedClub(club);
                      setClubSelectorVisible(false);
                    }}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 14,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      backgroundColor:
                        selectedClub?.id === club.id ? 'rgba(15,166,166,0.08)' : '#fff',
                      marginBottom: 8,
                      borderWidth: 1,
                      borderColor: selectedClub?.id === club.id ? '#0FA6A6' : '#E5E7EB',
                    }}
                  >
                    <Text
                      style={{
                        flex: 1,
                        fontSize: 15,
                        color: '#111827',
                        fontFamily: 'Inter_500Medium',
                      }}
                    >
                      @{club.name}
                    </Text>
                    {selectedClub?.id === club.id && (
                      <Ionicons name="checkmark-circle" size={20} color="#0FA6A6" />
                    )}
                  </TouchableOpacity>
                )}
              />
            )}
          </SafeAreaView>
        </View>
      </Modal>

      {/* User Selector Modal */}
      <Modal
        visible={userSelectorVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setUserSelectorVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <SafeAreaView
            style={{
              backgroundColor: '#FEFCF0',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: '80%',
            }}
            edges={['bottom']}
          >
            <View style={{ padding: 20 }}>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '700',
                  color: '#111827',
                  fontFamily: 'Zain_700Bold',
                  textAlign: 'center',
                  marginBottom: 14,
                }}
              >
                Add People
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: '#fff',
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: '#E5E7EB',
                  paddingHorizontal: 12,
                  gap: 8,
                }}
              >
                <Ionicons name="search-outline" size={18} color="#9CA3AF" />
                <TextInput
                  value={userSearch}
                  onChangeText={handleUserSearch}
                  placeholder="Search by name or username..."
                  placeholderTextColor="#9CA3AF"
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    fontSize: 14,
                    color: '#111827',
                    fontFamily: 'Inter_400Regular',
                  }}
                  autoFocus
                />
              </View>
            </View>

            {searchingUsers ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <ActivityIndicator color="#0FA6A6" />
              </View>
            ) : (
              <FlatList
                data={userSearchResults}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
                ListEmptyComponent={
                  <Text
                    style={{
                      color: '#9CA3AF',
                      textAlign: 'center',
                      fontFamily: 'Inter_400Regular',
                      paddingVertical: 20,
                    }}
                  >
                    No users found.
                  </Text>
                }
                renderItem={({ item: user }) => {
                  const isSelected = specificUsers.some((u) => u.id === user.id);
                  return (
                    <TouchableOpacity
                      onPress={() => toggleUser(user)}
                      activeOpacity={0.7}
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
                        <Text
                          style={{
                            fontSize: 14,
                            color: '#111827',
                            fontFamily: 'Inter_600SemiBold',
                          }}
                        >
                          {user.full_name}
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: '#6B7280',
                            fontFamily: 'Inter_400Regular',
                          }}
                        >
                          @{user.username}
                        </Text>
                      </View>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={20} color="#0FA6A6" />
                      )}
                    </TouchableOpacity>
                  );
                }}
              />
            )}

            <View
              style={{
                paddingHorizontal: 20,
                paddingBottom: 16,
                paddingTop: 8,
                borderTopWidth: 1,
                borderTopColor: '#E5E7EB',
              }}
            >
              <TouchableOpacity
                onPress={() => setUserSelectorVisible(false)}
                activeOpacity={0.85}
                style={{
                  backgroundColor: '#0FA6A6',
                  borderRadius: 14,
                  paddingVertical: 14,
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    color: '#fff',
                    fontSize: 15,
                    fontWeight: '700',
                    fontFamily: 'Inter_700Bold',
                  }}
                >
                  Done{specificUsers.length > 0 ? ` (${specificUsers.length})` : ''}
                </Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

async function uploadEventImage(userId: string, uri: string): Promise<string> {
  const filename = `${userId}/events/${Date.now()}.jpg`;
  const response = await fetch(uri);
  const blob = await response.blob();

  const { data, error } = await supabase.storage
    .from('posts')
    .upload(filename, blob, { contentType: 'image/jpeg', upsert: false });

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
