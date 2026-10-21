/**
 * Bluemoon design tokens. Industrial slate with a safety-orange accent,
 * tuned for reading outdoors in sunlight. Components use these names,
 * never raw hex values.
 */

export const palette = {
  light: {
    bg: '#F8FAFC',
    card: '#FFFFFF',
    text: '#0F172A',
    textMuted: '#475569',
    border: '#E2E8F0',
    borderStrong: '#CBD5E1',
    muted: '#EEF2F6',
    primary: '#C2410C', // safety orange, 5.2:1 on white
    primaryPressed: '#9A3412',
    onPrimary: '#FFFFFF',
    primarySoft: '#FFEDD5',
    slate: '#334155',
    onSlate: '#FFFFFF',
    success: '#15803D',
    successSoft: '#DCFCE7',
    warning: '#B45309',
    warningSoft: '#FEF3C7',
    danger: '#B91C1C',
    dangerSoft: '#FEE2E2',
    tabBar: '#FFFFFF',
  },
  dark: {
    bg: '#0B1120',
    card: '#151E2E',
    text: '#F1F5F9',
    textMuted: '#A3B1C6',
    border: '#263247',
    borderStrong: '#334155',
    muted: '#1C2738',
    primary: '#F97316',
    primaryPressed: '#EA580C',
    onPrimary: '#111827',
    primarySoft: '#3B1D0B',
    slate: '#CBD5E1',
    onSlate: '#0F172A',
    success: '#4ADE80',
    successSoft: '#0F2E1C',
    warning: '#FBBF24',
    warningSoft: '#33260A',
    danger: '#F87171',
    dangerSoft: '#3A1414',
    tabBar: '#111A29',
  },
} as const;

export type Palette = { [K in keyof typeof palette.light]: string };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

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
