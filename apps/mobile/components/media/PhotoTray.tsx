import { useState } from 'react';
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
  /** Carousel preview aspect (posts pass the shared ratio, chat 1/1-ish). Default 4/5. */
  aspectRatio?: number;
  /**
   * Single-image posts: show the lone image at its own natural ratio in the
   * preview instead of `aspectRatio`. Multi-image posts: use the first image's
   * natural ratio as the shared carousel ratio. (Chat leaves this off.)
   */
  naturalRatio?: boolean;
  /**
   * Post compose only: open the adjust / crop / ratio step for photo `index`.
   * When set, tapping a thumbnail or the "Adjust" control on the preview calls
   * this. Omit for chat, which keeps every image's natural framing untouched.
   */
  onAdjust?: (index: number) => void;
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * Preview + reorder + adjust before posting/sending a multi-photo carousel.
 *
 * The carousel preview at the top shows exactly how the published post will
 * behave. "Adjust" (bottom-left, post compose only) opens the ratio / crop /
 * reposition step for the photo currently on screen. The thumbnail strip below
 * lets the user drop a photo (×), reorder it (‹ ›) or tap it to adjust — the
 * order here is the order everyone sees.
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
  naturalRatio = false,
  onAdjust,
}: Props) {
  const width = Math.min(Dimensions.get('window').width - 32, 420);
  const canAddMore = !!onAddMore && photos.length < limit;
  const [current, setCurrent] = useState(0);
  const activeIndex = Math.min(current, Math.max(0, photos.length - 1));

  return (
    <View style={styles.wrap}>
      {photos.length > 0 ? (
        <View style={{ alignSelf: 'center' }}>
          <PhotoCarousel
            images={photos.map((p) => ({
              uri: p.uri,
              width: p.width || null,
              height: p.height || null,
            }))}
            width={width}
            aspectRatio={aspectRatio}
            naturalRatio={naturalRatio}
            onIndexChange={setCurrent}
          />
          {onAdjust ? (
            <TouchableOpacity
              style={styles.adjustPill}
              onPress={() => onAdjust(activeIndex)}
              accessibilityRole="button"
              accessibilityLabel={
                photos.length > 1 ? `Adjust photo ${activeIndex + 1}` : 'Adjust photo'
              }
            >
              <Ionicons name="crop" size={15} color="#FFFFFF" />
              <Text style={styles.adjustLabel}>Adjust</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <View style={styles.stripHeader}>
        <Text style={styles.stripTitle}>
          {photos.length} of {limit}
        </Text>
        <Text style={styles.stripHint}>
          {onAdjust ? 'Tap a photo to adjust · ‹ › to reorder' : 'Tap ‹ › to reorder'}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
      >
        {photos.map((p, i) => (
          <View key={`${p.uri}-${i}`} style={styles.cell}>
            <TouchableOpacity
              activeOpacity={onAdjust ? 0.8 : 1}
              disabled={!onAdjust}
              onPress={() => onAdjust?.(i)}
              style={styles.thumbWrap}
              accessibilityRole={onAdjust ? 'button' : 'image'}
              accessibilityLabel={onAdjust ? `Adjust photo ${i + 1}` : `Photo ${i + 1}`}
            >
              <Image source={{ uri: p.uri }} style={styles.thumb} />
              <View style={styles.orderBadge}>
                <Text style={styles.orderText}>{i + 1}</Text>
              </View>
              <View style={styles.removeBtn}>
                <TouchableOpacity
                  onPress={() => onChange(photos.filter((_, idx) => idx !== i))}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${i + 1}`}
                >
                  <Ionicons name="close" size={16} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>

            {photos.length > 1 ? (
              <View style={styles.moveRow}>
                <TouchableOpacity
                  disabled={i === 0}
                  onPress={() => onChange(move(photos, i, i - 1))}
                  style={[styles.moveBtn, i === 0 && styles.moveBtnOff]}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Move photo ${i + 1} earlier`}
                >
                  <Ionicons name="chevron-back" size={18} color={INK} />
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={i === photos.length - 1}
                  onPress={() => onChange(move(photos, i, i + 1))}
                  style={[styles.moveBtn, i === photos.length - 1 && styles.moveBtnOff]}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Move photo ${i + 1} later`}
                >
                  <Ionicons name="chevron-forward" size={18} color={INK} />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ))}

        {canAddMore ? (
          <TouchableOpacity
            style={styles.addTile}
            onPress={onAddMore}
            accessibilityRole="button"
            accessibilityLabel="Add more photos"
          >
            <Ionicons name="add" size={28} color={TEAL} />
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
  naturalRatio?: boolean;
  onAdjust?: (index: number) => void;
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

const THUMB = 88;

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
    gap: 14,
  },
  adjustPill: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  adjustLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#FFFFFF',
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
    flexShrink: 1,
    textAlign: 'right',
  },
  strip: {
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  cell: {
    width: THUMB,
    gap: 6,
  },
  thumbWrap: {
    width: THUMB,
    height: THUMB,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: 14,
    backgroundColor: '#E5E7EB',
  },
  orderBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    color: '#FFFFFF',
  },
  removeBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: 1.5,
    borderColor: '#FEFCF0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  moveBtn: {
    width: 40,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveBtnOff: {
    opacity: 0.35,
  },
  addTile: {
    width: THUMB,
    height: THUMB,
    borderRadius: 14,
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
