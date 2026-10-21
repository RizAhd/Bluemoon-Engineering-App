/**
 * Bluemoon design tokens: blue and white, tuned for reading outdoors in
 * sunlight. Text and button colours meet WCAG AA (4.5:1) on their backgrounds.
 * Components use these names, never raw hex values.
 */

export const palette = {
  light: {
    bg: '#F4F7FC',
    card: '#FFFFFF',
    text: '#0B1B3A',
    textMuted: '#52617A',
    border: '#E1E7F0',
    borderStrong: '#C6D1E1',
    muted: '#EDF2FA',
    primary: '#1D4ED8', // 6.7:1 on white
    primaryPressed: '#1E40AF',
    onPrimary: '#FFFFFF',
    primarySoft: '#DCE8FF',
    slate: '#1E3A6E',
    onSlate: '#FFFFFF',
    success: '#15803D',
    successSoft: '#DCFCE7',
    warning: '#B45309',
    warningSoft: '#FEF3C7',
    danger: '#B91C1C',
    dangerSoft: '#FEE2E2',
    tabBar: '#FFFFFF',
    header: '#1D4ED8',
    headerDeep: '#1E3A8A',
    onHeader: '#FFFFFF',
    onHeaderMuted: '#D6E2FF',
    headerSoft: 'rgba(255,255,255,0.16)',
  },
  dark: {
    bg: '#081226',
    card: '#0F1E3A',
    text: '#EAF0FB',
    textMuted: '#9FB0CC',
    border: '#1C2E52',
    borderStrong: '#2A4170',
    muted: '#13254A',
    primary: '#60A5FA',
    primaryPressed: '#3B82F6',
    onPrimary: '#06122B',
    primarySoft: '#14306A',
    slate: '#BFD3F5',
    onSlate: '#081226',
    success: '#4ADE80',
    successSoft: '#0F2E1C',
    warning: '#FBBF24',
    warningSoft: '#33260A',
    danger: '#F87171',
    dangerSoft: '#3A1414',
    tabBar: '#0B1830',
    header: '#0F2A66',
    headerDeep: '#0A1E4D',
    onHeader: '#FFFFFF',
    onHeaderMuted: '#B7C8EC',
    headerSoft: 'rgba(255,255,255,0.12)',
  },
} as const;

export type Palette = { [K in keyof typeof palette.light]: string };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

/** Minimum touch target for dusty or gloved hands. */
export const touch = 56;

export const type = {
  caption: 13,
  body: 16,
  bodyLg: 18,
  title: 20,
  heading: 24,
  amount: 30,
  amountXl: 40,
} as const;

export type Weight = 'regular' | 'semibold' | 'bold';

/** Shared motion timings so the whole app moves the same way. */
export const motion = { fast: 120, base: 200, slow: 280, pressScale: 0.97 } as const;
