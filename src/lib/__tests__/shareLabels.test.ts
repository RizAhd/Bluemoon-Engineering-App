/**
 * The words inside shared messages: every language has every label, Sinhala and Tamil are really
 * Sinhala and Tamil, the wording is the app's own where the app already has the word, and `fill`
 * can never print "undefined" or "NaN".
 */
import type { Lang } from '@/i18n';
import { en as appEn } from '@/i18n/en';
import { si as appSi } from '@/i18n/si';
import { ta as appTa } from '@/i18n/ta';
import { fill, SHARE_LABELS, shareLabels, type ShareLabelKey } from '@/lib/shareLabels';

const LANGS: Lang[] = ['en', 'si', 'ta'];
const KEYS = Object.keys(SHARE_LABELS.en) as ShareLabelKey[];
const SINHALA = /[\u{0D80}-\u{0DFF}]/u;
const TAMIL = /[\u{0B80}-\u{0BFF}]/u;
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('the label tables', () => {
  it('have the same keys in all three languages, and there are enough of them to be a real table', () => {
    expect(KEYS.length).toBeGreaterThan(60);
    for (const lang of LANGS) expect(Object.keys(SHARE_LABELS[lang]).sort()).toEqual([...KEYS].sort());
  });

  it.each(LANGS)('%s: every label is a plain, non-empty, single line of text', (lang) => {
    for (const key of KEYS) {
      const text = SHARE_LABELS[lang][key];
      expect({ key, ok: typeof text === 'string' && text.length > 0 }).toEqual({ key, ok: true });
      expect({ key, text: text.trim() }).toEqual({ key, text });
      // a label with a line break, an asterisk or a back-tick could break the layout or the bold of a message
      expect({ key, bad: /[\n\r*`]/.test(text) }).toEqual({ key, bad: false });
      expect({ key, emoji: /\p{Extended_Pictographic}/u.test(text) }).toEqual({ key, emoji: false });
    }
  });

  it.each(['si', 'ta'] as const)('%s: no label is left in English', (lang) => {
    const same = KEYS.filter((key) => SHARE_LABELS[lang][key] === SHARE_LABELS.en[key]);
    expect(same).toEqual([]);
  });

  it('Sinhala labels are written in Sinhala and Tamil labels in Tamil', () => {
    const notSinhala = KEYS.filter((key) => !SINHALA.test(SHARE_LABELS.si[key]));
    const notTamil = KEYS.filter((key) => !TAMIL.test(SHARE_LABELS.ta[key]));
    expect(notSinhala).toEqual([]);
    expect(notTamil).toEqual([]);
    // and not the other way round
    expect(KEYS.filter((key) => TAMIL.test(SHARE_LABELS.si[key]) || SINHALA.test(SHARE_LABELS.ta[key]))).toEqual([]);
  });

  it('keep the same placeholders in every language, so a translation cannot lose the number or the amount', () => {
    for (const key of KEYS) {
      for (const lang of ['si', 'ta'] as const) {
        expect({ key, lang, found: placeholders(SHARE_LABELS[lang][key]) }).toEqual({ key, lang, found: placeholders(SHARE_LABELS.en[key]) });
      }
    }
    // the placeholders the builders fill
    expect(placeholders(SHARE_LABELS.en.more)).toEqual(['n']);
    expect(placeholders(SHARE_LABELS.en.paidInline)).toEqual(['amount']);
    expect(placeholders(SHARE_LABELS.en.since)).toEqual(['date']);
    expect(placeholders(SHARE_LABELS.en.withWho)).toEqual(['name']);
  });

  it('Sinhala conjuncts keep their joiner (a virama straight before ra or ya would show as a broken letter)', () => {
    const broken = KEYS.filter((key) => /\u{0DCA}[\u{0DBB}\u{0DBA}]/u.test(SHARE_LABELS.si[key]));
    expect(broken).toEqual([]);
    // the conjuncts do exist, so the check above is looking at something
    expect(SHARE_LABELS.si.project).toContain('\u{0DCA}\u{200D}\u{0DBA}');
  });

  it('are the footer and the "more" line the product asked for', () => {
    expect(SHARE_LABELS.en.footer).toBe('Developed with Bluemoon Site');
    expect(SHARE_LABELS.en.more).toBe('… and {n} more');
    for (const lang of LANGS) {
      expect(SHARE_LABELS[lang].footer).toContain('Bluemoon Site');
      expect(SHARE_LABELS[lang].more.startsWith('…')).toBe(true);
    }
  });
});

describe('the wording is the app\'s own', () => {
  /** [share label, key of the same word in src/i18n]. */
  const REUSED: [ShareLabelKey, keyof typeof appEn][] = [
    ['project', 'project'],
    ['client', 'client'],
    ['location', 'location'],
    ['status', 'status'],
    ['total', 'total'],
    ['allProjects', 'allProjects'],
    ['date', 'date'],
    ['status_active', 'status_active'],
    ['status_on_hold', 'status_on_hold'],
    ['status_completed', 'status_completed'],
    ['cat_materials', 'cat_materials'],
    ['cat_transport', 'cat_transport'],
    ['cat_fuel', 'cat_fuel'],
    ['cat_machinery', 'cat_machinery'],
    ['cat_food', 'cat_food'],
    ['cat_tools', 'cat_tools'],
    ['cat_subcontract', 'cat_subcontract'],
    ['cat_utilities', 'cat_utilities'],
    ['cat_other', 'cat_other'],
    ['contractValue', 'contractValue'],
    ['totalCost', 'totalCost'],
    ['expenses', 'materialsAndOther'],
    ['labour', 'labour'],
    ['labourPaid', 'labourPaid'],
    ['leftInContract', 'balanceToContract'],
    ['byCategory', 'byCategory'],
    ['workers', 'workers'],
    ['toolsOut', 'toolsOut'],
    ['estimate', 'estimate'],
    ['validUntil', 'validUntil'],
    ['items', 'items'],
    ['subtotal', 'subtotal'],
    ['discount', 'discount'],
    ['tax', 'tax'],
    ['paymentSchedule', 'paymentSchedule'],
    ['phone', 'phone'],
    ['days', 'days'],
    ['wages', 'wages'],
    ['paid', 'paid'],
    ['toPay', 'weOwe'],
    ['advances', 'advances'],
    ['trade', 'trade'],
    ['dailyRate', 'dailyRate'],
    ['earned', 'earned'],
    ['advanceOver', 'workerOwes'],
    ['balance', 'balance'],
    ['settled', 'settled'],
    ['byProject', 'perProject'],
    ['wage_payment', 'wage_payment'],
    ['wage_advance', 'wage_advance'],
    ['noExpenses', 'noExpenses'],
    ['noToolsOut', 'noToolsOut'],
    ['weather', 'weather'],
    ['weather_sunny', 'weather_sunny'],
    ['weather_cloudy', 'weather_cloudy'],
    ['weather_rain', 'weather_rain'],
  ];
  const APP = { en: appEn, si: appSi, ta: appTa };

  it.each(LANGS)('%s: the words of the app are used as they are in the app', (lang) => {
    const different = REUSED.filter(([key, appKey]) => SHARE_LABELS[lang][key] !== APP[lang][appKey]).map(([key]) => key);
    expect(different).toEqual([]);
  });

  it('"settled" in the middle of a line is the same Sinhala and Tamil word as the label', () => {
    expect(SHARE_LABELS.si.balSettled).toBe(SHARE_LABELS.si.settled);
    expect(SHARE_LABELS.ta.balSettled).toBe(SHARE_LABELS.ta.settled);
    expect(SHARE_LABELS.en.balSettled).toBe(SHARE_LABELS.en.settled.toLowerCase());
  });
});

describe('shareLabels', () => {
  it.each(LANGS)('returns the table of %s', (lang) => {
    expect(shareLabels(lang)).toBe(SHARE_LABELS[lang]);
  });

  it('answers in English for a language it does not know', () => {
    expect(shareLabels('de' as unknown as Lang)).toBe(SHARE_LABELS.en);
    expect(shareLabels(undefined as unknown as Lang)).toBe(SHARE_LABELS.en);
  });
});

describe('fill', () => {
  it('replaces every placeholder, also the same one twice', () => {
    expect(fill('{n} of {n} for {name}', { n: 3, name: 'Nimal' })).toBe('3 of 3 for Nimal');
    expect(fill(SHARE_LABELS.en.more, { n: 12 })).toBe('… and 12 more');
    expect(fill(SHARE_LABELS.si.more, { n: 12 })).toBe('… සහ තවත් 12ක්');
    expect(fill(SHARE_LABELS.ta.more, { n: 12 })).toBe('… மேலும் 12');
  });

  it('leaves a placeholder it has no value for as written, and text without placeholders alone', () => {
    expect(fill('paid {amount} on {date}', { amount: 'Rs 5' })).toBe('paid Rs 5 on {date}');
    expect(fill('nothing here', { n: 1 })).toBe('nothing here');
    expect(fill('', {})).toBe('');
  });

  it('turns a missing value into nothing and a number that is not a number into 0, never "undefined", "null" or "NaN"', () => {
    expect(fill('[{a}] [{b}]', { a: undefined, b: null })).toBe('[] []');
    expect(fill('{n} days', { n: Number.NaN })).toBe('0 days');
    expect(fill('{n} days', { n: Number.POSITIVE_INFINITY })).toBe('0 days');
    expect(fill('{n} days', { n: -Infinity })).toBe('0 days');
    expect(fill('{n}', { n: 0 })).toBe('0');
    expect(fill('{n}', { n: 1.5 })).toBe('1.5');
  });

  it('puts a value in as typed: a "$&" or "$1" in a name is not a regular-expression replacement', () => {
    expect(fill('with {name}', { name: 'A$&B$1C$$' })).toBe('with A$&B$1C$$');
  });
});
