import { Platform, type ViewStyle } from 'react-native';

/**
 * Shared card-depth system.
 *
 * One restrained elevation for content cards — posts, events, club cards,
 * Discovery cards and equivalent surfaces — so they read as slightly raised
 * from the We Glue cream background. No borders, no heavy floating shadow.
 *
 * Visual target: ~3px downward offset, ~12px blur, ~9% black opacity,
 * translated per platform (iOS shadow*, Android elevation, web box-shadow).
 *
 * Rules:
 *  - The depth belongs to the OUTER card surface only.
 *  - Never apply to pieces inside a card (image, text, avatar).
 *  - Never apply to the active carousel photo.
 *  - On Android, a view that both clips children (`overflow: 'hidden'`) and
 *    carries `elevation` drops its shadow. For those cards, put `cardDepth`
 *    on an outer wrapper and the clipping + radius on an inner view
 *    (see `cardClip`).
 */
export const CARD_RADIUS = 16;

/** Card background + corner radius. Pair with `cardDepth` (or use `raisedCard`). */
export const cardSurface = {
  backgroundColor: '#FFFFFF',
  borderRadius: CARD_RADIUS,
} as const satisfies ViewStyle;

/** Elevation only. Put on the outermost card view (no `overflow: 'hidden'` there). */
export const cardDepth = Platform.select<ViewStyle>({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.09,
    shadowRadius: 12,
  },
  android: { elevation: 3 },
  default: {
    // react-native-web
    boxShadow: '0px 3px 12px rgba(0, 0, 0, 0.09)',
  },
}) as ViewStyle;

/** Inner clipping layer for cards that render edge-to-edge media. */
export const cardClip = {
  borderRadius: CARD_RADIUS,
  overflow: 'hidden',
} as const satisfies ViewStyle;

/** Surface + depth in one style. Add layout/margins at the call site. */
export const raisedCard: ViewStyle = {
  ...cardSurface,
  ...cardDepth,
};
