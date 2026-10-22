/**
 * The three dictionaries behind every screen: same keys, nothing empty, the same {placeholders} in every
 * language (a Sinhala sentence that lost its {days} would print the raw braces), and no stray
 * "undefined" or template leftovers.
 */
import { EXPENSE_CATEGORIES, PAY_METHODS } from '@/db/types';
import { en } from '@/i18n/en';
import { si } from '@/i18n/si';
import { ta } from '@/i18n/ta';

const dicts = { en, si, ta } as Record<'en' | 'si' | 'ta', Record<string, string>>;
const keys = Object.keys(en);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n dictionaries', () => {
  it('have exactly the same keys', () => {
    expect(Object.keys(si).sort()).toEqual([...keys].sort());
    expect(Object.keys(ta).sort()).toEqual([...keys].sort());
  });

  it.each(['en', 'si', 'ta'] as const)('%s has no empty or placeholder-looking values', (lang) => {
    for (const key of keys) {
      const value = dicts[lang][key];
      expect([key, typeof value]).toEqual([key, 'string']);
      expect([key, value.trim().length > 0]).toEqual([key, true]);
      expect([key, /undefined|NaN|\[object Object\]|TODO|FIXME/.test(value)]).toEqual([key, false]);
    }
  });

  it.each(['si', 'ta'] as const)('%s keeps the same {placeholders} as English in every string', (lang) => {
    for (const key of keys) expect([key, placeholders(dicts[lang][key])]).toEqual([key, placeholders(en[key as keyof typeof en])]);
  });

  it.each(['si', 'ta'] as const)('%s is actually translated (not an English copy) for the main screen words', (lang) => {
    for (const key of ['save', 'cancel', 'delete', 'projects', 'newProject', 'workers', 'newWorker', 'tools', 'expenses', 'backup', 'language'] as const) {
      expect([key, dicts[lang][key] !== en[key]]).toEqual([key, true]);
    }
  });
});

describe('keys the screens build at run time', () => {
  // `t(`cat_${category}`)` and friends are not checked by the compiler, so every value the database can hold is listed here.
  const built: Record<string, readonly string[]> = {
    cat_: EXPENSE_CATEGORIES,
    method_: PAY_METHODS,
    status_: ['active', 'on_hold', 'completed'],
    wage_: ['work', 'advance', 'payment'],
    weather_: ['sunny', 'cloudy', 'rain'],
    theme_: ['system', 'light', 'dark'],
  };

  it.each(['en', 'si', 'ta'] as const)('%s has a translation for each of them', (lang) => {
    for (const [prefix, values] of Object.entries(built)) {
      for (const value of values) expect([`${prefix}${value}`, typeof dicts[lang][`${prefix}${value}`]]).toEqual([`${prefix}${value}`, 'string']);
    }
  });
});
