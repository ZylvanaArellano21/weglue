import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Dimensions,
  Modal,
  Animated,
  PanResponder,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../shared/Avatar';
import { usePostDetail } from '../../hooks/useHomePostsFeed';
import type { ClubPhoto } from '../../services/clubService';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const DISMISS_THRESHOLD = 120;
const REST_OPACITY = 0.92; // matches the existing single-photo viewer's backdrop

interface PhotoGalleryModalProps {
  visible: boolean;
  photos: ClubPhoto[];
  initialIndex: number;
  viewerUserId: string;
  onClose: () => void;
  onOpenPost: (postId: string) => void;
}

export function PhotoGalleryModal({
  visible,
  photos,
  initialIndex,
  viewerUserId,
  onClose,
  onOpenPost,
}: PhotoGalleryModalProps) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const listRef = useRef<Animated.FlatList<ClubPhoto>>(null);
  const pan = useRef(new Animated.ValueXY()).current;
  const scrollX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      pan.setValue({ x: 0, y: 0 });
      scrollX.setValue(initialIndex * SCREEN_WIDTH);
      setCurrentIndex(initialIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialIndex]);

  const backdropOpacity = pan.y.interpolate({
    inputRange: [-SCREEN_HEIGHT / 2, 0, SCREEN_HEIGHT / 2],
    outputRange: [0.3, REST_OPACITY, 0.3],
    extrapolate: 'clamp',
  });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        Math.abs(gesture.dy) > 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5,
      onPanResponderMove: Animated.event([null, { dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_, gesture) => {
        if (Math.abs(gesture.dy) > DISMISS_THRESHOLD) {
          Animated.timing(pan, {
            toValue: { x: 0, y: gesture.dy > 0 ? SCREEN_HEIGHT : -SCREEN_HEIGHT },
            duration: 200,
            useNativeDriver: false,
          }).start(() => {
            pan.setValue({ x: 0, y: 0 });
            onClose();
          });
        } else {
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
            friction: 8,
          }).start();
        }
      },
    }),
  ).current;

  const getItemLayout = (_: ArrayLike<ClubPhoto> | null | undefined, index: number) => ({
    length: SCREEN_WIDTH,
    offset: SCREEN_WIDTH * index,
    index,
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: '#000',
          opacity: backdropOpacity,
          transform: pan.getTranslateTransform(),
        }}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          onPress={onClose}
          activeOpacity={0.7}
          hitSlop={{ top: 12, left: 12, right: 12, bottom: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Close photo gallery"
          style={{
            position: 'absolute',
            top: insets.top + 8,
            right: 16,
            zIndex: 10,
            backgroundColor: 'rgba(0,0,0,0.5)',
            borderRadius: 18,
            padding: 8,
          }}
        >
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>

        <Animated.FlatList
          ref={listRef}
          data={photos}
          keyExtractor={(p: ClubPhoto) => p.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={getItemLayout}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
            setCurrentIndex(idx);
          }}
          renderItem={({ item, index }: { item: ClubPhoto; index: number }) => {
            const opacity = scrollX.interpolate({
              inputRange: [
                (index - 1) * SCREEN_WIDTH,
                index * SCREEN_WIDTH,
                (index + 1) * SCREEN_WIDTH,
              ],
              outputRange: [0.4, 1, 0.4],
              extrapolate: 'clamp',
            });
            return (
              <Animated.View style={{ opacity }}>
                {item.source === 'tagged_post' && item.post_id ? (
                  <TaggedPhotoSlide
                    photo={item}
                    postId={item.post_id}
                    viewerUserId={viewerUserId}
                    insetTop={insets.top}
                    insetBottom={insets.bottom}
                    onOpenPost={onOpenPost}
                  />
                ) : (
                  <DirectPhotoSlide photo={item} insetTop={insets.top} insetBottom={insets.bottom} />
                )}
              </Animated.View>
            );
          }}
          windowSize={5}
          maxToRenderPerBatch={3}
          initialNumToRender={3}
          removeClippedSubviews
        />

        {photos.length > 1 && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              bottom: insets.bottom + 16,
              left: 0,
              right: 0,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', fontFamily: 'Inter_500Medium' }}>
              {currentIndex + 1} / {photos.length}
            </Text>
          </View>
        )}
      </Animated.View>
    </Modal>
  );
}

function DirectPhotoSlide({
  photo,
  insetTop,
  insetBottom,
}: {
  photo: ClubPhoto;
  insetTop: number;
  insetBottom: number;
}) {
  return (
    <View style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
      <Image
        source={{ uri: photo.url }}
        style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT - insetTop - insetBottom }}
        resizeMode="contain"
      />
    </View>
  );
}

function TaggedPhotoSlide({
  photo,
  postId,
  viewerUserId,
  insetTop,
  insetBottom,
  onOpenPost,
}: {
  photo: ClubPhoto;
  postId: string;
  viewerUserId: string;
  insetTop: number;
  insetBottom: number;
  onOpenPost: (postId: string) => void;
}) {
  const { data: post, isLoading } = usePostDetail(postId, viewerUserId);

  return (
    <View style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
      <Image
        source={{ uri: photo.url }}
        style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT - insetTop - insetBottom }}
        resizeMode="contain"
      />

      {isLoading && (
        <View style={{ position: 'absolute', bottom: insetBottom + 48 }}>
          <ActivityIndicator color="#fff" />
        </View>
      )}

      {post && (
        <TouchableOpacity
          onPress={() => onOpenPost(postId)}
          activeOpacity={0.85}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: insetBottom + 24,
          }}
        >
          {/* Legibility scrim — the caption sits directly over photo content, which
              can be light-colored, so a flat translucent backing keeps text readable
              without needing a gradient library */}
          <View
            style={{
              marginHorizontal: 16,
              backgroundColor: 'rgba(0,0,0,0.45)',
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Avatar uri={post.author.avatar_url} size={32} username={post.author.username} />
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff', fontFamily: 'Inter_700Bold' }}>
                @{post.author.username}
              </Text>
            </View>
            {post.caption ? (
              <Text
                style={{ fontSize: 13, color: '#fff', fontFamily: 'Inter_400Regular', marginBottom: 8 }}
                numberOfLines={2}
              >
                {post.caption}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Ionicons
                  name={post.user_has_liked ? 'heart' : 'heart-outline'}
                  size={18}
                  color={post.user_has_liked ? '#F02719' : '#fff'}
                />
                <Text style={{ fontSize: 13, color: '#fff', fontFamily: 'Inter_400Regular' }}>
                  {post.likes_count}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Ionicons name="chatbubble-outline" size={18} color="#fff" />
                <Text style={{ fontSize: 13, color: '#fff', fontFamily: 'Inter_400Regular' }}>
                  {post.comments_count}
                </Text>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}
