import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/** Figma Message tab design tokens (file ZaAzanItzMQgvheIs2iBkR) */
export const chatColors = {
  bg: '#FEFCF0',
  teal: '#0FA6A6',
  cream: '#FEFCF0',
  pollSheet: '#F1ECD1',
  border: '#EDECE8',
  borderSearch: 'rgba(0,0,0,0.2)',
  text: '#000000',
  textMuted: '#878784',
  white: '#FFFFFF',
  tagBg: '#E8E8E5',
  tagText: '#878784',
  gridPlaceholder: '#D9D9D9',
} as const;

export const chatFonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const chatShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  android: { elevation: 4 },
  default: {},
}) as ViewStyle;

export const chatTypography = {
  searchPlaceholder: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    fontStyle: 'italic' as const,
    letterSpacing: 0.38,
    color: chatColors.text,
  },
  filterPill: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    letterSpacing: 0.38,
  },
  sectionHeader: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    letterSpacing: 0.38,
    color: chatColors.text,
  },
  rowName: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    letterSpacing: 0.38,
    color: chatColors.text,
  },
  chatTitle: {
    fontFamily: chatFonts.semiBold,
    fontSize: 20,
    letterSpacing: 0.38,
    color: chatColors.text,
  },
  channelName: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    letterSpacing: 0.38,
    color: chatColors.text,
  },
  bubbleSent: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    letterSpacing: 0.38,
    color: chatColors.cream,
  },
  bubbleReceived: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    letterSpacing: 0.38,
    color: chatColors.teal,
  },
  timestamp: {
    fontFamily: chatFonts.semiBold,
    fontSize: 10,
    letterSpacing: 0.38,
    color: chatColors.textMuted,
  },
  dateDivider: {
    fontFamily: chatFonts.semiBold,
    fontSize: 10,
    letterSpacing: 0.38,
    color: chatColors.textMuted,
    textTransform: 'uppercase' as const,
  },
  inputPlaceholder: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    fontStyle: 'italic' as const,
    letterSpacing: 0.38,
    color: chatColors.text,
  },
  infoAction: {
    fontFamily: chatFonts.semiBold,
    fontSize: 10,
    letterSpacing: 0.38,
    color: chatColors.text,
  },
  infoRow: {
    fontFamily: chatFonts.semiBold,
    fontSize: 15,
    letterSpacing: 0.38,
    color: chatColors.text,
  },
  roleLabel: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    fontStyle: 'italic' as const,
    letterSpacing: 0.38,
    color: chatColors.text,
  },
  followBtn: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    letterSpacing: 0.38,
  },
} satisfies Record<string, TextStyle>;

export const chatSizes = {
  searchBarHeight: 42,
  searchBarRadius: 40,
  filterPillHeight: 24,
  filterPillWidth: 61,
  filterPillRadius: 40,
  avatarSuggested: 35,
  avatarMessage: 25,
  avatarHeader: 38,
  avatarInfo: 55,
  bubbleRadius: 40,
  inputBarHeight: 61,
  inputBarRadius: 22,
  unreadBadge: 20,
  channelDrawerWidthRatio: 0.31,
};
