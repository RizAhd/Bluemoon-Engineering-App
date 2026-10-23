/**
 * The three dictionaries behind every screen: same keys, nothing empty, the same {placeholders} in every
 * language (a Sinhala sentence that lost its {days} would print the raw braces), and no stray
 * "undefined" or template leftovers.
 */
import { ESTIMATE_STATUSES, EXPENSE_CATEGORIES, PAY_METHODS } from '@/db/types';
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

describe('estimate (quotation) strings', () => {
  // everything added for the estimates feature sits after 'developedBy' in the English file
  const estimateKeys = keys.slice(keys.indexOf('developedBy') + 1);

  it('there are some, and the status words are the four the database holds', () => {
    expect(estimateKeys.length).toBeGreaterThan(80);
    expect(estimateKeys).toEqual(expect.arrayContaining(ESTIMATE_STATUSES.map((s) => `estStatus_${s}`)));
  });

  it.each(['si', 'ta'] as const)('%s has its own words for every one of them (none is an English copy)', (lang) => {
    // A bare example number ("25,000" in an amount box) reads the same in every language.
    const words = estimateKeys.filter((key) => !/^[\d.,\s]+$/.test(dicts.en[key]));
    for (const key of words) expect([key, dicts[lang][key] !== dicts.en[key]]).toEqual([key, true]);
  });

  it.each(['si', 'ta'] as const)('%s writes the stage names the standard schedule makes in English, as the screen shows them', (lang) => {
    // "Use standard schedule" fills Advance / Progress payment / On completion in English; the replace question must name them the same way
    for (const word of ['Advance', 'Progress payment', 'On completion']) expect(dicts[lang].replaceScheduleBody).toContain(word);
  });
});

describe('keys the screens build at run time', () => {
  // `t(`cat_${category}`)` and friends are not checked by the compiler, so every value the database can hold is listed here.
  const built: Record<string, readonly string[]> = {
    cat_: EXPENSE_CATEGORIES,
    method_: PAY_METHODS,
    status_: ['active', 'on_hold', 'completed'],
    estStatus_: ESTIMATE_STATUSES,
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
