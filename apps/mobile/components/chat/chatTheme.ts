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
  // WhatsApp-structured bubbles, We Glue identity: incoming = white bubble,
  // yours = light "Teal Mist"; dark readable text on both.
  bubbleIncoming: '#FFFFFF',
  bubbleOwn: '#D7EFEE',
  bubbleText: '#1A1A1A',
  bubbleTime: '#8A8A87',
  composerCapsule: '#FFFFFF',
} as const;

/**
 * Stable per-sender name colour for group bubbles — the existing participant
 * identity system (avatar preset palette) hashed into a readable teal-leaning
 * set. Never used for your own messages.
 */
const SENDER_NAME_PALETTE = [
  '#0A8080',
  '#B4690E',
  '#7A3E9D',
  '#1E6F50',
  '#B23A48',
  '#2A5DAA',
  '#8A6D1F',
  '#3E7C4A',
];
export function senderNameColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return SENDER_NAME_PALETTE[Math.abs(h) % SENDER_NAME_PALETTE.length]!;
}

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
    fontSize: 13,
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
  // Dark readable text on both bubble types (WhatsApp readability model).
  bubbleSent: {
    fontFamily: chatFonts.regular,
    fontSize: 15,
    lineHeight: 20,
    color: chatColors.bubbleText,
  },
  bubbleReceived: {
    fontFamily: chatFonts.regular,
    fontSize: 15,
    lineHeight: 20,
    color: chatColors.bubbleText,
  },
  senderName: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12.5,
    marginBottom: 2,
  },
  timestamp: {
    fontFamily: chatFonts.semiBold,
    fontSize: 10,
    letterSpacing: 0.38,
    color: chatColors.textMuted,
  },
  /** Quiet timestamp shown in the lower portion of a message bubble. */
  bubbleTimestamp: {
    fontFamily: chatFonts.regular,
    fontSize: 10.5,
    color: chatColors.bubbleTime,
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
  filterPillHeight: 34,
  filterPillMinWidth: 78,
  filterPillRadius: 40,
  avatarSuggested: 35,
  avatarMessage: 25,
  avatarHeader: 38,
  avatarInfo: 55,
  bubbleRadius: 18,
  /** Tight corner where consecutive bubbles from the same sender meet. */
  bubbleRadiusGrouped: 6,
  inputBarHeight: 61,
  inputBarRadius: 22,
  composerCapsuleRadius: 22,
  unreadBadge: 20,
  channelDrawerWidthRatio: 0.31,
};
