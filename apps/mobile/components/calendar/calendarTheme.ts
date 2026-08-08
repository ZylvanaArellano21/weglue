import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/** Figma Calendar tab tokens (file ZaAzanItzMQgvheIs2iBkR) */
export const calendarColors = {
  bg: '#FEFCF0',
  teal: '#0FA6A6',
  alertRed: '#F02719',
  text: '#000000',
  textDark: '#111827',
  meta: '#5F5D5D',
  metaLight: '#6B7280',
  white: '#FFFFFF',
  gridBorder: '#E5E7EB',
  trailingDayBg: '#F0F4FF',
  trailingDayText: '#9CA3AF',
} as const;

export const calendarFonts = {
  displayBold: 'Zain_700Bold',
  displayExtraBold: 'Zain_800ExtraBold',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const calendarShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  android: { elevation: 4 },
  default: {},
}) as ViewStyle;

export const calendarCardShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  android: { elevation: 2 },
  default: {},
}) as ViewStyle;

export const calendarSizes = {
  screenPaddingH: 16,
  gridCardRadius: 12,
  gridCellSize: 44,
  eventCardRadius: 12,
  eventCardBorderWidth: 4,
  searchPillRadius: 24,
  dotSize: 8,
  dotGap: 6,
} as const;

export const calendarTypography = {
  monthTitle: {
    fontFamily: calendarFonts.displayBold,
    fontSize: 20,
    color: calendarColors.text,
  },
  dayHeader: {
    fontFamily: calendarFonts.semiBold,
    fontSize: 11,
    color: calendarColors.text,
  },
  dayNumber: {
    fontFamily: calendarFonts.medium,
    fontSize: 14,
    color: calendarColors.text,
  },
  dayNumberToday: {
    fontFamily: calendarFonts.bold,
    fontSize: 14,
    color: calendarColors.white,
  },
  sectionHeader: {
    fontFamily: calendarFonts.bold,
    fontSize: 15,
    color: calendarColors.metaLight,
    letterSpacing: 0.5,
  },
  eventTitle: {
    fontFamily: calendarFonts.semiBold,
    fontSize: 14,
    color: calendarColors.textDark,
  },
  eventClub: {
    fontFamily: calendarFonts.medium,
    fontSize: 12,
    color: calendarColors.teal,
  },
  eventMetaToday: {
    fontFamily: calendarFonts.bold,
    fontSize: 12,
    color: calendarColors.alertRed,
  },
  eventMetaDefault: {
    fontFamily: calendarFonts.regular,
    fontSize: 12,
    color: calendarColors.metaLight,
  },
  searchPill: {
    fontFamily: calendarFonts.semiBold,
    fontSize: 15,
    color: calendarColors.teal,
  },
} satisfies Record<string, TextStyle>;
