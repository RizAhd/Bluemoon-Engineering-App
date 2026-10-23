/**
 * The words inside the messages people share (WhatsApp, SMS, e-mail) in English, Sinhala and Tamil.
 *
 * Self-contained, like estimateLabels.ts: the language of a message is chosen when it is shared, so
 * these do not live in src/i18n. Every language must have every key: `ShareLabels` is the key set of
 * the English table, so a missing translation is a compile error. The wording reuses the app's own
 * (src/i18n/si.ts and ta.ts) for project, client, location, contract, expenses, workers, balance,
 * to pay, tools out, notes, status words and expense categories, so a message sounds like the app.
 *
 * Names, notes and other typed text are never translated; only these fixed words are. Placeholders
 * look like `{n}` and `{amount}` and are filled by `fill`. The phrases that are written in the middle of
 * a line (`paidInline`, `balToPay`, `withWho`, `since` ...) start in lower case in English.
 */
import type { Lang } from '@/i18n';

const en = {
  // ---- every message
  footer: 'Developed with Bluemoon Site',
  more: '… and {n} more',
  date: 'Date',
  project: 'Project',
  client: 'Client',
  location: 'Location',
  status: 'Status',
  total: 'Total',
  allProjects: 'All projects',

  // ---- project status
  status_active: 'Active',
  status_on_hold: 'On hold',
  status_completed: 'Completed',

  // ---- expense categories
  cat_materials: 'Materials',
  cat_transport: 'Transport',
  cat_fuel: 'Fuel',
  cat_machinery: 'Machine hire',
  cat_food: 'Food & tea',
  cat_tools: 'Tools',
  cat_subcontract: 'Sub-contract',
  cat_utilities: 'Water & power',
  cat_other: 'Other',

  // ---- project
  contractValue: 'Contract value',
  totalCost: 'Total cost',
  expenses: 'Expenses',
  labour: 'Labour (earned)',
  labourPaid: 'Labour paid',
  contractUsed: 'Contract used',
  leftInContract: 'Left in contract',
  overContract: 'Over contract',
  byCategory: 'By category',
  workers: 'Workers',
  toolsOut: 'Tools out',
  latestNotes: 'Latest notes',

  // ---- estimate
  estimate: 'Estimate',
  validUntil: 'Valid until',
  items: 'Items',
  subtotal: 'Subtotal',
  discount: 'Discount',
  tax: 'Tax',
  grandTotal: 'TOTAL',
  paymentSchedule: 'Payment schedule',
  phone: 'Phone',

  // ---- work and pay of one day
  daySheet: 'Work and pay',
  days: 'Days',
  wages: 'Wages',
  paid: 'Paid',
  toPay: 'To pay',
  advances: 'Advances',
  dayOne: '{n} day',
  dayMany: '{n} days',
  paidInline: 'paid {amount}',
  notPaidInline: 'not paid',
  advanceInline: 'advance {amount}',
  otherPayments: 'Other payments',
  noWork: 'No work recorded for this day',

  // ---- worker statement
  trade: 'Trade',
  dailyRate: 'Daily rate',
  earned: 'Earned',
  advanceOver: 'Paid ahead',
  balance: 'Balance',
  settled: 'Settled',
  byProject: 'Per project',
  lastPayments: 'Last payments and advances',
  wage_payment: 'Payment',
  wage_advance: 'Advance',
  balToPay: 'to pay {amount}',
  balAdvanceOver: 'advance over {amount}',
  balSettled: 'settled',

  // ---- expenses
  expenseOne: '{n} expense',
  expenseMany: '{n} expenses',
  noExpenses: 'No expenses yet',

  // ---- tools out
  withWho: 'with {name}',
  since: 'since {date}',
  noToolsOut: 'No tools are out right now',

  // ---- site note
  siteNote: 'Site note',
  weather: 'Weather',
  weather_sunny: 'Sunny',
  weather_cloudy: 'Cloudy',
  weather_rain: 'Rain',
} as const;

export type ShareLabelKey = keyof typeof en;
export type ShareLabels = Record<ShareLabelKey, string>;

