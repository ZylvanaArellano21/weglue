import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@weglue/shared';
import { createPost } from '../../services/postService';
import { getUserMemberClubs, UserClub } from '../../services/clubService';
import { useToast } from '../../components/Toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export default function NewPostScreen() {
  const router = useRouter();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const { show, ToastComponent } = useToast();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [selectedClub, setSelectedClub] = useState<UserClub | null>(null);
  const [clubSelectorVisible, setClubSelectorVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data: memberClubs = [] } = useQuery<UserClub[]>({
    queryKey: ['memberClubs', userId],
    queryFn: () => getUserMemberClubs(userId!),
    enabled: !!userId,
  });

  const handlePickFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      show(
        'We Glue needs access to your photo library to share photos in posts.',
        'error',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const handlePickFromCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      show(
        'We Glue needs access to your camera to take photos for posts.',
        'error',
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    if (!userId) return;
    if (!imageUri) {
      show('Please select a photo.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await createPost(userId, imageUri, caption.trim() || undefined, selectedClub?.id);
      queryClient.invalidateQueries({ queryKey: ['homePostsFeed', userId] });
      show('Post shared! 📸');
      setTimeout(() => router.back(), 800);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to post. Try again.';
      show(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top', 'bottom']}>
      {ToastComponent}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
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
            New Post
          </Text>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Image Picker */}
          {imageUri ? (
            <View style={{ position: 'relative', marginBottom: 20 }}>
              <Image
                source={{ uri: imageUri }}
                style={{ width: '100%', aspectRatio: 1, borderRadius: 16 }}
                resizeMode="cover"
              />
              <TouchableOpacity
                onPress={() => setImageUri(null)}
                activeOpacity={0.8}
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  borderRadius: 16,
                  padding: 6,
                }}
              >
                <Ionicons name="close" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
              <TouchableOpacity
                onPress={handlePickFromLibrary}
                activeOpacity={0.8}
                style={{
                  flex: 1,
                  aspectRatio: 1,
                  backgroundColor: '#fff',
                  borderRadius: 16,
                  borderWidth: 2,
                  borderColor: '#E5E7EB',
                  borderStyle: 'dashed',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <Ionicons name="images-outline" size={36} color="#9CA3AF" />
                <Text style={{ fontSize: 13, color: '#9CA3AF', fontFamily: 'Inter_400Regular' }}>
                  Camera Roll
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handlePickFromCamera}
                activeOpacity={0.8}
                style={{
                  flex: 1,
                  aspectRatio: 1,
                  backgroundColor: '#fff',
                  borderRadius: 16,
                  borderWidth: 2,
                  borderColor: '#E5E7EB',
                  borderStyle: 'dashed',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <Ionicons name="camera-outline" size={36} color="#9CA3AF" />
                <Text style={{ fontSize: 13, color: '#9CA3AF', fontFamily: 'Inter_400Regular' }}>
                  Camera
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Caption */}
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="Write a caption..."
            placeholderTextColor="#9CA3AF"
            style={{
              backgroundColor: '#fff',
              borderRadius: 12,
              borderWidth: 1,
              borderColor: '#E5E7EB',
              paddingHorizontal: 14,
              paddingVertical: 12,
              fontSize: 15,
              color: '#111827',
              fontFamily: 'Inter_400Regular',
              height: 100,
              textAlignVertical: 'top',
              marginBottom: 16,
            }}
            multiline
            maxLength={500}
          />

          {/* Tag a Club */}
          <Text
            style={{
              fontSize: 14,
              fontWeight: '600',
              color: '#374151',
              fontFamily: 'Inter_600SemiBold',
              marginBottom: 8,
            }}
          >
            Tag a club (optional)
          </Text>
          <TouchableOpacity
            onPress={() => setClubSelectorVisible(true)}
            activeOpacity={0.7}
            style={{
              backgroundColor: '#fff',
              borderRadius: 12,
              borderWidth: 1,
              borderColor: selectedClub ? '#0FA6A6' : '#E5E7EB',
              paddingHorizontal: 14,
              paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text
              style={{
                fontSize: 14,
                color: selectedClub ? '#0FA6A6' : '#9CA3AF',
                fontFamily: 'Inter_400Regular',
              }}
            >
              {selectedClub ? selectedClub.name : 'Select a club...'}
            </Text>
            {selectedClub ? (
              <TouchableOpacity
                onPress={() => setSelectedClub(null)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
              >
                <Ionicons name="close-circle" size={18} color="#0FA6A6" />
              </TouchableOpacity>
            ) : (
              <Ionicons name="chevron-down" size={18} color="#9CA3AF" />
            )}
          </TouchableOpacity>
        </ScrollView>

        {/* Post button */}
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
            disabled={submitting || !imageUri}
            activeOpacity={0.85}
            style={{
              backgroundColor: submitting || !imageUri ? '#9CA3AF' : '#0FA6A6',
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
                Post
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Club selector modal */}
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
              maxHeight: '60%',
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
              Tag a Club
            </Text>
            {memberClubs.length === 0 ? (
              <Text style={{ color: '#9CA3AF', textAlign: 'center', fontFamily: 'Inter_400Regular' }}>
                You haven't joined any clubs yet.
              </Text>
            ) : (
              memberClubs.map((club) => (
                <TouchableOpacity
                  key={club.id}
                  onPress={() => {
                    setSelectedClub(club);
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
                    {club.name}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
