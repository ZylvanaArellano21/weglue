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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { pickMedia, useWeGlueMediaFlow } from '../../lib/media/pickMedia';
import { useAuthStore } from '@weglue/shared';
import { createPost } from '../../services/postService';
import { getAllClubs, UserClub } from '../../services/clubService';
import { useToast } from '../../components/Toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SearchBottomSheet } from '../../components/shared/SearchBottomSheet';
import { useHomeTabStore } from '../../store/homeTabStore';
import { invalidateClubDataEverywhere } from '../../lib/clubCache';

// One New Post screen, two entry points — never two implementations:
//
//  • From Home ("Share a Glue → Picture"): photo + caption + the optional
//    multi-select "Tag a club" search.
//  • From a Club Profile, officers only (`lockedClubId`): the club is attached
//    permanently. The tag search is not rendered at all, so the club cannot be
//    removed or changed, and there is nothing to add a second club with.
//
// Both produce the SAME post row with the SAME post_clubs tag, so the post
// appears in Home → Posts AND in that club's profile — one post, two places.
export default function NewPostScreen() {
  const router = useRouter();
  const { lockedClubId, lockedClubName } = useLocalSearchParams<{
    lockedClubId?: string;
    lockedClubName?: string;
  }>();
  const locked = !!lockedClubId;
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const { show, ToastComponent } = useToast();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [selectedClubs, setSelectedClubs] = useState<UserClub[]>([]);
  const [clubSelectorVisible, setClubSelectorVisible] = useState(false);
  const [clubSearch, setClubSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: allClubs = [], isLoading: loadingClubs } = useQuery<UserClub[]>({
    queryKey: ['allClubs'],
    queryFn: getAllClubs,
    // The locked flow never renders the picker, so it must not fetch its list.
    enabled: !locked,
  });

  const filteredClubs = allClubs.filter((c) =>
    c.name.toLowerCase().includes(clubSearch.toLowerCase()),
  );

  // Android routes through the shared We Glue flow; iOS keeps its existing
  // expo-image-picker path. Posts keep their free-form (uncropped) image.
  const handlePickFromLibrary = async () => {
    if (useWeGlueMediaFlow) {
      const picked = await pickMedia({ source: 'library', quality: 0.8 });
      if (picked) setImageUri(picked.uri);
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      show('We Glue needs access to your photo library to share photos in posts.', 'error');
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
    if (useWeGlueMediaFlow) {
      const picked = await pickMedia({ source: 'camera', quality: 0.8 });
      if (picked) setImageUri(picked.uri);
      return;
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      show('We Glue needs access to your camera to take photos for posts.', 'error');
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

  const toggleClub = (club: UserClub) => {
    setSelectedClubs((prev) => {
      const exists = prev.some((c) => c.id === club.id);
      return exists ? prev.filter((c) => c.id !== club.id) : [...prev, club];
    });
  };

  const removeClub = (clubId: string) => {
    setSelectedClubs((prev) => prev.filter((c) => c.id !== clubId));
  };

  const handleSubmit = async () => {
    if (!userId) return;
    if (!imageUri) {
      show('Please select a photo.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      // In locked mode the club comes from the route, never from component
      // state, so no interaction can drop or swap it.
      const clubIds = locked ? [lockedClubId!] : selectedClubs.map((c) => c.id);
      const newPostId = await createPost(
        userId,
        imageUri,
        caption.trim() || undefined,
        clubIds.length > 0 ? clubIds : undefined,
      );
      // Refetch the Home posts feed so the new post is present, then land the
      // user on Home → Posts with the feed scrolled to the post they just
      // created (PostsFeed picks up pendingScrollPostId once the post is in
      // its data). router.back() preserves the Home screen they came from.
      await queryClient.invalidateQueries({ queryKey: ['homePostsFeed', userId] });
      if (locked) {
        // Posting from a club profile returns to that profile, so refresh the
        // club's own caches (photos / media) as well as Home. The Home tab is
        // still pointed at Posts so the same post is waiting there too.
        invalidateClubDataEverywhere(queryClient);
      }
      useHomeTabStore.getState().setActiveTab('posts');
      useHomeTabStore.getState().setPendingScrollPostId(newPostId);
      show('Post shared! 📸');
      setTimeout(() => {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)');
      }, 600);
    } catch (err: unknown) {
      console.error('[new-post] create failed', err);
      show('Failed to post. Please try again.', 'error');
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
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
            activeOpacity={0.7}
            hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
          >
            <Ionicons name="chevron-back" size={26} color="#111827" />
          </TouchableOpacity>
          <Text
            pointerEvents="none"
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

          {/* Locked club (posting from a Club Profile) — read-only, no control
              that could unset it. */}
          {locked ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                backgroundColor: 'rgba(15,166,166,0.08)',
                borderRadius: 12,
                borderWidth: 1,
                borderColor: '#0FA6A6',
                paddingHorizontal: 14,
                paddingVertical: 12,
              }}
            >
              <Ionicons name="people-outline" size={18} color="#0FA6A6" />
              <Text style={{ fontSize: 13, color: '#6B7280', fontFamily: 'Inter_400Regular' }}>
                Posting to
              </Text>
              <Text style={{ flex: 1, fontSize: 15, color: '#111827', fontFamily: 'Inter_600SemiBold' }}>
                {lockedClubName || 'this club'}
              </Text>
            </View>
          ) : (
          <>
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

          {/* Selected clubs chips */}
          {selectedClubs.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {selectedClubs.map((club) => (
                <View
                  key={club.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: '#0FA6A6',
                    borderRadius: 20,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    gap: 6,
                  }}
                >
                  <Text style={{ fontSize: 13, color: '#fff', fontFamily: 'Inter_500Medium' }}>
                    {club.name}
                  </Text>
                  <TouchableOpacity
                    onPress={() => removeClub(club.id)}
                    hitSlop={{ top: 6, left: 6, right: 6, bottom: 6 }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close-circle" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Search trigger */}
          <TouchableOpacity
            onPress={() => {
              setClubSearch('');
              setClubSelectorVisible(true);
            }}
            activeOpacity={0.7}
            style={{
              backgroundColor: '#fff',
              borderRadius: 12,
              borderWidth: 1,
              borderColor: '#E5E7EB',
              paddingHorizontal: 14,
              paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Ionicons name="search-outline" size={18} color="#9CA3AF" />
            <Text style={{ fontSize: 14, color: '#9CA3AF', fontFamily: 'Inter_400Regular', flex: 1 }}>
              Search clubs...
            </Text>
          </TouchableOpacity>
          </>
          )}
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
                Post
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Tag a Club — keyboard-safe bottom sheet, multi-select. Never mounted in
          locked mode: the club is fixed by the route it was opened from. */}
      {!locked && (
      <SearchBottomSheet<UserClub>
        visible={clubSelectorVisible}
        title="Tag a Club"
        searchPlaceholder="Search clubs..."
        data={filteredClubs}
        keyExtractor={(c) => c.id}
        onSearch={(q) => setClubSearch(q)}
        onSelect={toggleClub}
        onClose={() => setClubSelectorVisible(false)}
        loading={loadingClubs}
        emptyText="No clubs found."
        multiSelect
        selectedItems={selectedClubs}
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
              gap: 10,
            }}
          >
            <Text style={{ flex: 1, fontSize: 15, color: '#111827', fontFamily: 'Inter_500Medium' }}>
              {club.name}
            </Text>
            {isSelected && <Ionicons name="checkmark-circle" size={20} color="#0FA6A6" />}
          </View>
        )}
      />
      )}
    </SafeAreaView>
  );
}
