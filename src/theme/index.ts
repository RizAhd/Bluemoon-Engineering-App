import { useEffect, useState } from 'react';
import { AccessibilityInfo, useColorScheme, useWindowDimensions } from 'react-native';

import { useSetting } from '@/db';
import { useLang, type Lang } from '@/i18n';

import { elevation, gutter, motion, palette, windowClass, type Palette, type Weight } from './tokens';

export * from './tokens';

export type ThemePref = 'system' | 'light' | 'dark';

export function useThemePref(): ThemePref {
  const v = useSetting('theme');
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function useScheme(): 'light' | 'dark' {
  const pref = useThemePref();
  const system = useColorScheme();
  if (pref !== 'system') return pref;
  return system === 'dark' ? 'dark' : 'light';
}

export function useColors(): Palette {
  return palette[useScheme()];
}

/** The shadow for `level` in the light scheme; nothing in dark, where lighter surfaces carry the depth. */
export function useElevation(level: keyof typeof elevation) {
  return useScheme() === 'light' ? elevation[level] : null;
}

/** Fonts loaded in the root layout. One Noto family per script so all three languages match. */
export const FONT_MAP = {
  en: { regular: 'NotoSans_400Regular', semibold: 'NotoSans_600SemiBold', bold: 'NotoSans_700Bold' },
  si: {
    regular: 'NotoSansSinhala_400Regular',
    semibold: 'NotoSansSinhala_600SemiBold',
    bold: 'NotoSansSinhala_700Bold',
  },
  ta: { regular: 'NotoSansTamil_400Regular', semibold: 'NotoSansTamil_600SemiBold', bold: 'NotoSansTamil_700Bold' },
} as const satisfies Record<Lang, Record<Weight, string>>;

export function useFont() {
  const lang = useLang();
  return (w: Weight = 'regular') => FONT_MAP[lang][w];
}

/** 'latin' for English and all numeric runs; 'complex' for Sinhala / Tamil (taller line heights, no caps). */
export function useScript(): 'latin' | 'complex' {
  return useLang() === 'en' ? 'latin' : 'complex';
}

export type WidthClass = 'compact' | 'medium' | 'expanded';

/** The Android window size class of a width in dp. */
export function widthClassOf(width: number): WidthClass {
  return width >= windowClass.expandedFrom ? 'expanded' : width >= windowClass.mediumFrom ? 'medium' : 'compact';
}

/**
 * Everything a screen decides from the window, read through useWindowDimensions so rotation, folding and
 * split screen update it (never read `Dimensions` directly):
 *
 *   widthClass   'compact' (< 600) · 'medium' (600-839) · 'expanded' (>= 840)
 *   gutter       16, or 24 from 600 wide
 *   maxWidth     content column cap (640 from 600 wide, undefined on phones); `column` is the centred style
 *   short        under 480 tall: sticky footers scroll with the content instead of covering the list
 *   narrow       under 360 wide: the FAB shows only its icon
 *   stackTiles   under 340 wide: stat tiles stack
 */
export function useLayout() {
  const { width, height, fontScale } = useWindowDimensions();
  const widthClass = widthClassOf(width);
  const wide = widthClass !== 'compact';
  const maxWidth = wide ? gutter.contentMax : undefined;
  return {
    width,
    height,
    fontScale,
    widthClass,
    wide,
    gutter: wide ? gutter.wide : gutter.base,
    /** Max content width (undefined on phones). */
    maxWidth,
    /** A centred content column: full width on phones, at most 640 on tablets. Sheets and footers use it too. */
    column: { width: '100%', maxWidth, alignSelf: 'center' } as const,
    short: height > 0 && height < windowClass.shortBelow,
    /** FAB shows only its icon under 360 wide. */
    narrow: width < 360,
    /** Stat tiles stack under 340 wide. */
    stackTiles: width < 340,
  };
}

let reduceMotionCache: boolean | null = null;

/** Honours the system "reduce motion" setting; animations then become short fades. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(reduceMotionCache ?? false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        reduceMotionCache = v;
        if (alive) setReduced(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      reduceMotionCache = v;
      setReduced(v);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** Durations for entering/exiting animations, already reduced when the system asks. */
export function useMotion() {
  const reduced = useReducedMotion();
  if (reduced) return { enter: 120, exit: 120, pressScale: 1, reduced: true } as const;
  return { enter: motion.slow, exit: Math.round(motion.slow * 0.7), pressScale: motion.pressScale, reduced: false } as const;
}
