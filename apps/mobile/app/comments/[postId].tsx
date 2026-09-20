/**
 * Comments — root-level transparent-modal route (was a RN <Modal> sheet).
 *
 * As a real route the sheet is a layer in the navigation history: tapping a
 * commenter pushes their profile ABOVE this route, so Back restores the SAME
 * Comments instance — its loaded comments, scroll position and draft all
 * survive because the route stays mounted underneath. The old sheet had to
 * dismiss itself before navigating, losing all of that.
 *
 * Journey: Post → Comments → Commenter Profile → Message
 *   Back: Message → Profile → (same) Comments → close → (same) Post.
 *
 * Replies (migration 128): one immediate-parent link per comment, rendered as
 * a single visual level. A reply-to-a-reply stays at that one level and shows
 * "↩ @who" so the thread is still readable. The DB notifies only the immediate
 * parent's author. `focusCommentId` (from a comment_reply notification route)
 * scrolls to and briefly highlights the reply.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter, useLocalSearchParams, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { Avatar } from '../../components/shared/Avatar';
import { useAndroidKeyboardHeight } from '../../lib/useAndroidKeyboardHeight';
import { useComposerBottomInset } from '../../lib/useComposerBottomInset';
import { usePostComments, useAddComment, usePostDetail } from '../../hooks/useHomePostsFeed';
import { timeAgo } from '../../components/home/PostCard';
import { threadComments, type PostComment } from '../../services/postService';
import { openReportFlow } from '../../components/shared/ReportButton';
import { openProfile } from '../../lib/profileNavigation';
import { clientUuid } from '../../lib/chatAttachments';

type Row =
  | { kind: 'root'; comment: PostComment }
  | { kind: 'reply'; comment: PostComment; replyingTo: string | null };

type ReplyTarget = { id: string; username: string };

export default function CommentsScreen() {
  const router = useRouter();
  const { postId, focusCommentId } = useLocalSearchParams<{ postId: string; focusCommentId?: string }>();
  const { session } = useAuthStore();
  const viewerUserId = session?.user.id ?? '';

  // Android: lift the sheet + composer above the keyboard (iOS keeps KAV).
  const { height: androidKeyboardHeight } = useAndroidKeyboardHeight();
  // Bottom breathing room, painted INSIDE the opaque sheet in both states.
  const composerBottomInset = useComposerBottomInset();
  const [draft, setDraft] = useState('');
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<Row>>(null);
  // One idempotency tag per comment; reused if a send has to be retried,
  // regenerated after a comment is posted (migration 100).
  const commentTagRef = useRef(clientUuid());
  const { data: post, isLoading: isPostLoading, isError: isPostError, refetch: refetchPost } = usePostDetail(postId, viewerUserId);
  const { data: comments = [], isLoading, isError: isCommentsError, refetch: refetchComments } = usePostComments(postId);
  const { mutate: submitComment, isPending } = useAddComment();

  // Flatten one-level threads into FlatList rows so virtualization and
  // scroll-to-index still work.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const thread of threadComments(comments)) {
      out.push({ kind: 'root', comment: thread.root });
      for (const reply of thread.replies) {
        out.push({ kind: 'reply', comment: reply, replyingTo: reply.replyingTo });
      }
    }
    return out;
  }, [comments]);

  // From a comment_reply notification: scroll to the reply once it's in the
  // list, then pulse a highlight so the user can spot it.
  const didFocusRef = useRef(false);
  useEffect(() => {
    if (didFocusRef.current || !focusCommentId || rows.length === 0) return;
    const index = rows.findIndex((r) => r.comment.id === focusCommentId);
    if (index < 0) return;
    didFocusRef.current = true;
    setHighlightId(focusCommentId);
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
    });
    const t = setTimeout(() => setHighlightId(null), 2400);
    return () => clearTimeout(t);
  }, [focusCommentId, rows]);

  // Push the commenter's profile ABOVE this route — no dismiss. Back restores
  // this exact Comments instance (draft + scroll intact).
  const handlePressCommenter = (userId: string) => {
    openProfile(router, userId, viewerUserId);
  };

  const close = () => {
    Keyboard.dismiss();
    router.back();
  };

  const startReply = (comment: PostComment) => {
    setReplyTarget({ id: comment.id, username: comment.author.username });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSend = () => {
    const content = draft.trim();
    if (!content || isPending) return;
    submitComment(
      {
        postId,
        userId: viewerUserId,
        content,
        clientTag: commentTagRef.current,
        parentCommentId: replyTarget?.id ?? null,
      },
      {
        onSuccess: () => {
          setDraft('');
          setReplyTarget(null);
          commentTagRef.current = clientUuid();
        },
      },
    );
  };

  // A Comments sheet with NO post id is never a legitimate state — this screen
  // is only ever reached by tapping comments on a specific post. It could only
  // be mounted param-less by the navigator itself choosing it as a launch
  // destination, which is the cold-launch bug fixed in app/_layout.tsx (the
  // anchor route must be declared first). This guard is the structural
  // backstop for that: rather than rendering "This post is no longer
  // available" over an empty screen and trapping the user, send them to Home —
  // the correct destination for opening the app. Declared AFTER every hook
  // above so hook order is never conditional.
  if (!postId) return <Redirect href="/(tabs)" />;

  const renderRow = ({ item }: { item: Row }) => {
    const c = item.comment;
    const isReply = item.kind === 'reply';
    const highlighted = highlightId === c.id;
    return (
      <View
        style={[
          { flexDirection: 'row', gap: 10 },
          isReply ? { marginLeft: 42 } : null,
          highlighted
            ? { backgroundColor: 'rgba(15,166,166,0.12)', borderRadius: 12, paddingVertical: 6, marginVertical: -6, paddingHorizontal: 6, marginHorizontal: -6 }
            : null,
        ]}
      >
        <TouchableOpacity onPress={() => handlePressCommenter(c.author.id)} activeOpacity={0.7}>
          <Avatar uri={c.author.avatar_url} size={isReply ? 26 : 32} username={c.author.username} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, color: '#111827', fontFamily: 'Inter_400Regular' }}>
            <Text
              onPress={() => handlePressCommenter(c.author.id)}
              style={{ fontWeight: '700', fontFamily: 'Inter_700Bold' }}
            >
              @{c.author.username}{' '}
            </Text>
            {isReply && item.replyingTo && item.replyingTo !== c.author.username ? (
              <Text style={{ color: '#0B7C7C', fontFamily: 'Inter_400Regular' }}>↩ @{item.replyingTo} </Text>
            ) : null}
            {c.content}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 3 }}>
            <Text style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'Inter_400Regular' }}>
              {timeAgo(c.created_at)}
            </Text>
            {post ? (
              <TouchableOpacity onPress={() => startReply(c)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Text style={{ fontSize: 11, color: '#6B7280', fontWeight: '700', fontFamily: 'Inter_700Bold' }}>
                  Reply
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        {c.author.id !== viewerUserId && (
          <TouchableOpacity
            onPress={() => openReportFlow({ entityType: 'comment', entityId: c.id, entityName: c.content })}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Report this comment"
            style={{ paddingTop: 2 }}
          >
            <Ionicons name="ellipsis-horizontal" size={16} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
      <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={close} />

      {/* flex:1 gives the sheet's `maxHeight: '85%'` a DEFINITE height to
          resolve against. Without it the KAV was content-sized, the percentage
          could not resolve, and the composer rendered outside the cream box —
          which is what exposed the feed behind the sheet. box-none keeps
          backdrop taps reaching the Pressable underneath. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
        style={[
          { flex: 1, justifyContent: 'flex-end' },
          // Lift the sheet above the Android IME (matches every other composer
          // surface — paddingBottom, not marginBottom). The composer's own
          // bottom inset (useComposerBottomInset) adds the strip buffer.
          Platform.OS === 'android' ? { paddingBottom: androidKeyboardHeight } : null,
        ]}
      >
        <View
          style={{
            backgroundColor: '#FEFCF0',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: '85%',
            // No composer (deleted post) → the sheet itself carries the inset
            // so it still reaches the bottom edge opaquely.
            paddingBottom: post ? 0 : composerBottomInset,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -4 },
            shadowOpacity: 0.12,
            shadowRadius: 16,
            elevation: 24,
          }}
        >
          <View style={{ alignItems: 'center', paddingTop: 8, marginBottom: 2 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#D1D5DB' }} />
          </View>

          <Text
            style={{
              fontSize: 16,
              fontWeight: '700',
              color: '#111827',
              fontFamily: 'Inter_700Bold',
              textAlign: 'center',
              marginTop: 10,
              marginBottom: 8,
            }}
          >
            Comments
          </Text>

          {isPostError && !post ? (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <Text style={{ color: '#6B7280' }}>Couldn't load post.</Text>
              <TouchableOpacity onPress={() => void refetchPost()} style={{ padding: 12 }}>
                <Text style={{ color: '#0FA6A6', fontWeight: '700' }}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : !isPostLoading && !post ? (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <Text style={{ color: '#6B7280', textAlign: 'center', fontFamily: 'Inter_400Regular' }}>
                This post is no longer available.
              </Text>
            </View>
          ) : isLoading || isPostLoading ? (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <ActivityIndicator color="#0FA6A6" />
            </View>
          ) : isCommentsError && comments.length === 0 ? (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <Text style={{ color: '#6B7280' }}>Couldn't load comments.</Text>
              <TouchableOpacity onPress={() => void refetchComments()} style={{ padding: 12 }}>
                <Text style={{ color: '#0FA6A6', fontWeight: '700' }}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList<Row>
              ref={listRef}
              data={rows}
              keyExtractor={(r) => r.comment.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}
              // flexShrink lets the list yield height to the composer instead
              // of pushing it off the sheet on long comment lists.
              style={{ minHeight: 120, flexGrow: 0, flexShrink: 1 }}
              ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
              onScrollToIndexFailed={({ index }) => {
                setTimeout(() => {
                  listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
                }, 200);
              }}
              ListEmptyComponent={
                <Text
                  style={{
                    color: '#9CA3AF',
                    textAlign: 'center',
                    fontFamily: 'Inter_400Regular',
                    paddingVertical: 24,
                  }}
                >
                  No comments yet. Be the first!
                </Text>
              }
              renderItem={renderRow}
            />
          )}

          {post ? (
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: '#E5E7EB',
                paddingBottom: composerBottomInset,
              }}
            >
              {replyTarget ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 16,
                    paddingTop: 8,
                    paddingBottom: 2,
                  }}
                >
                  <Text style={{ fontSize: 12, color: '#6B7280', fontFamily: 'Inter_400Regular' }}>
                    Replying to <Text style={{ fontWeight: '700', color: '#0B7C7C', fontFamily: 'Inter_700Bold' }}>@{replyTarget.username}</Text>
                  </Text>
                  <TouchableOpacity
                    onPress={() => setReplyTarget(null)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel reply"
                  >
                    <Ionicons name="close" size={16} color="#9CA3AF" />
                  </TouchableOpacity>
                </View>
              ) : null}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingHorizontal: 16,
                  paddingTop: replyTarget ? 4 : 8,
                }}
              >
                <TextInput
                  ref={inputRef}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={replyTarget ? `Reply to @${replyTarget.username}…` : 'Add a comment...'}
                  placeholderTextColor="#9CA3AF"
                  style={{
                    flex: 1,
                    backgroundColor: '#fff',
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: '#E5E7EB',
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    fontSize: 14,
                    color: '#111827',
                    fontFamily: 'Inter_400Regular',
                    maxHeight: 80,
                  }}
                  multiline
                  maxLength={500}
                />
                <TouchableOpacity
                  onPress={handleSend}
                  disabled={!draft.trim() || isPending}
                  activeOpacity={0.8}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: draft.trim() && !isPending ? '#0FA6A6' : '#9CA3AF',
                  }}
                >
                  {isPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="send" size={16} color="#fff" />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
