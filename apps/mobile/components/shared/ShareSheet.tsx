import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Avatar } from './Avatar';
import {
  getSuggestedPeople,
  getMyGroupChats,
  searchChats,
  shareContentToTargets,
  type ShareContent,
  type ShareTarget,
  type PeopleResult,
  type ChatResult,
} from '../../services/chatService';
import {
  getEventShareUrl,
  getPostShareUrl,
  copyLinkToClipboard,
  shareToWhatsApp,
  shareToMessages,
  shareToInstagram,
  shareLinkExternally,
  shareMediaFileExternally,
} from '../../lib/share';
import type { ToastType } from '../Toast';

// ─── Internal + external share sheet ─────────────────────────────────────────
// One sheet for events, posts and private chat media. Internally: multi-select
// across people, custom groups and club Members/Officers chats (each a distinct
// destination), delivered as REAL messages (never a signed URL as text; media
// is copied into the destination's private folder). Externally: link share for
// public content, real-file OS share for media, with Copy Link hidden for
// private media (no secure public link exists).

export type ShareContentType = 'event' | 'post' | 'media';

export type ShareMedia = { sourcePath: string; kind: 'image' | 'video'; mime?: string | null; name?: string | null };

export interface ShareSheetContentProps {
  /** Called to dismiss the Share layer (route pop). */
  onDone: () => void;
  userId: string | undefined;
  contentType: ShareContentType;
  /** eventId / postId. For media, any stable identity string (unused for send). */
  contentId: string;
  /** Required when contentType === 'media'. */
  media?: ShareMedia;
  onShowToast: (message: string, type?: ToastType) => void;
}

type Selected = { key: string; target: ShareTarget; label: string };

/**
 * Share body (no Modal wrapper). Rendered by the root-level `/share` route
 * (app/share.tsx) as a transparent-modal layer so it covers/disables the tab
 * bar and stays a real entry in the navigation history — dismissing returns to
 * the exact originating content, and sending never jumps to the Messages tab.
 */
