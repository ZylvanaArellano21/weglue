import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/** Figma Search tab tokens (file ZaAzanItzMQgvheIs2iBkR, frame 1325:1701) */
export const searchColors = {
  bg: '#FDFBEF',
  cream: '#FEFCF0',
  teal: '#0FA6A6',
  tealDark: '#0A8080',
  text: '#000000',
  meta: '#5F5D5D',
  white: '#FFFFFF',
  borderSearch: 'rgba(0,0,0,0.2)',
  tagBg: 'rgba(15,166,166,0.39)',
  imagePlaceholder: '#E5E7EB',
} as const;

export const searchFonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const searchShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  android: { elevation: 4 },
  default: {},
}) as ViewStyle;

export const searchCardShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
  },
  android: { elevation: 4 },
  default: {},
}) as ViewStyle;

export const searchSizes = {
  searchBarHeight: 42,
  searchBarRadius: 40,
  screenPaddingH: 16,
  gridGap: 18,
  categoryPillHeight: 24,
  categoryPillRadius: 40,
  clubCardRadius: 10,
  clubImageAspect: 94 / 170,
  joinBtnHeight: 18,
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
    fontFamily: searchFonts.semiBold,
    fontSize: 14,
    letterSpacing: 0.38,
    color: searchColors.text,
  },
  clubMeta: {
    fontFamily: searchFonts.medium,
    fontSize: 10,
    letterSpacing: 0.38,
    lineHeight: 13,
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
