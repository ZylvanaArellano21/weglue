import {
  View,
  Text,
  Image,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PhotoCarousel } from '../shared/PhotoCarousel';
import { MAX_PHOTOS } from '../../lib/media/pickPhotos';
import type { PickedMedia } from '../../lib/media/types';

const TEAL = '#0FA6A6';
const INK = '#111827';
const MUTED = '#6B7280';

interface Props {
  photos: PickedMedia[];
  onChange: (photos: PickedMedia[]) => void;
  onConfirm?: () => void;
  /** e.g. "Post", "Send", "Next". */
  confirmLabel?: string;
  /** Hide the built-in confirm button (host screen provides its own). */
  showConfirm?: boolean;
  /** Re-open the picker to append more (disabled at the limit). */
  onAddMore?: () => void;
  busy?: boolean;
  limit?: number;
  /** Carousel preview aspect (posts 4/5, chat 1/1-ish). Default 4/5. */
  aspectRatio?: number;
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * Preview + reorder before posting/sending a multi-photo carousel.
 *
 * The carousel preview at the top shows exactly how the published post will
 * behave. The numbered thumbnail strip lets the user drop a photo (×) or move
 * it earlier/later (‹ ›) — the order here is the order everyone sees.
 */
export function PhotoTray({
  photos,
  onChange,
  onConfirm,
  confirmLabel = 'Next',
  showConfirm = true,
  onAddMore,
  busy = false,
  limit = MAX_PHOTOS,
  aspectRatio = 4 / 5,
}: Props) {
  const width = Math.min(Dimensions.get('window').width - 32, 420);
  const canAddMore = !!onAddMore && photos.length < limit;

  return (
    <View style={styles.wrap}>
      {photos.length > 0 ? (
        <PhotoCarousel
          images={photos.map((p) => ({ uri: p.uri }))}
          width={width}
          aspectRatio={aspectRatio}
          style={{ alignSelf: 'center' }}
        />
      ) : null}

      <View style={styles.stripHeader}>
        <Text style={styles.stripTitle}>
          {photos.length}/{limit} photo{photos.length === 1 ? '' : 's'}
        </Text>
        <Text style={styles.stripHint}>Tap ‹ › to reorder</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
      >
        {photos.map((p, i) => (
          <View key={`${p.uri}-${i}`} style={styles.thumbWrap}>
            <Image source={{ uri: p.uri }} style={styles.thumb} />
            <View style={styles.orderBadge}>
              <Text style={styles.orderText}>{i + 1}</Text>
            </View>
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={() => onChange(photos.filter((_, idx) => idx !== i))}
              hitSlop={8}
              accessibilityLabel={`Remove photo ${i + 1}`}
            >
              <Ionicons name="close" size={13} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={styles.moveRow}>
              <TouchableOpacity
                disabled={i === 0}
                onPress={() => onChange(move(photos, i, i - 1))}
                style={[styles.moveBtn, i === 0 && styles.moveBtnOff]}
                hitSlop={6}
                accessibilityLabel={`Move photo ${i + 1} earlier`}
              >
                <Ionicons name="chevron-back" size={14} color="#FFFFFF" />
              </TouchableOpacity>
              <TouchableOpacity
                disabled={i === photos.length - 1}
                onPress={() => onChange(move(photos, i, i + 1))}
                style={[styles.moveBtn, i === photos.length - 1 && styles.moveBtnOff]}
                hitSlop={6}
                accessibilityLabel={`Move photo ${i + 1} later`}
              >
                <Ionicons name="chevron-forward" size={14} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {canAddMore ? (
          <TouchableOpacity style={styles.addTile} onPress={onAddMore} accessibilityLabel="Add more photos">
            <Ionicons name="add" size={26} color={TEAL} />
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      {showConfirm ? (
        <TouchableOpacity
          style={[styles.confirm, (photos.length === 0 || busy) && styles.confirmOff]}
          onPress={onConfirm}
          disabled={photos.length === 0 || busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.confirmText}>{confirmLabel}</Text>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

interface ModalProps {
  visible: boolean;
  photos: PickedMedia[];
  onChange: (photos: PickedMedia[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  onAddMore?: () => void;
  busy?: boolean;
  limit?: number;
  aspectRatio?: number;
  title?: string;
}

/** Full-screen preview + reorder step, e.g. before sending photos in a chat. */
export function PhotoTrayModal({
  visible,
  onCancel,
  title = 'Photos',
  ...tray
}: ModalProps) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.modalRoot} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onCancel} hitSlop={10} accessibilityLabel="Cancel">
            <Ionicons name="close" size={26} color={INK} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>{title}</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.modalBody}>
          <PhotoTray {...tray} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const THUMB = 68;

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: '#FEFCF0',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  modalTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    color: INK,
  },
  modalBody: {
    flex: 1,
    justifyContent: 'center',
  },
  wrap: {
    gap: 12,
  },
  stripHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  stripTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: INK,
  },
  stripHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: MUTED,
  },
  strip: {
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  thumbWrap: {
    width: THUMB,
    height: THUMB,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: 10,
    backgroundColor: '#E5E7EB',
  },
  orderBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    color: '#FFFFFF',
  },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveRow: {
    position: 'absolute',
    bottom: 3,
    left: 3,
    right: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  moveBtn: {
    width: 22,
    height: 20,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveBtnOff: {
    opacity: 0.3,
  },
  addTile: {
    width: THUMB,
    height: THUMB,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: TEAL,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirm: {
    marginHorizontal: 16,
    height: 46,
    borderRadius: 23,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmOff: {
    opacity: 0.5,
  },
  confirmText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: '#FFFFFF',
  },
});