const si: ShareLabels = {
  footer: 'Bluemoon Site භාවිතයෙන් සකස් කරන ලදී',
  more: '… සහ තවත් {n}ක්',
  date: 'දිනය',
  project: 'ව්‍යාපෘතිය',
  client: 'සේවාදායකයා',
  location: 'ස්ථානය',
  status: 'තත්ත්වය',
  total: 'එකතුව',
  allProjects: 'සියලු ව්‍යාපෘති',

  status_active: 'ක්‍රියාත්මකයි',
  status_on_hold: 'නවතා ඇත',
  status_completed: 'අවසන්',

  cat_materials: 'ද්‍රව්‍ය',
  cat_transport: 'ප්‍රවාහනය',
  cat_fuel: 'ඉන්ධන',
  cat_machinery: 'යන්ත්‍ර කුලී',
  cat_food: 'කෑම සහ තේ',
  cat_tools: 'උපකරණ',
  cat_subcontract: 'උප කොන්ත්‍රාත්',
  cat_utilities: 'ජලය සහ විදුලිය',
  cat_other: 'වෙනත්',

  contractValue: 'කොන්ත්‍රාත් වටිනාකම',
  totalCost: 'මුළු වියදම',
  expenses: 'වියදම්',
  labour: 'ශ්‍රමය (උපයාගත්)',
  labourPaid: 'ගෙවූ වැටුප්',
  contractUsed: 'කොන්ත්‍රාත්තුවෙන් වැය වූයේ',
  leftInContract: 'කොන්ත්‍රාත්තුවේ ඉතිරි',
  overContract: 'කොන්ත්‍රාත්තුවට වඩා වැඩි',
  byCategory: 'වර්ගය අනුව',
  workers: 'කම්කරුවන්',
  toolsOut: 'පිටත ඇති උපකරණ',
  latestNotes: 'නවතම සටහන්',

  estimate: 'ඇස්තමේන්තුව',
  validUntil: 'වලංගු වන දිනය',
  items: 'අයිතම',
  subtotal: 'උප එකතුව',
  discount: 'වට්ටම',
  tax: 'බදු',
  grandTotal: 'මුළු මුදල',
  paymentSchedule: 'ගෙවීම් කාලසටහන',
  phone: 'දුරකථනය',

  daySheet: 'වැඩ සහ ගෙවීම්',
  days: 'දින',
  wages: 'වැටුප්',
  paid: 'ගෙවූ',
  toPay: 'ගෙවිය යුතු',
  advances: 'අත්තිකාරම්',
  dayOne: 'දවස් {n}',
  dayMany: 'දවස් {n}',
  paidInline: 'ගෙවූ {amount}',
  notPaidInline: 'ගෙවා නැත',
  advanceInline: 'අත්තිකාරම් {amount}',
  otherPayments: 'වෙනත් ගෙවීම්',
  noWork: 'මෙම දවසට වැඩ සටහන් කර නැත',

  trade: 'රැකියාව',
  dailyRate: 'දෛනික වැටුප',
  earned: 'උපයාගත්',
  advanceOver: 'අත්තිකාරම් වැඩිය',
  balance: 'ශේෂය',
  settled: 'ගෙවා අවසන්',
  byProject: 'ව්‍යාපෘතිය අනුව',
  lastPayments: 'අවසන් ගෙවීම් සහ අත්තිකාරම්',
  wage_payment: 'ගෙවීම',
  wage_advance: 'අත්තිකාරම්',
  balToPay: 'ගෙවිය යුතු {amount}',
  balAdvanceOver: 'අත්තිකාරම් වැඩිය {amount}',
  balSettled: 'ගෙවා අවසන්',

  expenseOne: 'වියදම් {n}',
  expenseMany: 'වියදම් {n}',
  noExpenses: 'තවම වියදම් නැත',

  withWho: '{name} ළඟ',
  since: '{date} සිට',
  noToolsOut: 'දැන් පිටත ඇති උපකරණ කිසිවක් නැත',

  siteNote: 'සයිට් සටහන',
  weather: 'කාලගුණය',
  weather_sunny: 'අව්ව',
  weather_cloudy: 'වලාකුළු',
  weather_rain: 'වැසි',
};

