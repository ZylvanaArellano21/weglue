import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import { captureRef } from 'react-native-view-shot';
import qrcodegen from 'qrcode-generator';

// ─── We Glue QR share screen (phones) ───────────────────────────────────────
// One reusable screen for every phone QR share (club profile, club Members
// chat). Cream ground, teal accents, We Glue typography.
//
// The QR value is ALWAYS the same string as Copy link and Share — the caller
// passes one `url`. Download saves the identity + QR card (no action buttons)
// straight to Photos via react-native-view-shot + expo-media-library.
//
// Larger devices (iPad) keep their existing inline QR — callers gate on screen
// size and only mount this on phones.

const CREAM = '#FEFCF0';
const CARD = '#FFFFFF';
const TEAL = '#0FA6A6';
const INK = '#1A1A1A';
const MUTED = '#5F5D5D';

function QrMatrix({ value, size }: { value: string; size: number }) {
  const rows = useMemo(() => {
    // 'M' error correction (~15%): the URLs here are short, so this stays a
    // low, sparse version that scans reliably on screen and after the PNG has
    // been saved, re-shared and re-displayed.
    const qr = qrcodegen(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const grid: boolean[][] = [];
    for (let r = 0; r < count; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < count; c++) row.push(qr.isDark(r, c));
      grid.push(row);
    }
    return grid;
  }, [value]);

  // An integer cell size is essential: a fractional width leaves hairline white
  // seams between modules (RN rounds each View's frame independently), which a
  // scanner can misread — very visible once the code is blown up full-screen.
  // The rendered grid is therefore a touch smaller than `size` and centred.
  const cell = Math.max(1, Math.floor(size / rows.length));
  const grid = cell * rows.length;

  return (
    <View style={{ width: grid, height: grid, backgroundColor: '#fff' }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', height: cell }}>
          {row.map((dark, c) => (
            <View
              key={c}
              style={{ width: cell, height: cell, backgroundColor: dark ? '#000' : '#fff' }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

export interface QrShareScreenProps {
  visible: boolean;
  onClose: () => void;
  /** Primary identity line, e.g. "Accounting Club". */
  title: string;
  /** Optional second identity line, e.g. "Members Chat". */
  subtitle?: string;
  /** The URL the QR encodes — identical to the Copy link and Share URLs. */
  url: string;
  /** Label for the middle action button. Default: "Share". */
  shareLabel?: string;
  /** Sentence prefixed to the URL in the OS share sheet. */
  shareMessage: string;
  /** File-name stem (no extension) for the saved image. */
  fileName: string;
}

function ActionButton({
  icon,
  label,
  onPress,
  busy,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.action} onPress={onPress} activeOpacity={0.7} disabled={busy}>
      <View style={styles.actionIcon}>
        {busy ? (
          <ActivityIndicator color={TEAL} size="small" />
        ) : (
          <Ionicons name={icon} size={22} color={TEAL} />
        )}
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

export function QrShareScreen({
  visible,
  onClose,
  title,
  subtitle,
  url,
  shareLabel = 'Share',
  shareMessage,
  fileName,
}: QrShareScreenProps) {
  const cardRef = useRef<View>(null);
  const { width, height } = useWindowDimensions();
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  // Tapping the code opens a plain full-bleed QR so it fills the screen and
  // scans from across a room. Nothing else on that view — just the code.
  const [zoomed, setZoomed] = useState(false);
  const zoomSize = Math.min(width, height) - 56;

  function handleClose() {
    setZoomed(false);
    setCopied(false);
    onClose();
  }

  async function copyLink() {
    try {
      await Clipboard.setStringAsync(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      Alert.alert("Couldn't copy the link", 'Please try again.');
    }
  }

  async function share() {
    try {
      await Share.share({ message: `${shareMessage} ${url}` });
    } catch {
      // dismissed
    }
  }

  async function download() {
    if (saving) return;
    setSaving(true);
    setSavedNote(null);
    try {
      // writeOnly = the "add to library" permission (NSPhotoLibraryAddUsageDescription).
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) {
        Alert.alert(
          'Photo access needed',
          'Allow We Glue to add photos so it can save the QR code to your library.',
        );
        return;
      }
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        fileName,
      });
      await MediaLibrary.saveToLibraryAsync(uri);
      setSavedNote('Saved to Photos');
      setTimeout(() => setSavedNote(null), 2500);
    } catch {
      Alert.alert("Couldn't save the image", 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={zoomed ? () => setZoomed(false) : handleClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
    >
      {/* A React Native <Modal> is its own window and is NOT a child of the
          app's SafeAreaProvider, so a plain SafeAreaView inside it reads zero
          insets and the close button ends up under the notch / status bar.
          Its own provider fixes the top + bottom insets on every device. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <TouchableOpacity onPress={handleClose} hitSlop={12} style={styles.closeBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={26} color={INK} />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            {/* Everything inside this card is what Download captures — identity
                + QR on cream, no action buttons. collapsable=false keeps the
                view in the native tree for react-native-view-shot on Android.
                Tapping the code opens the full-screen QR (see the zoom overlay
                below) so another phone can scan it from a distance. */}
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => setZoomed(true)}
              accessibilityRole="button"
              accessibilityLabel="Enlarge QR code"
            >
              <View ref={cardRef} collapsable={false} style={styles.card}>
                <Image
                  source={require('../../assets/logo.png')}
                  style={styles.logo}
                  resizeMode="contain"
                />
                <Text style={styles.title} numberOfLines={2}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
                <View style={styles.qrWrap}>
                  <QrMatrix value={url} size={232} />
                </View>
                <Text style={styles.brand}>We Glue</Text>
              </View>
            </TouchableOpacity>
            <Text style={styles.scanHint}>
              {copied ? 'Link copied' : 'Tap the code to enlarge it for scanning'}
            </Text>
          </View>

          <View style={styles.actions}>
            <ActionButton
              icon={copied ? 'checkmark' : 'link-outline'}
              label={copied ? 'Copied' : 'Copy link'}
              onPress={copyLink}
            />
            <ActionButton icon="share-outline" label={shareLabel} onPress={share} />
            <ActionButton
              icon="download-outline"
              label={saving ? 'Saving…' : 'Download'}
              onPress={download}
              busy={saving}
            />
          </View>
          <Text style={styles.savedNote}>{savedNote ?? ' '}</Text>
        </SafeAreaView>

        {/* Full-screen QR — just the code on white, nothing else. Tap anywhere
            to go back. This is what opens when the code on the card is tapped. */}
        {zoomed ? (
          <Pressable
            style={styles.zoomOverlay}
            onPress={() => setZoomed(false)}
            accessibilityRole="button"
            accessibilityLabel="Close enlarged QR code"
          >
            <View style={styles.zoomInner}>
              <QrMatrix value={url} size={zoomSize} />
            </View>
            <Text style={styles.zoomHint}>Tap anywhere to close</Text>
          </Pressable>
        ) : null}
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },
  topBar: {
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: CARD,
    borderRadius: 28,
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 24,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 6,
  },
  logo: { width: 48, height: 44, marginBottom: 12 },
  title: {
    fontFamily: 'Zain_700Bold',
    fontSize: 24,
    color: INK,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    marginTop: 2,
  },
  qrWrap: {
    marginTop: 20,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  brand: {
    fontFamily: 'Zain_700Bold',
    fontSize: 16,
    color: TEAL,
    marginTop: 16,
  },
  scanHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
    marginTop: 16,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  action: {
    alignItems: 'center',
    gap: 6,
    minWidth: 84,
  },
  actionIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(15,166,166,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: INK,
  },
  savedNote: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: TEAL,
    textAlign: 'center',
    paddingVertical: 10,
    minHeight: 34,
  },
  zoomOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  zoomInner: {
    padding: 12,
    backgroundColor: '#fff',
  },
  zoomHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
  },
});
