import { useEffect, useState } from 'react';
import { AccessibilityInfo, useColorScheme, useWindowDimensions } from 'react-native';

import { useSetting } from '@/db';
import { useLang, type Lang } from '@/i18n';

import { gutter, motion, palette, type Palette, type Weight } from './tokens';

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

/**
 * Screen gutter and content width for the current window: 16 on phones, 24 from
 * 600 wide, content capped at 640 and centred on tablets.
 */
export function useLayout() {
  const { width } = useWindowDimensions();
  const wide = width >= gutter.wideFrom;
  const pad = wide ? gutter.wide : gutter.base;
  return {
    width,
    wide,
    gutter: pad,
    /** Max content width (undefined on phones). */
    maxWidth: wide ? gutter.contentMax : undefined,
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