const ta: ShareLabels = {
  footer: 'Bluemoon Site மூலம் உருவாக்கப்பட்டது',
  more: '… மேலும் {n}',
  date: 'தேதி',
  project: 'திட்டம்',
  client: 'வாடிக்கையாளர்',
  location: 'இடம்',
  status: 'நிலை',
  total: 'மொத்தம்',
  allProjects: 'அனைத்து திட்டங்கள்',

  status_active: 'நடைபெறுகிறது',
  status_on_hold: 'நிறுத்தப்பட்டது',
  status_completed: 'முடிந்தது',

  cat_materials: 'பொருட்கள்',
  cat_transport: 'போக்குவரத்து',
  cat_fuel: 'எரிபொருள்',
  cat_machinery: 'இயந்திர வாடகை',
  cat_food: 'உணவு & தேநீர்',
  cat_tools: 'கருவிகள்',
  cat_subcontract: 'துணை ஒப்பந்தம்',
  cat_utilities: 'நீர் & மின்சாரம்',
  cat_other: 'மற்றவை',

  contractValue: 'ஒப்பந்த மதிப்பு',
  totalCost: 'மொத்தச் செலவு',
  expenses: 'செலவுகள்',
  labour: 'உழைப்பு (சம்பாதித்தது)',
  labourPaid: 'செலுத்திய கூலி',
  contractUsed: 'ஒப்பந்தத்தில் செலவானது',
  leftInContract: 'ஒப்பந்தத்தில் மீதம்',
  overContract: 'ஒப்பந்தத்தை விட அதிகம்',
  byCategory: 'வகை வாரியாக',
  workers: 'தொழிலாளர்',
  toolsOut: 'வெளியே உள்ள கருவிகள்',
  latestNotes: 'சமீபத்திய குறிப்புகள்',

  estimate: 'மதிப்பீடு',
  validUntil: 'செல்லுபடியாகும் தேதி',
  items: 'உருப்படிகள்',
  subtotal: 'உப மொத்தம்',
  discount: 'தள்ளுபடி',
  tax: 'வரி',
  grandTotal: 'மொத்தத் தொகை',
  paymentSchedule: 'கொடுப்பனவு அட்டவணை',
  phone: 'தொலைபேசி',

  daySheet: 'வேலை மற்றும் சம்பளம்',
  days: 'நாட்கள்',
  wages: 'கூலி',
  paid: 'செலுத்தியது',
  toPay: 'செலுத்த வேண்டியது',
  advances: 'முன்பணம்',
  dayOne: '{n} நாள்',
  dayMany: '{n} நாள்',
  paidInline: 'செலுத்தியது {amount}',
  notPaidInline: 'செலுத்தவில்லை',
  advanceInline: 'முன்பணம் {amount}',
  otherPayments: 'பிற செலுத்துகைகள்',
  noWork: 'இந்த நாளுக்கு வேலை பதிவு செய்யப்படவில்லை',

  trade: 'தொழில்',
  dailyRate: 'நாள் கூலி',
  earned: 'சம்பாதித்தது',
  advanceOver: 'முன்பணம் அதிகம்',
  balance: 'மீதம்',
  settled: 'தீர்க்கப்பட்டது',
  byProject: 'திட்டம் வாரியாக',
  lastPayments: 'கடைசி செலுத்துகைகள் மற்றும் முன்பணம்',
  wage_payment: 'செலுத்துகை',
  wage_advance: 'முன்பணம்',
  balToPay: 'செலுத்த வேண்டியது {amount}',
  balAdvanceOver: 'முன்பணம் அதிகம் {amount}',
  balSettled: 'தீர்க்கப்பட்டது',

  expenseOne: '{n} செலவு',
  expenseMany: '{n} செலவுகள்',
  noExpenses: 'இன்னும் செலவுகள் இல்லை',

  withWho: '{name} இடம்',
  since: '{date} முதல்',
  noToolsOut: 'தற்போது எந்தக் கருவியும் வெளியே இல்லை',

  siteNote: 'தளக் குறிப்பு',
  weather: 'வானிலை',
  weather_sunny: 'வெயில்',
  weather_cloudy: 'மேகமூட்டம்',
  weather_rain: 'மழை',
};

export const SHARE_LABELS: Record<Lang, ShareLabels> = { en, si, ta };

/** The label table for a language (English for anything unknown). */
export function shareLabels(lang: Lang): ShareLabels {
  return SHARE_LABELS[lang] ?? SHARE_LABELS.en;
}

/**
 * Replace `{name}` placeholders. A placeholder with no entry in `vars` is left as written; one whose
 * value is missing (null, undefined) becomes empty and a number that is not finite becomes 0, so
 * "undefined" and "NaN" can never reach a message.
 */
export function fill(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!(name in vars)) return whole;
    const value = vars[name];
    if (value == null) return '';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
    return String(value);
  });
}
