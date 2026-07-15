// Camera chrome tokens. The camera is the one surface in We Glue that sits on
// a dark, unpredictable backdrop (the live viewfinder), so its controls carry
// their own scrim-backed palette rather than the cream/teal page tokens — while
// keeping the brand teal for the primary action.

export const mediaColors = {
  dark: '#000000',
  onDark: '#FFFFFF',
  onDarkMuted: 'rgba(255,255,255,0.72)',
  /** Circular backing behind icon controls: legible over any viewfinder content. */
  scrim: 'rgba(0,0,0,0.55)',
  teal: '#0FA6A6',
  cream: '#FEFCF0',
  danger: '#FF6B6B',
} as const;

export const mediaFonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

/** Android's accessible minimum is 48dp; every control here meets or beats it. */
export const TOUCH_TARGET = 48;

export const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 } as const;
