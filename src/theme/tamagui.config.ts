/**
 * Tamagui, set up on top of our own tokens.
 *
 * Tamagui supplies behaviour (Switch, Progress, Avatar, Accordion, Separator, stacks); the look stays
 * Bluemoon's: its light and dark themes are our palette, so `$primary`, `$card`, `$border`… inside a
 * Tamagui component are the same colours `useColors()` returns everywhere else. Components still read
 * sizes from `@/theme` tokens; nothing here invents a second scale.
 */
import { animationsReactNative } from '@tamagui/config/animations-rn';
import { defaultConfig } from '@tamagui/config/v6';
import { createTamagui } from 'tamagui';

import { palette } from './tokens';

/** Our palette, plus the keys Tamagui's own components read (background, color, borderColor…). */
function themeOf(p: (typeof palette)['light' | 'dark']) {
  return {
    ...p,
    background: p.card,
    backgroundHover: p.muted,
    backgroundPress: p.muted,
    backgroundFocus: p.muted,
    color: p.text,
    colorHover: p.text,
    colorPress: p.text,
    colorFocus: p.text,
    borderColor: p.border,
    borderColorHover: p.borderStrong,
    borderColorPress: p.borderStrong,
    borderColorFocus: p.primary,
    placeholderColor: p.placeholder,
    outlineColor: p.focusRing,
    shadowColor: p.shadow,
  };
}

const base = defaultConfig.themes as Record<string, Record<string, string>>;

export const tamaguiConfig = createTamagui({
  ...defaultConfig,
  // React Native's Animated on the native driver: the switch thumb and progress bar move off the JS thread.
  animations: animationsReactNative,
  themes: {
    ...defaultConfig.themes,
    light: { ...base.light, ...themeOf(palette.light) },
    dark: { ...base.dark, ...themeOf(palette.dark) },
  },
  settings: {
    ...defaultConfig.settings,
    // Our screens write full style names (backgroundColor, padding), never Tamagui's shorthands only.
    onlyAllowShorthands: false,
    allowedStyleValues: 'somewhat-strict',
  },
});

export type AppTamaguiConfig = typeof tamaguiConfig;

declare module 'tamagui' {
  // Tamagui's documented way to type its components with this config.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface TamaguiCustomConfig extends AppTamaguiConfig {}
}
