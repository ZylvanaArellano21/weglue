import { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../shared/Avatar';
import { CarouselBadge } from '../shared/PhotoCarousel';
import { cardSurface, cardClip, cardDepth } from '../shared/cardStyles';
import { timeAgo } from '../home/PostCard';
import type { FeedPost } from '../../services/postService';
import type { EventDetail } from '../../services/eventService';

// Off-screen Instagram Story source card. Rendered invisibly (opacity 0,
// pointerEvents none) and captured to a PNG by lib/story/renderStoryImage.ts
// via react-native-view-shot — never a screenshot of the live app screen.
//
// This deliberately mirrors PostCard.tsx / EventCard.tsx as closely as
// possible (same card surface, same avatar/name/caption/date layout, same
// colors) so the shared image reads as "content from We Glue," not a
// separately-designed marketing graphic. Interactive-only affordances that
// have no meaning on a flat exported image (Follow/Join pills, RSVP button,
// bookmark, tap targets) are omitted; metadata that is real social proof
// (like/comment counts, attendee count) is kept, per product spec.

export const STORY_CANVAS_WIDTH = 360;
export const STORY_CANVAS_HEIGHT = 640; // 9:16 — matches Instagram's Story frame

const CARD_WIDTH = STORY_CANVAS_WIDTH - 48;
const TEAL = '#0FA6A6';

function formatEventDate(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatEventTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Fires `onReady` once every image this card needs has settled (loaded or
 *  failed — a broken image must never hang the capture indefinitely). */
function useImagesSettled(uris: Array<string | null | undefined>, onReady: () => void) {
  const remaining = useRef(uris.filter(Boolean).length);
  const fired = useRef(false);
  useEffect(() => {
    remaining.current = uris.filter(Boolean).length;
    fired.current = false;
    if (remaining.current === 0) {
      fired.current = true;
      onReady();
    }
    // Safety net: never block a Story share indefinitely on a slow/broken image.
    const timeout = setTimeout(() => {
      if (!fired.current) {
        fired.current = true;
        onReady();
      }
    }, 4000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uris.join('|')]);

  return () => {
    remaining.current -= 1;
    if (remaining.current <= 0 && !fired.current) {
      fired.current = true;
      onReady();
    }
  };
}

export function PostStoryCard({ post, onReady }: { post: FeedPost; onReady: () => void }) {
  const images = post.images && post.images.length > 0
    ? post.images
    : post.image_url
      ? [{ path: post.image_url, position: 0 }]
      : [];
  const firstImage = images[0] ?? null;
  // Only the main photo blocks capture — Avatar has no load callback to hook
  // into, and a not-yet-loaded avatar circle is an acceptable degradation.
  const settle = useImagesSettled([firstImage?.path], onReady);

  return (
    <View style={styles.canvas}>
      <View style={[styles.card, cardDepth, { width: CARD_WIDTH }]}>
        <View style={{ ...cardSurface, ...cardClip }}>
          <View style={styles.authorRow}>
            <Avatar uri={post.author.avatar_url} size={36} username={post.author.username} />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.authorName}>@{post.author.username}</Text>
              {post.tagged_clubs.length > 0 && (
                <Text style={styles.tagLine} numberOfLines={1}>
                  tag {post.tagged_clubs.map((c) => c.name).join(', ')}
                </Text>
              )}
            </View>
          </View>

          {firstImage ? (
            <View style={{ width: '100%', aspectRatio: 4 / 5 }}>
              <Image
                source={{ uri: firstImage.path }}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
                onLoadEnd={settle}
              />
              {images.length > 1 && <CarouselBadge size={14} />}
            </View>
          ) : null}

          <View style={styles.interactionRow}>
            <View style={styles.interactionItem}>
              <Ionicons name={post.user_has_liked ? 'heart' : 'heart-outline'} size={18} color={post.user_has_liked ? '#F02719' : '#374151'} />
              <Text style={styles.interactionCount}>{post.likes_count}</Text>
            </View>
            <View style={styles.interactionItem}>
              <Ionicons name="chatbubble-outline" size={16} color="#374151" />
              <Text style={styles.interactionCount}>{post.comments_count}</Text>
            </View>
            <Ionicons name="paper-plane-outline" size={16} color="#374151" />
          </View>

          {post.caption ? (
            <Text style={styles.caption} numberOfLines={3}>
              <Text style={styles.authorName}>@{post.author.username} </Text>
              {post.caption}
            </Text>
          ) : null}
          <Text style={styles.timestamp}>{timeAgo(post.created_at)}</Text>
        </View>
      </View>
      <WeGlueMark />
    </View>
  );
}

export function EventStoryCard({ event, onReady }: { event: EventDetail; onReady: () => void }) {
  const settle = useImagesSettled([event.cover_image_url], onReady);

  return (
    <View style={styles.canvas}>
      <View style={[styles.card, cardDepth, { width: CARD_WIDTH }]}>
        <View style={[cardClip, { backgroundColor: '#FEFFF8' }]}>
          <View style={styles.authorRow}>
            <Avatar uri={event.club.avatar_url} size={30} username={event.club.name} />
            <Text style={styles.clubName} numberOfLines={1}>{event.club.name}</Text>
          </View>

          {event.cover_image_url ? (
            <View style={{ width: '100%', aspectRatio: 3 / 2 }}>
              <Image
                source={{ uri: event.cover_image_url }}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
                onLoadEnd={settle}
              />
            </View>
          ) : null}

          <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 }}>
            <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={14} color="#0A0A0A" />
              <Text style={styles.metaText}>
                {formatEventDate(event.event_date)} · {formatEventTime(event.start_time)}
              </Text>
            </View>
            {(event.location || event.building) && (
              <View style={styles.metaRow}>
                <Ionicons name="location-outline" size={14} color="#000000" />
                <Text style={styles.metaText} numberOfLines={1}>
                  {event.location ?? `Building ${event.building}, Room ${event.room}`}
                </Text>
              </View>
            )}
            {event.attendee_count > 0 && (
              <Text style={styles.metaText}>{event.attendee_count} going</Text>
            )}
          </View>
        </View>
      </View>
      <WeGlueMark />
    </View>
  );
}

function WeGlueMark() {
  return (
    <View style={styles.mark}>
      <Text style={styles.markText}>We Glue</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    width: STORY_CANVAS_WIDTH,
    height: STORY_CANVAS_HEIGHT,
    backgroundColor: '#FEFCF0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { borderRadius: 16 },
  authorRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  authorName: { fontSize: 13, fontWeight: '700', color: '#111827', fontFamily: 'Inter_700Bold' },
  clubName: { flex: 1, marginLeft: 8, fontSize: 14, fontWeight: '600', color: '#5F5D5D', fontFamily: 'Inter_600SemiBold' },
  tagLine: { fontSize: 11, color: '#6B7280', fontFamily: 'Inter_400Regular', marginTop: 2 },
  interactionRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 12, paddingTop: 10 },
  interactionItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  interactionCount: { fontSize: 12, color: '#374151', fontFamily: 'Inter_400Regular' },
  caption: { fontSize: 12, color: '#111827', fontFamily: 'Inter_400Regular', paddingHorizontal: 12, paddingTop: 6 },
  timestamp: { fontSize: 10, color: '#9CA3AF', fontFamily: 'Inter_400Regular', paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10 },
  eventTitle: { fontSize: 15, fontWeight: '600', color: '#000000', fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  metaText: { fontSize: 11, color: '#5F5D5D', fontFamily: 'Inter_500Medium' },
  mark: { marginTop: 14 },
  markText: { fontSize: 13, fontWeight: '700', color: TEAL, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },
});