export function ShareSheetContent({ onDone, userId, contentType, contentId, media, onShowToast }: ShareSheetContentProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, Selected>>({});
  const [sending, setSending] = useState(false);
  const isTyping = query.trim().length > 0;
  const isMedia = contentType === 'media';

  // Suggested = people + my group/club chats. Search = people + matching chats.
  const { data: suggestedPeople, isLoading: suggestLoading } = useQuery({
    queryKey: ['suggestedPeople', userId],
    queryFn: () => getSuggestedPeople(userId!),
    enabled: !!userId && !isTyping,
    staleTime: 5 * 60 * 1000,
  });
  const { data: suggestedChats } = useQuery({
    queryKey: ['suggestedShareChats', userId],
    queryFn: () => getMyGroupChats(userId!),
    enabled: !!userId && !isTyping,
    staleTime: 5 * 60 * 1000,
  });
  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['chatSearch', userId, query],
    queryFn: () => searchChats(userId!, query),
    enabled: !!userId && isTyping,
    staleTime: 30 * 1000,
  });

  const people: PeopleResult[] = isTyping ? searchResults?.people ?? [] : suggestedPeople ?? [];
  const chats: ChatResult[] = isTyping ? searchResults?.chats ?? [] : suggestedChats ?? [];
  const listLoading = isTyping ? searchLoading : suggestLoading;

  type Row =
    | { kind: 'person'; person: PeopleResult }
    | { kind: 'chat'; chat: ChatResult };
  const rows: Row[] = useMemo(
    () => [
      ...people.map((p) => ({ kind: 'person' as const, person: p })),
      ...chats.map((c) => ({ kind: 'chat' as const, chat: c })),
    ],
    [people, chats],
  );

  const shareUrl = contentType === 'event' ? getEventShareUrl(contentId) : contentType === 'post' ? getPostShareUrl(contentId) : '';
  const shareText =
    contentType === 'event'
      ? `Check out this event on We Glue: ${shareUrl}`
      : `Check out this post on We Glue: ${shareUrl}`;

  function buildContent(): ShareContent | null {
    if (contentType === 'event') return { type: 'event', eventId: contentId };
    if (contentType === 'post') return { type: 'post', postId: contentId };
    if (media) return { type: 'media', sourcePath: media.sourcePath, kind: media.kind, name: media.name, mime: media.mime };
    return null;
  }

  function toggle(sel: Selected) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[sel.key]) delete next[sel.key];
      else next[sel.key] = sel;
      return next;
    });
  }

  const selectedList = Object.values(selected);

  async function handleSend() {
    const content = buildContent();
    if (!content || sending || selectedList.length === 0 || !userId) return;
    setSending(true);
    try {
      const result = await shareContentToTargets(userId, selectedList.map((s) => s.target), content);
      if (result.sent > 0) {
        const n = result.sent;
        onShowToast(
          result.failed > 0
            ? `Sent to ${n} ${n === 1 ? 'chat' : 'chats'} · ${result.failed} failed`
            : `Sent to ${n} ${n === 1 ? 'chat' : 'chats'}`,
          result.failed > 0 ? 'error' : 'success',
        );
        handleClose();
      } else {
        onShowToast('Could not send. Try again.', 'error');
      }
    } catch {
      onShowToast('Could not send. Try again.', 'error');
    } finally {
      setSending(false);
    }
  }

  async function handleExternal(key: string) {
    if (isMedia && media) {
      // Private media: share the real file via the OS sheet; never a link.
      const res = await shareMediaFileExternally(media);
      if (!res.ok) onShowToast(res.reason === 'unavailable' ? 'Media unavailable.' : 'Could not share.', 'error');
      handleClose();
      return;
    }
    if (key === 'copy') {
      const ok = await copyLinkToClipboard(shareUrl);
      onShowToast(ok ? 'Link copied!' : 'Failed to copy link.', ok ? 'success' : 'error');
    } else if (key === 'whatsapp') {
      const ok = await shareToWhatsApp(shareText);
      if (!ok) onShowToast('WhatsApp isn’t installed.', 'error');
    } else if (key === 'messages') {
      const ok = await shareToMessages(shareText);
      if (!ok) onShowToast('Couldn’t open Messages.', 'error');
    } else if (key === 'instagram') {
      const { copied } = await shareToInstagram(shareUrl);
      onShowToast(copied ? 'Link copied — paste it into Instagram' : 'Failed to copy link.', copied ? 'success' : 'error');
    } else if (key === 'more') {
      await shareLinkExternally(shareText);
    }
    handleClose();
  }

  function handleClose() {
    setQuery('');
    setSelected({});
    onDone();
  }

  const linkTargets = [
    { key: 'instagram', label: 'Instagram', icon: 'logo-instagram' as const, color: '#E1306C' },
    { key: 'messages', label: 'Messages', icon: 'chatbubble-ellipses-outline' as const, color: '#34C759' },
    { key: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' as const, color: '#25D366' },
    // Copy Link is public-content only — never expose a private media link.
    { key: 'copy', label: 'Copy Link', icon: 'link-outline' as const, color: '#0FA6A6' },
    { key: 'more', label: 'More', icon: 'ellipsis-horizontal' as const, color: '#6B7280' },
  ];
  const mediaTargets = [{ key: 'more', label: 'Share to…', icon: 'share-outline' as const, color: '#0FA6A6' }];
  const externalTargets = isMedia ? mediaTargets : linkTargets;

  return (
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Share</Text>

          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={18} color="#9CA3AF" style={styles.searchIcon} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search people, groups and clubs"
              placeholderTextColor="#9CA3AF"
              style={styles.searchInput}
            />
          </View>

          <Text style={styles.sectionHeader}>{isTyping ? 'Results' : 'Suggested'}</Text>

          {listLoading ? (
            <Text style={styles.loadingText}>Loading…</Text>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(item) => (item.kind === 'person' ? `user:${item.person.user_id}` : `conv:${item.chat.id}`)}
              style={{ maxHeight: 260 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                if (item.kind === 'person') {
                  const p = item.person;
                  const name = p.full_name?.trim() || p.username;
                  const key = `user:${p.user_id}`;
                  const on = !!selected[key];
                  return (
                    <TouchableOpacity
                      style={styles.personRow}
                      activeOpacity={0.7}
                      onPress={() => toggle({ key, target: { userId: p.user_id }, label: name })}
                    >
                      <Avatar uri={p.avatar_url} size={44} username={name} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.personName} numberOfLines={1}>{name}</Text>
                        <Text style={styles.personHint} numberOfLines={1}>@{p.username}</Text>
                      </View>
                      <SelectDot on={on} />
                    </TouchableOpacity>
                  );
                }
                const c = item.chat;
                const name = c.name ?? 'Group chat';
                const key = `conv:${c.id}`;
                const on = !!selected[key];
                return (
                  <TouchableOpacity
                    style={styles.personRow}
                    activeOpacity={0.7}
                    onPress={() => toggle({ key, target: { conversationId: c.id }, label: name })}
                  >
                    {c.avatar_url ? (
                      <Avatar uri={c.avatar_url} size={44} username={name} />
                    ) : (
                      <View style={styles.groupIcon}>
                        <Ionicons name="people" size={20} color="#0FA6A6" />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.personName} numberOfLines={1}>{name}</Text>
                      <Text style={styles.personHint} numberOfLines={1}>
                        {c.type === 'officer_chat' ? 'Officer chat' : c.type === 'club_group' ? 'Member chat' : 'Group'}
                      </Text>
                    </View>
                    <SelectDot on={on} />
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>{isTyping ? 'Nothing found.' : 'No suggestions yet.'}</Text>
              }
            />
          )}

          {selectedList.length > 0 && (
            <TouchableOpacity
              style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={sending}
              activeOpacity={0.85}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FEFCF0" />
              ) : (
                <Text style={styles.sendLabel}>
                  Send to {selectedList.length} {selectedList.length === 1 ? 'chat' : 'chats'}
                </Text>
              )}
            </TouchableOpacity>
          )}

          <View style={styles.divider} />

          <Text style={styles.sectionHeader}>Share externally</Text>
          <View style={styles.externalRow}>
            {externalTargets.map((target) => (
              <TouchableOpacity
                key={target.key}
                style={styles.externalItem}
                activeOpacity={0.7}
                onPress={() => handleExternal(target.key)}
              >
                <View style={[styles.externalIconCircle, { backgroundColor: `${target.color}18` }]}>
                  <Ionicons name={target.icon} size={22} color={target.color} />
                </View>
                <Text style={styles.externalLabel}>{target.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
  );
}

function SelectDot({ on }: { on: boolean }) {
  return (
    <View style={[styles.selectDot, on && styles.selectDotOn]}>
      {on && <Ionicons name="checkmark" size={16} color="#FEFCF0" />}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#FEFCF0',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 36,
    maxHeight: '85%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D1D5DB', marginBottom: 12 },
  title: { fontSize: 17, fontWeight: '700', color: '#111827', fontFamily: 'Inter_700Bold', marginBottom: 14, textAlign: 'center' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 16,
    paddingHorizontal: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 14, color: '#111827', fontFamily: 'Inter_400Regular' },
  sectionHeader: { fontSize: 13, fontWeight: '600', color: '#374151', fontFamily: 'Inter_600SemiBold', marginBottom: 8 },
  loadingText: { fontSize: 13, color: '#9CA3AF', fontFamily: 'Inter_400Regular', textAlign: 'center', paddingVertical: 20 },
  emptyText: { fontSize: 13, color: '#9CA3AF', fontFamily: 'Inter_400Regular', textAlign: 'center', paddingVertical: 16 },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  groupIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: 'rgba(15,166,166,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  personName: { fontSize: 14, color: '#111827', fontFamily: 'Inter_600SemiBold' },
  personHint: { fontSize: 11, color: '#9CA3AF', fontFamily: 'Inter_400Regular', marginTop: 1 },
  selectDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectDotOn: { backgroundColor: '#0FA6A6', borderColor: '#0FA6A6' },
  sendBtn: {
    backgroundColor: '#0FA6A6',
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    marginTop: 14,
    minHeight: 46,
  },
  sendBtnDisabled: { opacity: 0.6 },
  sendLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#FEFCF0' },
  divider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 16 },
  externalRow: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 4, flexWrap: 'wrap' },
  externalItem: { alignItems: 'center', gap: 8, minWidth: 64 },
  externalIconCircle: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  externalLabel: { fontSize: 11, color: '#374151', fontFamily: 'Inter_500Medium', textAlign: 'center' },
});
