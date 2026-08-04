import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../shared/Avatar';
import { useAndroidKeyboardHeight } from '../../lib/useAndroidKeyboardHeight';
import { usePostComments, useAddComment, usePostDetail } from '../../hooks/useHomePostsFeed';
import { timeAgo } from './PostCard';
import type { PostComment } from '../../services/postService';

interface CommentsSheetProps {
  visible: boolean;
  postId: string;
  viewerUserId: string;
  onClose: () => void;
}

export function CommentsSheet({ visible, postId, viewerUserId, onClose }: CommentsSheetProps) {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  // Android: lift the sheet (and its composer) above the keyboard; iOS keeps
  // KeyboardAvoidingView. See useAndroidKeyboardHeight for why.
  const { height: androidKeyboardHeight } = useAndroidKeyboardHeight();
  const { data: post, isLoading: isPostLoading } = usePostDetail(
    visible ? postId : undefined,
    viewerUserId,
  );
  const { data: comments = [], isLoading } = usePostComments(visible ? postId : undefined);
  const { mutate: submitComment, isPending } = useAddComment();

  // Open a commenter's profile. The sheet is a native Modal that would cover a
  // pushed screen, so we dismiss it first, then navigate. Back from the profile
  // returns to the post/feed the sheet was opened from.
  const handlePressCommenter = (userId: string) => {
    onClose();
    router.push({ pathname: '/profile/[userId]', params: { userId } });
  };

  const handleSend = () => {
    const content = draft.trim();
    if (!content || isPending) return;
    submitComment(
      { postId, userId: viewerUserId, content },
      { onSuccess: () => setDraft('') },
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={Platform.OS === 'android' ? { marginBottom: androidKeyboardHeight } : undefined}
        >
          <SafeAreaView
            style={{
              backgroundColor: '#FEFCF0',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: '85%',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.12,
              shadowRadius: 16,
              elevation: 24,
            }}
            // While lifted above the Android keyboard the bottom inset would
            // add a nav-bar-sized gap under the composer — drop it then.
            edges={androidKeyboardHeight > 0 ? [] : ['bottom']}
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

            {!isPostLoading && !post ? (
              <View style={{ padding: 24, alignItems: 'center' }}>
                <Text style={{ color: '#6B7280', textAlign: 'center', fontFamily: 'Inter_400Regular' }}>
                  This post is no longer available.
                </Text>
              </View>
            ) : isLoading || isPostLoading ? (
              <View style={{ padding: 24, alignItems: 'center' }}>
                <ActivityIndicator color="#0FA6A6" />
              </View>
            ) : (
              <FlatList<PostComment>
                data={comments}
                keyExtractor={(c) => c.id}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}
                style={{ minHeight: 120 }}
                ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
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
                renderItem={({ item }) => (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      onPress={() => handlePressCommenter(item.author.id)}
                      activeOpacity={0.7}
                    >
                      <Avatar uri={item.author.avatar_url} size={32} username={item.author.username} />
                    </TouchableOpacity>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, color: '#111827', fontFamily: 'Inter_400Regular' }}>
                        <Text
                          onPress={() => handlePressCommenter(item.author.id)}
                          style={{ fontWeight: '700', fontFamily: 'Inter_700Bold' }}
                        >
                          @{item.author.username}{' '}
                        </Text>
                        {item.content}
                      </Text>
                      <Text
                        style={{
                          fontSize: 11,
                          color: '#9CA3AF',
                          fontFamily: 'Inter_400Regular',
                          marginTop: 2,
                        }}
                      >
                        {timeAgo(item.created_at)}
                      </Text>
                    </View>
                  </View>
                )}
              />
            )}

            {post ? <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 16,
                paddingTop: 8,
                paddingBottom: 16,
                borderTopWidth: 1,
                borderTopColor: '#E5E7EB',
              }}
            >
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Add a comment..."
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
            </View> : null}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
