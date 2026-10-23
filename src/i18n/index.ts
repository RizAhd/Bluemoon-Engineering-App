import { getLocales } from 'expo-localization';
import { useCallback } from 'react';

import { getSetting, useSetting } from '@/db';

import { en, TKey } from './en';
import { si } from './si';
import { ta } from './ta';

export type Lang = 'en' | 'si' | 'ta';
export type { TKey };

const dicts = { en, si, ta } as const;

export const LANG_NAMES: Record<Lang, string> = { en: 'English', si: 'සිංහල', ta: 'தமிழ்' };

function deviceLang(): Lang {
  const code = getLocales()[0]?.languageCode;
  return code === 'si' || code === 'ta' ? code : 'en';
}

function resolve(value: string | null): Lang {
  return value === 'si' || value === 'ta' || value === 'en' ? value : deviceLang();
}

/** With `{ n: 1 }` a `<key>_one` string wins when the dictionary has one ("1 day", not "1 days"). */
function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  const one = vars?.n === 1 ? (`${key}_one` as TKey) : null;
  const d = dicts[lang] as Record<string, string | undefined>;
  let s: string = (one ? (d[one] ?? (en as Record<string, string | undefined>)[one]) : undefined) ?? dicts[lang][key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export function useLang(): Lang {
  return resolve(useSetting('lang'));
}

export function useT() {
  const lang = useLang();
  return useCallback((key: TKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
}

/** For non-React code (PDF export). */
export function tNow(key: TKey, vars?: Record<string, string | number>): string {
  return translate(resolve(getSetting('lang')), key, vars);
}

export function currentLang(): Lang {
  return resolve(getSetting('lang'));
}
