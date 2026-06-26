import { useState } from 'react';
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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@weglue/shared';
import { useOfficerStore } from '../../store/officerStore';
import { createEvent } from '../../services/eventService';
import { useToast } from '../../components/Toast';
import { getUserOfficerClubs, UserClub } from '../../services/clubService';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

type Visibility = 'everyone' | 'members' | 'specific';

export default function NewEventScreen() {
  const router = useRouter();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const { show, ToastComponent } = useToast();

  const { data: officerClubs = [] } = useQuery<UserClub[]>({
    queryKey: ['officerClubs', userId],
    queryFn: () => getUserOfficerClubs(userId!),
    enabled: !!userId,
  });

  const [selectedClub, setSelectedClub] = useState<UserClub | null>(null);
  const [hostingSelf, setHostingSelf] = useState(false);
  const [clubSelectorVisible, setClubSelectorVisible] = useState(false);

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [about, setAbout] = useState('');

  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [year, setYear] = useState('');

  const [startHour, setStartHour] = useState('');
  const [startMin, setStartMin] = useState('');
  const [endHour, setEndHour] = useState('');
  const [endMin, setEndMin] = useState('');

  const [location, setLocation] = useState('');
  const [building, setBuilding] = useState('');
  const [room, setRoom] = useState('');

  const [visibility, setVisibility] = useState<Visibility>('everyone');
  const [submitting, setSubmitting] = useState(false);

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
      } finally {
        setUploading(false);
      }
    }
  };

  const handleSubmit = async () => {
    if (!userId) return;

    if (!title.trim()) {
      show('Please enter an event name.', 'error');
      return;
    }
    if (!month || !day || !year) {
      show('Please enter the event date.', 'error');
      return;
    }
    if (!startHour || !startMin || !endHour || !endMin) {
      show('Please enter the event time.', 'error');
      return;
    }
    if (!selectedClub && !hostingSelf) {
      show('Please select a host (club or yourself).', 'error');
      return;
    }
    if (!selectedClub && !hostingSelf) return;

    const eventDate = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const startTime = `${startHour.padStart(2, '0')}:${startMin.padStart(2, '0')}:00`;
    const endTime = `${endHour.padStart(2, '0')}:${endMin.padStart(2, '0')}:00`;

    if (hostingSelf && !selectedClub) {
      show('Personal events require a club. Select a club or contact support.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      await createEvent(userId, {
        club_id: selectedClub!.id,
        title: title.trim(),
        description: about.trim() || undefined,
        cover_image_url: imageUrl ?? undefined,
        event_date: eventDate,
        start_time: startTime,
        end_time: endTime,
        location: location.trim() || undefined,
        building: building.trim() || undefined,
        room: room.trim() || undefined,
        visibility,
      });
      show('Event posted! 🎉');
      setTimeout(() => router.back(), 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create event.';
      show(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const hostingLabel = selectedClub
    ? `@${selectedClub.name}`
    : hostingSelf
    ? '@Myself'
    : 'add club or myself';

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
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}>
            <Ionicons name="chevron-back" size={26} color="#111827" />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <Text
            style={{
              fontSize: 18,
              fontWeight: '700',
              color: '#111827',
              fontFamily: 'Zain_700Bold',
              position: 'absolute',
              left: 0,
              right: 0,
              textAlign: 'center',
            }}
          >
            New Event
          </Text>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hosting by */}
          <View style={{ marginBottom: 16 }}>
            <Text style={labelStyle}>
              Hosting by:{' '}
              <Text
                onPress={() => setClubSelectorVisible(true)}
                style={{ color: '#0FA6A6', fontFamily: 'Inter_600SemiBold' }}
              >
                @ {hostingLabel}
              </Text>
            </Text>
          </View>

          {/* Add image */}
          <Text style={labelStyle}>Add image:</Text>
          <TouchableOpacity onPress={handlePickImage} activeOpacity={0.8} style={{ marginBottom: 16 }}>
            <View
              style={{
                width: 140,
                height: 100,
                backgroundColor: '#E5E7EB',
                borderRadius: 10,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              ) : null}
              {uploading && (
                <View style={{ position: 'absolute', backgroundColor: 'rgba(0,0,0,0.35)', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator color="#fff" />
                </View>
              )}
              {!imageUri && (
                <View
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    borderWidth: 2,
                    borderColor: '#0FA6A6',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#FEFCF0',
                  }}
                >
                  <Ionicons name="add" size={16} color="#0FA6A6" />
                </View>
              )}
            </View>
          </TouchableOpacity>

          {/* Event name */}
          <Text style={labelStyle}>Name of the event...</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder=""
            style={inputStyle}
            maxLength={120}
            returnKeyType="next"
          />

          {/* About */}
          <Text style={labelStyle}>About this event...</Text>
          <TextInput
            value={about}
            onChangeText={setAbout}
            placeholder=""
            style={[inputStyle, { height: 100, textAlignVertical: 'top', paddingTop: 12 }]}
            multiline
            maxLength={1000}
          />

          {/* Date & Time row */}
          <View style={{ flexDirection: 'row', gap: 16, marginBottom: 4 }}>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>Date:</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <TextInput
                  value={month}
                  onChangeText={(t) => setMonth(t.replace(/\D/g, '').slice(0, 2))}
                  placeholder="MM"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad"
                  maxLength={2}
                  style={[smallInputStyle]}
                />
                <Text style={{ color: '#9CA3AF', fontSize: 16 }}>/</Text>
                <TextInput
                  value={day}
                  onChangeText={(t) => setDay(t.replace(/\D/g, '').slice(0, 2))}
                  placeholder="DD"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad"
                  maxLength={2}
                  style={[smallInputStyle]}
                />
                <Text style={{ color: '#9CA3AF', fontSize: 16 }}>/</Text>
                <TextInput
                  value={year}
                  onChangeText={(t) => setYear(t.replace(/\D/g, '').slice(0, 4))}
                  placeholder="YYYY"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad"
                  maxLength={4}
                  style={[smallInputStyle, { width: 56 }]}
                />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>Time:</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <TextInput
                  value={startHour}
                  onChangeText={(t) => setStartHour(t.replace(/\D/g, '').slice(0, 2))}
                  placeholder="HH"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad"
                  maxLength={2}
                  style={smallInputStyle}
                />
                <Text style={{ color: '#9CA3AF', fontSize: 16 }}>:</Text>
                <TextInput
                  value={startMin}
                  onChangeText={(t) => setStartMin(t.replace(/\D/g, '').slice(0, 2))}
                  placeholder="MM"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad"
                  maxLength={2}
                  style={smallInputStyle}
                />
                <Text style={{ color: '#9CA3AF', fontSize: 12 }}> - </Text>
                <TextInput
                  value={endHour}
                  onChangeText={(t) => setEndHour(t.replace(/\D/g, '').slice(0, 2))}
                  placeholder="HH"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad"
                  maxLength={2}
                  style={smallInputStyle}
                />
                <Text style={{ color: '#9CA3AF', fontSize: 16 }}>:</Text>
                <TextInput
                  value={endMin}
                  onChangeText={(t) => setEndMin(t.replace(/\D/g, '').slice(0, 2))}
                  placeholder="MM"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad"
                  maxLength={2}
                  style={smallInputStyle}
                />
              </View>
            </View>
          </View>

          {/* Location */}
          <Text style={[labelStyle, { marginTop: 8 }]}>Location:</Text>
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder=""
            style={inputStyle}
            returnKeyType="next"
          />

          {/* Building & Room */}
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>Building:</Text>
              <TextInput value={building} onChangeText={setBuilding} style={inputStyle} returnKeyType="next" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={labelStyle}>Room:</Text>
              <TextInput value={room} onChangeText={setRoom} style={inputStyle} returnKeyType="done" />
            </View>
          </View>

          {/* View / Visibility */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 20 }}>
            <Ionicons name="eye-outline" size={22} color="#0FA6A6" style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={[labelStyle, { marginBottom: 10 }]}>View:</Text>
              {(['everyone', 'members', 'specific'] as Visibility[]).map((v) => (
                <TouchableOpacity
                  key={v}
                  onPress={() => setVisibility(v)}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 10,
                    backgroundColor: '#fff',
                    borderRadius: 10,
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderWidth: 1,
                    borderColor: '#E5E7EB',
                  }}
                >
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      borderWidth: 2,
                      borderColor: visibility === v ? '#0FA6A6' : '#9CA3AF',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {visibility === v && (
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
                  <Text
                    style={{
                      fontSize: 14,
                      color: '#374151',
                      fontFamily: 'Inter_400Regular',
                      fontStyle: 'italic',
                    }}
                  >
                    {v === 'everyone' ? 'Everyone' : v === 'members' ? 'Members' : 'Only these members'}
                  </Text>
                </TouchableOpacity>
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
            disabled={submitting}
            activeOpacity={0.85}
            style={{
              backgroundColor: '#0FA6A6',
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

      {/* Club Selector Modal */}
      <Modal
        visible={clubSelectorVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setClubSelectorVisible(false)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
          activeOpacity={1}
          onPress={() => setClubSelectorVisible(false)}
        >
          <View
            style={{
              backgroundColor: '#FEFCF0',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 20,
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: '700',
                color: '#111827',
                fontFamily: 'Zain_700Bold',
                marginBottom: 16,
                textAlign: 'center',
              }}
            >
              Select Host
            </Text>
            {officerClubs.map((club) => (
              <TouchableOpacity
                key={club.id}
                onPress={() => {
                  setSelectedClub(club);
                  setHostingSelf(false);
                  setClubSelectorVisible(false);
                }}
                activeOpacity={0.7}
                style={{
                  paddingVertical: 14,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  backgroundColor: selectedClub?.id === club.id ? 'rgba(15,166,166,0.08)' : '#fff',
                  marginBottom: 8,
                  borderWidth: 1,
                  borderColor: selectedClub?.id === club.id ? '#0FA6A6' : '#E5E7EB',
                }}
              >
                <Text style={{ fontSize: 15, color: '#111827', fontFamily: 'Inter_500Medium' }}>
                  @{club.name}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => {
                setHostingSelf(true);
                setSelectedClub(null);
                setClubSelectorVisible(false);
              }}
              activeOpacity={0.7}
              style={{
                paddingVertical: 14,
                paddingHorizontal: 12,
                borderRadius: 12,
                backgroundColor: hostingSelf && !selectedClub ? 'rgba(15,166,166,0.08)' : '#fff',
                marginBottom: 8,
                borderWidth: 1,
                borderColor: hostingSelf && !selectedClub ? '#0FA6A6' : '#E5E7EB',
              }}
            >
              <Text style={{ fontSize: 15, color: '#111827', fontFamily: 'Inter_500Medium' }}>
                @Myself
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
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

  const { data: { publicUrl } } = supabase.storage.from('posts').getPublicUrl(data.path);
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

const smallInputStyle = {
  backgroundColor: '#fff',
  borderRadius: 10,
  borderWidth: 1,
  borderColor: '#E5E7EB',
  paddingHorizontal: 8,
  paddingVertical: 10,
  fontSize: 13,
  color: '#111827',
  fontFamily: 'Inter_400Regular',
  width: 44,
  textAlign: 'center' as const,
};
