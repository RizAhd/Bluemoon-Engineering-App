/**
 * Printed labels of the estimate (quotation) PDF in English, Sinhala and Tamil.
 *
 * Self-contained on purpose: the language of the PDF is the client's, chosen at share time, and is
 * not the language of the app, so these do not live in src/i18n. Every language must have every key:
 * `EstimateLabels` is the key set of the English table, and a missing translation is a compile error.
 *
 * Names, descriptions, notes and terms are printed as typed; only these fixed labels are translated.
 * Placeholders look like `{pct}` and `{date}` and are filled by `fillLabel`.
 */
import type { Lang } from '@/i18n';

const en = {
  title: 'ESTIMATE',
  estimateNo: 'Estimate No.',
  date: 'Date',
  validUntil: 'Valid until',
  preparedFor: 'Prepared for',
  project: 'Project',
  site: 'Site',
  tel: 'Tel',
  regNo: 'Reg. No.',

  colNo: 'No.',
  colDescription: 'Description',
  colUnit: 'Unit',
  colQty: 'Qty',
  colRate: 'Rate (LKR)',
  colAmount: 'Amount (LKR)',

  subtotal: 'Subtotal',
  discount: 'Discount',
  tax: 'Tax',
  total: 'Total (LKR)',
  amountInWords: 'Amount in words',

  paymentSchedule: 'Payment schedule',
  colStage: 'Stage',
  colPercent: '%',
  scheduledTotal: 'Total',
  scheduleShort: '{pct}% of the total is not scheduled yet.',
  scheduleOver: 'The stages add up to {pct}% of the total.',

  paymentDetails: 'Payment details',
  bankName: 'Bank',
  accountName: 'Account name',
  accountNo: 'Account number',
  branch: 'Branch',

  terms: 'Terms and conditions',
  notes: 'Notes',

  authorisedSignature: 'Authorised signature',
  acceptedByClient: 'Accepted by client (name, signature, date)',

  footer: 'Prices are in Sri Lankan Rupees (LKR). Valid until {date}.',
  printed: 'Printed',
} as const;

export type EstimateLabelKey = keyof typeof en;
export type EstimateLabels = Record<EstimateLabelKey, string>;

const si: EstimateLabels = {
  title: 'ඇස්තමේන්තුව',
  estimateNo: 'ඇස්තමේන්තු අංකය',
  date: 'දිනය',
  validUntil: 'වලංගු වන දිනය',
  preparedFor: 'ගනුදෙනුකරු',
  project: 'ව්‍යාපෘතිය',
  site: 'ස්ථානය',
  tel: 'දුරකථන',
  regNo: 'ලියාපදිංචි අංකය',

  colNo: 'අංක',
  colDescription: 'විස්තරය',
  colUnit: 'ඒකකය',
  colQty: 'ප්‍රමාණය',
  colRate: 'ඒකක මිල (LKR)',
  colAmount: 'මුදල (LKR)',

  subtotal: 'උප එකතුව',
  discount: 'වට්ටම',
  tax: 'බදු',
  total: 'මුළු මුදල (LKR)',
  amountInWords: 'වචනවලින් මුදල',

  paymentSchedule: 'ගෙවීම් කාලසටහන',
  colStage: 'අදියර',
  colPercent: '%',
  scheduledTotal: 'එකතුව',
  scheduleShort: 'මුළු මුදලෙන් {pct}% ක් තවම ගෙවීම් කාලසටහනට ඇතුළත් කර නැත.',
  scheduleOver: 'අදියරවල එකතුව මුළු මුදලෙන් {pct}% කි.',

  paymentDetails: 'ගෙවීම් විස්තර',
  bankName: 'බැංකුව',
  accountName: 'ගිණුමේ නම',
  accountNo: 'ගිණුම් අංකය',
  branch: 'ශාඛාව',

  terms: 'නියමයන් සහ කොන්දේසි',
  notes: 'සටහන්',

  authorisedSignature: 'බලයලත් අත්සන',
  acceptedByClient: 'ගනුදෙනුකරුගේ පිළිගැනීම (නම, අත්සන, දිනය)',

  footer: 'මිල ගණන් ශ්‍රී ලංකා රුපියල්වලින් (LKR) දක්වා ඇත. {date} දක්වා වලංගුය.',
  printed: 'මුද්‍රණය කළ දිනය',
};

const ta: EstimateLabels = {
  title: 'மதிப்பீடு',
  estimateNo: 'மதிப்பீட்டு இலக்கம்',
  date: 'திகதி',
  validUntil: 'செல்லுபடியாகும் திகதி',
  preparedFor: 'வாடிக்கையாளர்',
  project: 'திட்டம்',
  site: 'இடம்',
  tel: 'தொலைபேசி',
  regNo: 'பதிவு இலக்கம்',

  colNo: 'இல.',
  colDescription: 'விவரம்',
  colUnit: 'அலகு',
  colQty: 'அளவு',
  colRate: 'அலகு விலை (LKR)',
  colAmount: 'தொகை (LKR)',

  subtotal: 'உப மொத்தம்',
  discount: 'தள்ளுபடி',
  tax: 'வரி',
  total: 'மொத்தம் (LKR)',
  amountInWords: 'எழுத்தில் தொகை',

  paymentSchedule: 'கொடுப்பனவு அட்டவணை',
  colStage: 'கட்டம்',
  colPercent: '%',
  scheduledTotal: 'மொத்தம்',
  scheduleShort: 'மொத்தத் தொகையில் {pct}% இன்னும் அட்டவணையில் சேர்க்கப்படவில்லை.',
  scheduleOver: 'கட்டங்களின் கூட்டுத்தொகை மொத்தத் தொகையின் {pct}% ஆகும்.',

  paymentDetails: 'கொடுப்பனவு விவரங்கள்',
  bankName: 'வங்கி',
  accountName: 'கணக்கின் பெயர்',
  accountNo: 'கணக்கு இலக்கம்',
  branch: 'கிளை',

  terms: 'விதிமுறைகளும் நிபந்தனைகளும்',
  notes: 'குறிப்புகள்',

  authorisedSignature: 'அதிகாரம் பெற்றவரின் கையொப்பம்',
  acceptedByClient: 'வாடிக்கையாளரின் ஏற்பு (பெயர், கையொப்பம், திகதி)',

  footer: 'விலைகள் இலங்கை ரூபாவில் (LKR) உள்ளன. {date} வரை செல்லுபடியாகும்.',
  printed: 'அச்சிடப்பட்ட திகதி',
};

export const ESTIMATE_LABELS: Record<Lang, EstimateLabels> = { en, si, ta };

/** The label table for a language. */
export function estimateLabels(lang: Lang): EstimateLabels {
  return ESTIMATE_LABELS[lang] ?? ESTIMATE_LABELS.en;
}

/** Replace `{name}` placeholders. A placeholder with no value is left as written. */
export function fillLabel(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
