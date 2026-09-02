import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
  Share,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import qrcodegen from 'qrcode-generator';
import { getInviteToken, INVITE_BASE_URL } from '../../services/messagingService';
import { chatColors, chatFonts, chatShadow, chatTypography } from './chatTheme';
import { QrShareScreen } from '../share/QrShareScreen';

// ─── Share sheet for chat invitations ────────────────────────────────────────
// Only rendered for authorized managers (officers on Members chats, the
// creator on custom groups) — and the server re-validates every call.
// The link and the QR code point at the SAME opaque, non-expiring token.
// There is no "reset link" action: the link-reset feature was removed.
//
// "Show QR code" on a PHONE opens the full We Glue QR share screen
// (QrShareScreen). On iPad it keeps the existing inline QR — that larger-device
// experience is intentionally left unchanged.

// The stored title for a club Members chat is "<Club> · Members". The QR
// screen shows the student-facing two-line form instead.
const MEMBERS_SUFFIX = / · Members$/;

interface Props {
  visible: boolean;
  conversationId: string;
  chatTitle: string;
  onClose: () => void;
}

function QrCode({ value, size }: { value: string; size: number }) {
  const matrix = useMemo(() => {
    const qr = qrcodegen(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const rows: boolean[][] = [];
    for (let r = 0; r < count; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < count; c++) row.push(qr.isDark(r, c));
      rows.push(row);
    }
    return rows;
  }, [value]);

  const cell = size / matrix.length;

  return (
    <View style={{ width: size, height: size, backgroundColor: '#fff' }}>
      {matrix.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', height: cell }}>
          {row.map((dark, c) => (
            <View key={c} style={{ width: cell, backgroundColor: dark ? '#000' : '#fff' }} />
          ))}
        </View>
      ))}
    </View>
  );
}

export function ShareInviteSheet({ visible, conversationId, chatTitle, onClose }: Props) {
  const { width } = useWindowDimensions();
  const isPhone = width < 600;

  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showQrScreen, setShowQrScreen] = useState(false);
  const [copied, setCopied] = useState(false);

  const isMembersChat = MEMBERS_SUFFIX.test(chatTitle);
  const qrTitle = isMembersChat ? chatTitle.replace(MEMBERS_SUFFIX, '') : chatTitle;
  const qrSubtitle = isMembersChat ? 'Members Chat' : undefined;

  useEffect(() => {
    if (!visible) {
      setShowQr(false);
      setShowQrScreen(false);
      setCopied(false);
      return;
    }
    setLoading(true);
    getInviteToken(conversationId)
      .then(setToken)
      .catch(() => {
        Alert.alert('Not available', 'You are not allowed to share this chat.');
        onClose();
      })
      .finally(() => setLoading(false));
  }, [visible, conversationId]);

  const link = token ? `${INVITE_BASE_URL}/${token}` : null;

  async function copyLink() {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function nativeShare() {
    if (!link) return;
    try {
      await Share.share({ message: `Join ${chatTitle} on We Glue: ${link}` });
    } catch {
      // dismissed
    }
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.title}>Invite to {chatTitle}</Text>
            <Text style={styles.sub}>
              Anyone from your university with this link can join. The link doesn't expire.
            </Text>

            {loading || !link ? (
              <ActivityIndicator color={chatColors.teal} style={{ marginVertical: 32 }} />
            ) : showQr ? (
              <View style={styles.qrWrap}>
                <QrCode value={link} size={220} />
                <TouchableOpacity onPress={() => setShowQr(false)} style={styles.qrBack}>
                  <Text style={styles.qrBackLabel}>Hide QR code</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <TouchableOpacity style={styles.row} onPress={copyLink} activeOpacity={0.7}>
                  <View style={styles.iconWrap}>
                    <Ionicons name={copied ? 'checkmark' : 'link-outline'} size={22} color={chatColors.teal} />
                  </View>
                  <Text style={styles.rowLabel}>{copied ? 'Copied!' : 'Copy link'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.row}
                  onPress={() => (isPhone ? setShowQrScreen(true) : setShowQr(true))}
                  activeOpacity={0.7}
                >
                  <View style={styles.iconWrap}>
                    <Ionicons name="qr-code-outline" size={22} color={chatColors.teal} />
                  </View>
                  <Text style={styles.rowLabel}>Show QR code</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.row} onPress={nativeShare} activeOpacity={0.7}>
                  <View style={styles.iconWrap}>
                    <Ionicons name="share-outline" size={22} color={chatColors.teal} />
                  </View>
                  <Text style={styles.rowLabel}>Share…</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {isPhone && link && (
        <QrShareScreen
          visible={showQrScreen}
          onClose={() => setShowQrScreen(false)}
          title={qrTitle}
          subtitle={qrSubtitle}
          url={link}
          shareLabel="Share group chat"
          shareMessage={`Join ${qrTitle}${qrSubtitle ? ` ${qrSubtitle}` : ''} on We Glue:`}
          fileName={`weglue-${qrTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-chat-qr`}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: chatColors.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 34,
    paddingHorizontal: 22,
    ...chatShadow,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: chatColors.textMuted,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 12,
  },
  title: {
    ...chatTypography.chatTitle,
    fontSize: 18,
  },
  sub: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
    lineHeight: 17,
    marginTop: 4,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(15,166,166,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    ...chatTypography.infoRow,
  },
  qrWrap: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 16,
  },
  qrBack: {
    paddingVertical: 8,
  },
  qrBackLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    color: chatColors.teal,
  },
});
