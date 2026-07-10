import { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  Pressable,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useClubChannels } from '../../hooks/useClubChannels';
import { chatColors, chatFonts, chatShadow, chatTypography } from './chatTheme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = SCREEN_WIDTH * 0.31;

interface Props {
  visible: boolean;
  clubId: string;
  /** Channels are scoped to THIS conversation — a club has separate member
   * and officer conversations and their channels must never mix. */
  conversationId: string;
  activeChannelId: string;
  isOfficer: boolean;
  onSelectChannel: (id: string, name: string) => void;
  onClose: () => void;
  onAddChannel?: () => void;
}

export function ChannelDrawer({
  visible,
  clubId,
  conversationId,
  activeChannelId,
  isOfficer,
  onSelectChannel,
  onClose,
  onAddChannel,
}: Props) {
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const { data: allChannels } = useClubChannels(clubId);
  const channels = (allChannels ?? []).filter((c) => c.conversation_id === conversationId);

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: visible ? 0 : -DRAWER_WIDTH,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [visible, translateX]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Animated.View style={[styles.drawer, { transform: [{ translateX }] }]}>
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {channels.map((ch) => {
            const active = ch.id === activeChannelId;
            return (
              <TouchableOpacity
                key={ch.id}
                style={[styles.channelRow, active && styles.channelRowActive]}
                onPress={() => {
                  onSelectChannel(ch.id, ch.name);
                  onClose();
                }}
                activeOpacity={0.75}
              >
                <Text style={[styles.channelText, active && styles.channelTextActive]}>
                  #{ch.name}
                </Text>
              </TouchableOpacity>
            );
          })}

          {isOfficer && onAddChannel && (
            <TouchableOpacity style={styles.addRow} onPress={onAddChannel} activeOpacity={0.75}>
              <Ionicons name="add" size={16} color={chatColors.teal} />
              <Text style={styles.addText}>Add Channel</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: DRAWER_WIDTH,
    backgroundColor: chatColors.bg,
    borderRightWidth: 1,
    borderRightColor: chatColors.border,
    ...chatShadow,
  },
  list: {
    paddingTop: 8,
  },
  channelRow: {
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: chatColors.border,
  },
  channelRowActive: {
    backgroundColor: 'rgba(15,166,166,0.08)',
  },
  channelText: {
    ...chatTypography.channelName,
  },
  channelTextActive: {
    color: chatColors.teal,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 14,
    marginTop: 4,
  },
  addText: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: chatColors.teal,
    letterSpacing: 0.38,
  },
});
