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

function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  let s: string = dicts[lang][key] ?? en[key] ?? key;
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
