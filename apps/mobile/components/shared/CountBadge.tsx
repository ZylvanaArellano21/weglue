import { Text, View, type ViewStyle } from 'react-native';

/**
 * The one numeric unread badge (Notifications entry, Messages tab).
 *
 * Design rules (approved corrections): a SMALL solid-red TRUE CIRCLE with a
 * small white centered number. Never square, never rounded-square, never an
 * oversized floating bubble. "9+" (the cap) may widen into a pill only as
 * far as legibility requires. Renders nothing at count <= 0 — no decorative
 * badges without a meaningful count.
 */
const BADGE_SIZE = 16;

export function CountBadge({ count, style }: { count: number; style?: ViewStyle }) {
  if (!Number.isFinite(count) || count <= 0) return null;
  const label = count > 9 ? '9+' : String(count);
  const widen = label.length > 1;

  return (
    <View
      pointerEvents="none"
      style={[
        {
          minWidth: BADGE_SIZE,
          height: BADGE_SIZE,
          borderRadius: BADGE_SIZE / 2,
          paddingHorizontal: widen ? 3 : 0,
          backgroundColor: '#EF4444',
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text
        allowFontScaling={false}
        style={{
          color: '#FFFFFF',
          fontSize: 10,
          lineHeight: 12,
          fontWeight: '700',
          fontFamily: 'Inter_700Bold',
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

const DOT_SIZE = 8;

/**
 * A plain unlabeled indicator dot — same solid-red circle language as
 * CountBadge, but for "there's something new" signals that have no count to
 * show (e.g. the Posts selector's new-post indicator). Renders nothing when
 * `show` is false.
 */
export function NotificationDot({
  show,
  style,
  accessibilityLabel,
}: {
  show: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  if (!show) return null;
  return (
    <View
      pointerEvents="none"
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          width: DOT_SIZE,
          height: DOT_SIZE,
          borderRadius: DOT_SIZE / 2,
          backgroundColor: '#EF4444',
        },
        style,
      ]}
    />
  );
}
