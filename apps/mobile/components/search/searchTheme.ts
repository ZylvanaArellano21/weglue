import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/** Figma Search tab tokens (file ZaAzanItzMQgvheIs2iBkR, frame 1325:1701) */
export const searchColors = {
  bg: '#FDFBEF',
  cream: '#FEFCF0',
  /** Card & inactive-pill surface. Pure white so raised cards/pills pop off
   *  the cream page — the old `cream` value was ~identical to `bg`, making
   *  every card and category pill invisible. */
  cardBg: '#FFFFFF',
  teal: '#0FA6A6',
  tealDark: '#0A8080',
  text: '#000000',
  /** Meeting/meta text — darkened for high contrast per the design. */
  meta: '#4A4A4A',
  white: '#FFFFFF',
  borderSearch: 'rgba(0,0,0,0.2)',
  tagBg: 'rgba(15,166,166,0.22)',
  imagePlaceholder: '#E5E7EB',
} as const;

export const searchFonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

/** Small raised shadow for category pills / tags. */
export const searchShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 4,
  },
  android: { elevation: 3 },
  default: {},
}) as ViewStyle;

/** Full-card raised 3D shadow. Softer + larger spread than a tight drop so the
 *  whole card reads as lifted off the page, and elevation keeps it visible on
 *  Android (where iOS shadow* props are ignored). */
export const searchCardShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
  },
  android: { elevation: 6 },
  default: {},
}) as ViewStyle;

export const searchSizes = {
  searchBarHeight: 42,
  searchBarRadius: 40,
  screenPaddingH: 16,
  gridGap: 18,
  categoryPillHeight: 32,
  categoryPillRadius: 40,
  categoryPillGap: 10,
  categoryPillPaddingH: 16,
  clubCardRadius: 12,
  clubImageAspect: 0.6,
  joinBtnHeight: 28,
  joinBtnRadius: 40,
  personCardWidth: 129,
  personCardHeight: 122,
  personAvatarSize: 52,
  clubTagHeight: 18,
  clubTagRadius: 40,
} as const;

export const searchTypography = {
  searchPlaceholder: {
    fontFamily: searchFonts.regular,
    fontSize: 12,
    fontStyle: 'italic' as const,
    letterSpacing: 0.38,
    color: searchColors.text,
  },
  categoryPill: {
    fontFamily: searchFonts.semiBold,
    fontSize: 12,
    letterSpacing: 0.38,
  },
  clubName: {
    fontFamily: searchFonts.bold,
    fontSize: 15,
    letterSpacing: 0.2,
    lineHeight: 19,
    color: searchColors.text,
  },
  clubMeta: {
    fontFamily: searchFonts.medium,
    fontSize: 11.5,
    letterSpacing: 0.1,
    lineHeight: 16,
    color: searchColors.meta,
  },
  sectionTitle: {
    fontFamily: searchFonts.bold,
    fontSize: 18,
    letterSpacing: 0.38,
    color: searchColors.text,
  },
  personName: {
    fontFamily: searchFonts.semiBold,
    fontSize: 14,
    letterSpacing: 0.38,
    color: searchColors.text,
  },
  clubTag: {
    fontFamily: searchFonts.bold,
    fontSize: 10,
    letterSpacing: 0.38,
    lineHeight: 13,
    color: searchColors.tealDark,
  },
  joinBtn: {
    fontFamily: searchFonts.regular,
    fontSize: 12,
    letterSpacing: 0.38,
    color: searchColors.cream,
  },
  joinedBtn: {
    fontFamily: searchFonts.regular,
    fontSize: 12,
    letterSpacing: 0.38,
    color: searchColors.teal,
  },
  emptyTitle: {
    fontFamily: searchFonts.semiBold,
    fontSize: 14,
    letterSpacing: 0.38,
    color: searchColors.text,
  },
  emptyBody: {
    fontFamily: searchFonts.regular,
    fontSize: 12,
    letterSpacing: 0.38,
    color: searchColors.meta,
  },
} satisfies Record<string, TextStyle>;
