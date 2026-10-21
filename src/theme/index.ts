import { useColorScheme } from 'react-native';

import { useSetting } from '@/db';
import { useLang, type Lang } from '@/i18n';

import { palette, type Palette, type Weight } from './tokens';

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
