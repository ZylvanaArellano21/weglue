import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import { cardDepth } from '../shared/cardStyles';

/** Profile area design tokens (Figma ZaAzanItzMQgvheIs2iBkR) */
export const profileColors = {
  bg: '#FEFCF0',
  teal: '#0FA6A6',
  alertRed: '#F02719',
  text: '#000000',
  textDark: '#111827',
  textMuted: '#6B7280',
  textLight: '#9CA3AF',
  white: '#FFFFFF',
  border: '#E5E7EB',
  chipBg: '#FFFFFF',
  chipBorder: 'rgba(0,0,0,0.2)',
  destructive: '#F02719',
  overlay: 'rgba(0,0,0,0.45)',
  sidebarOverlay: 'rgba(0,0,0,0.4)',
  mutedListBg: '#F3F4F6',
} as const;

export const profileFonts = {
  displayBold: 'Zain_700Bold',
  displayExtraBold: 'Zain_800ExtraBold',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const profileShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  android: { elevation: 4 },
  default: {},
}) as ViewStyle;

/** Card depth — the shared, restrained card elevation (see cardStyles.ts),
 *  so profile cards match posts, events, club and Discovery cards. */
export const profileCardShadow = cardDepth;

export const profileSizes = {
  screenPaddingH: 16,
  avatarLg: 72,
  avatarMd: 56,
  avatarSm: 44,
  drawerWidthPct: 0.75,
  drawerMaxWidth: 320,
  chipRadius: 40,
  btnRadius: 40,
  cardRadius: 12,
  inputRadius: 12,
} as const;

export const profileTypography = {
  screenTitle: {
    fontFamily: profileFonts.displayBold,
    fontSize: 22,
    color: profileColors.textDark,
  },
  sectionLabel: {
    fontFamily: profileFonts.semiBold,
    fontSize: 13,
    color: profileColors.textMuted,
    letterSpacing: 0.3,
  },
  body: {
    fontFamily: profileFonts.regular,
    fontSize: 14,
    color: profileColors.textDark,
  },
  link: {
    fontFamily: profileFonts.medium,
    fontSize: 13,
    color: profileColors.teal,
  },
  statValue: {
    fontFamily: profileFonts.bold,
    fontSize: 17,
    color: profileColors.textDark,
  },
  statLabel: {
    fontFamily: profileFonts.regular,
    fontSize: 12,
    color: profileColors.textLight,
  },
} satisfies Record<string, TextStyle>;
