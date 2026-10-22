/**
 * The share messages as text: the exact output of every builder in English, Sinhala and Tamil for a
 * realistic fixture, what is left out when a value is empty, the caps and the "… and N more" line,
 * typed text that tries to break the formatting, and a property-style run over thousands of nasty
 * inputs. The builders are pure, so nothing here touches a database or a phone.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Lang } from '@/i18n';
import { allocatePayments, estimateSums } from '@/lib/estimate';
import { SHARE_LABELS } from '@/lib/shareLabels';
import {
  daySheetMessage,
  ellipsize,
  estimateMessage,
  expensesMessage,
  messageTitle,
  noteMessage,
  projectMessage,
  SHARE_LIMITS,
  singleLine,
  toolsOutMessage,
  workerStatementMessage,
  type DaySheetShareInput,
  type EstimateShareInput,
  type ExpensesShareInput,
  type NoteShareInput,
  type ProjectShareInput,
  type ToolsOutShareInput,
  type WorkerStatementShareInput,
} from '@/lib/shareText';

const LANGS: Lang[] = ['en', 'si', 'ta'];
const TODAY = '2026-10-22';
const SCHOOL = 'Welimada Primary School Building';
const lines = (...l: string[]) => l.join('\n');
const more = (lang: Lang, n: number) => SHARE_LABELS[lang].more.replace('{n}', String(n));
const FOOTER = {
  en: 'Developed with Bluemoon Site · 22 Oct 2026',
  si: 'Bluemoon Site භාවිතයෙන් සකස් කරන ලදී · 22 Oct 2026',
  ta: 'Bluemoon Site மூலம் உருவாக்கப்பட்டது · 22 Oct 2026',
} satisfies Record<Lang, string>;

// ================================================================ fixtures (the school of the demo data)

const project: ProjectShareInput = {
  today: TODAY,
  project: { name: SCHOOL, client: 'Zonal Education Office, Welimada', location: 'Welimada', status: 'active', contract_cents: 1_850_000_000 },
  cost: { expense_cents: 49_555_000, labour_cents: 6_180_000, labour_paid_cents: 2_900_000 },
  categories: [
    { category: 'materials', cents: 28_140_000 },
    { category: 'subcontract', cents: 12_000_000 },
    { category: 'machinery', cents: 4_200_000 },
    { category: 'transport', cents: 1_850_000 },
    { category: 'fuel', cents: 1_200_000 },
    { category: 'utilities', cents: 965_000 },
    { category: 'tools', cents: 780_000 },
    { category: 'food', cents: 420_000 },
  ],
  workerCount: 5,
  toolsOutCount: 2,
  notes: [
    { day: '2026-10-22', body: 'First-floor slab shuttering completed on the east side. Waiting for the bar-bending inspection before pouring.' },
    { day: '2026-10-21', body: 'Rain after 3 pm, work stopped for the day. Covered the cement bags.' },
  ],
  noteCount: 2,
};

// 1,234,567.89 less 23,456.78, tax 18 %: worked out by the same helper the database view is tested against
const SUMS = estimateSums([{ qty_milli: 1000, rate_cents: 123_456_789 }], 2_345_678, 1800);
const estimate: EstimateShareInput = {
  today: TODAY,
  estimate: { number: 'EST-2026-014', title: 'Boundary wall and gate', client_name: 'Mr. K. A. Perera', location: 'Welimada, Badulla', issue_day: '2026-10-22', valid_days: 30, tax_bp: 1800 },
  payments: [
    { label: 'Advance', percent_bp: 3000 },
    { label: 'Progress payment', percent_bp: 4000 },
    { label: 'On completion', percent_bp: 3000 },
  ],
  total: { estimate_id: 'e1', item_count: 3, ...SUMS, scheduled_bp: 10000 },
  company: { name: 'Bluemoon Engineering (Pvt) Ltd', phone: '077 337 0056' },
};

const daySheet: DaySheetShareInput = {
  today: TODAY,
  projectName: SCHOOL,
  day: '2026-10-21',
  rows: [
    { name: 'Nimal Perera', days: 1, work_cents: 350_000, paid_cents: 1_400_000, advance_cents: 0 },
    { name: 'Sunil Fernando', days: 1, work_cents: 380_000, paid_cents: 1_000_000, advance_cents: 0 },
    { name: 'Kamal Silva', days: 1, work_cents: 220_000, paid_cents: 0, advance_cents: 500_000 },
    { name: 'Ruwan Jayasinghe', days: 1.5, work_cents: 540_000, paid_cents: 0, advance_cents: 0 },
    { name: 'Anura Kumara', days: null, work_cents: 0, paid_cents: 200_000, advance_cents: 0 },
  ],
};

const statement: WorkerStatementShareInput = {
  today: TODAY,
  worker: { name: 'Nimal Perera', trade: 'Mason', daily_rate_cents: 350_000 },
  projectName: null,
  totals: { earned_cents: 2_450_000, advance_cents: 100_000, paid_cents: 1_400_000, balance_cents: 950_000 },
  projects: [
    { name: SCHOOL, days_total: 5, balance_cents: 350_000 },
    { name: 'Badulla Culvert Repair', days_total: 2, balance_cents: 600_000 },
  ],
  recent: [
    { day: '2026-10-21', kind: 'payment', amount_cents: 1_400_000, project_name: SCHOOL },
    { day: '2026-10-20', kind: 'advance', amount_cents: 100_000, project_name: 'Badulla Culvert Repair' },
  ],
  recentCount: 2,
};

const expenses: ExpensesShareInput = {
  today: TODAY,
  projectName: SCHOOL,
  rows: [
    { day: '2026-10-22', category: 'materials', amount_cents: 18_500_000, paid_to: 'Lanka Cement Depot, Welimada', project_name: SCHOOL },
    { day: '2026-10-22', category: 'food', amount_cents: 420_000, paid_to: 'Kumari Hotel', project_name: SCHOOL },
    { day: '2026-10-21', category: 'transport', amount_cents: 1_850_000, paid_to: 'Perera Transport', project_name: SCHOOL },
    { day: '2026-10-21', category: 'fuel', amount_cents: 1_200_000, paid_to: null, project_name: SCHOOL },
  ],
  totalCents: 49_555_000,
  totalCount: 9,
};

const tools: ToolsOutShareInput = {
  today: TODAY,
  projectName: SCHOOL,
  tools: [
    { name: 'Concrete mixer', code: 'BM-T-002', with_name: 'Nimal Perera', since: '2026-10-19', project_name: SCHOOL },
    { name: 'Hilti drill', code: 'BM-T-001', with_name: 'Sunil Fernando', since: '2026-10-20', project_name: SCHOOL },
  ],
};

const note: NoteShareInput = {
  today: TODAY,
  projectName: SCHOOL,
  day: '2026-10-22',
  body: 'First-floor slab shuttering completed on the east side.\nWaiting for the bar-bending inspection before pouring.',
  weather: 'sunny',
};

// ================================================================ the exact output

const PROJECT_EXPECTED: Record<Lang, string> = {
  en: lines(
    `*${SCHOOL}*`,
    'Client: Zonal Education Office, Welimada',
    'Location: Welimada',
    'Status: Active',
    '',
    'Contract value: Rs 18,500,000',
    'Total cost: Rs 557,350',
    'Expenses: Rs 495,550',
    'Labour (earned): Rs 61,800',
    'Labour paid: Rs 29,000',
    'Contract used: 3%',
    'Left in contract: Rs 17,942,650',
    '',
    'By category',
    'Materials: Rs 281,400',
    'Sub-contract: Rs 120,000',
    'Machine hire: Rs 42,000',
    'Transport: Rs 18,500',
    'Fuel: Rs 12,000',
    '… and 3 more',
    '',
    'Workers: 5',
    'Tools out: 2',
    '',
    'Latest notes',
    '22 Oct 2026 — First-floor slab shuttering completed on the east side. Waiting for the bar-bending inspection before pouring.',
    '21 Oct 2026 — Rain after 3 pm, work stopped for the day. Covered the cement bags.',
    '',
    FOOTER.en,
  ),
  si: lines(
    `*${SCHOOL}*`,
    'සේවාදායකයා: Zonal Education Office, Welimada',
    'ස්ථානය: Welimada',
    'තත්ත්වය: ක්‍රියාත්මකයි',
    '',
    'කොන්ත්‍රාත් වටිනාකම: Rs 18,500,000',
    'මුළු වියදම: Rs 557,350',
    'වියදම්: Rs 495,550',
    'ශ්‍රමය (උපයාගත්): Rs 61,800',
    'ගෙවූ වැටුප්: Rs 29,000',
    'කොන්ත්‍රාත්තුවෙන් වැය වූයේ: 3%',
    'කොන්ත්‍රාත්තුවේ ඉතිරි: Rs 17,942,650',
    '',
    'වර්ගය අනුව',
    'ද්‍රව්‍ය: Rs 281,400',
    'උප කොන්ත්‍රාත්: Rs 120,000',
    'යන්ත්‍ර කුලී: Rs 42,000',
    'ප්‍රවාහනය: Rs 18,500',
    'ඉන්ධන: Rs 12,000',
    '… සහ තවත් 3ක්',
    '',
    'කම්කරුවන්: 5',
    'පිටත ඇති උපකරණ: 2',
    '',
    'නවතම සටහන්',
    '22 Oct 2026 — First-floor slab shuttering completed on the east side. Waiting for the bar-bending inspection before pouring.',
    '21 Oct 2026 — Rain after 3 pm, work stopped for the day. Covered the cement bags.',
    '',
    FOOTER.si,
  ),
  ta: lines(
    `*${SCHOOL}*`,
    'வாடிக்கையாளர்: Zonal Education Office, Welimada',
    'இடம்: Welimada',
    'நிலை: நடைபெறுகிறது',
    '',
    'ஒப்பந்த மதிப்பு: Rs 18,500,000',
    'மொத்தச் செலவு: Rs 557,350',
    'செலவுகள்: Rs 495,550',
    'உழைப்பு (சம்பாதித்தது): Rs 61,800',
    'செலுத்திய கூலி: Rs 29,000',
    'ஒப்பந்தத்தில் செலவானது: 3%',
    'ஒப்பந்தத்தில் மீதம்: Rs 17,942,650',
    '',
    'வகை வாரியாக',
    'பொருட்கள்: Rs 281,400',
    'துணை ஒப்பந்தம்: Rs 120,000',
    'இயந்திர வாடகை: Rs 42,000',
    'போக்குவரத்து: Rs 18,500',
    'எரிபொருள்: Rs 12,000',
    '… மேலும் 3',
    '',
    'தொழிலாளர்: 5',
    'வெளியே உள்ள கருவிகள்: 2',
    '',
    'சமீபத்திய குறிப்புகள்',
    '22 Oct 2026 — First-floor slab shuttering completed on the east side. Waiting for the bar-bending inspection before pouring.',
    '21 Oct 2026 — Rain after 3 pm, work stopped for the day. Covered the cement bags.',
    '',
    FOOTER.ta,
  ),
};

const ESTIMATE_EXPECTED: Record<Lang, string> = {
  en: lines(
    '*Estimate EST-2026-014*',
    'Project: Boundary wall and gate',
    'Client: Mr. K. A. Perera',
    'Location: Welimada, Badulla',
    'Date: 22 Oct 2026',
    'Valid until: 21 Nov 2026',
    '',
    'Items: 3',
    'Subtotal: Rs 1,234,567.89',
    'Discount: -Rs 23,456.78',
    'Tax (18%): Rs 218,000',
    '*TOTAL: Rs 1,429,111.11*',
    '',
    'Payment schedule',
    'Advance (30%): Rs 428,733.33',
    'Progress payment (40%): Rs 571,644.44',
    'On completion (30%): Rs 428,733.34',
    '',
    'Bluemoon Engineering (Pvt) Ltd',
    'Phone: 077 337 0056',
    '',
    FOOTER.en,
  ),
  si: lines(
    '*ඇස්තමේන්තුව EST-2026-014*',
    'ව්‍යාපෘතිය: Boundary wall and gate',
    'සේවාදායකයා: Mr. K. A. Perera',
    'ස්ථානය: Welimada, Badulla',
    'දිනය: 22 Oct 2026',
    'වලංගු වන දිනය: 21 Nov 2026',
    '',
    'අයිතම: 3',
    'උප එකතුව: Rs 1,234,567.89',
    'වට්ටම: -Rs 23,456.78',
    'බදු (18%): Rs 218,000',
    '*මුළු මුදල: Rs 1,429,111.11*',
    '',
    'ගෙවීම් කාලසටහන',
    'Advance (30%): Rs 428,733.33',
    'Progress payment (40%): Rs 571,644.44',
    'On completion (30%): Rs 428,733.34',
    '',
    'Bluemoon Engineering (Pvt) Ltd',
    'දුරකථනය: 077 337 0056',
    '',
    FOOTER.si,
  ),
  ta: lines(
    '*மதிப்பீடு EST-2026-014*',
    'திட்டம்: Boundary wall and gate',
    'வாடிக்கையாளர்: Mr. K. A. Perera',
    'இடம்: Welimada, Badulla',
    'தேதி: 22 Oct 2026',
    'செல்லுபடியாகும் தேதி: 21 Nov 2026',
    '',
    'உருப்படிகள்: 3',
    'உப மொத்தம்: Rs 1,234,567.89',
    'தள்ளுபடி: -Rs 23,456.78',
    'வரி (18%): Rs 218,000',
    '*மொத்தத் தொகை: Rs 1,429,111.11*',
    '',
    'கொடுப்பனவு அட்டவணை',
    'Advance (30%): Rs 428,733.33',
    'Progress payment (40%): Rs 571,644.44',
    'On completion (30%): Rs 428,733.34',
    '',
    'Bluemoon Engineering (Pvt) Ltd',
    'தொலைபேசி: 077 337 0056',
    '',
    FOOTER.ta,
  ),
};

const DAY_SHEET_EXPECTED: Record<Lang, string> = {
  en: lines(
    `*Work and pay — ${SCHOOL}*`,
    'Date: 21 Oct 2026',
    '',
    'Nimal Perera — 1 day — Rs 3,500 (paid Rs 14,000)',
    'Sunil Fernando — 1 day — Rs 3,800 (paid Rs 10,000)',
    'Kamal Silva — 1 day — Rs 2,200 (not paid, advance Rs 5,000)',
    'Ruwan Jayasinghe — 1.5 days — Rs 5,400 (not paid)',
    '',
    'Other payments',
    'Anura Kumara — paid Rs 2,000',
    '',
    'Workers: 4',
    'Days: 4.5',
    'Wages: Rs 14,900',
    'Paid: Rs 26,000',
    'Advances: Rs 5,000',
    'To pay: Rs 7,600',
    '',
    FOOTER.en,
  ),
  si: lines(
    `*වැඩ සහ ගෙවීම් — ${SCHOOL}*`,
    'දිනය: 21 Oct 2026',
    '',
    'Nimal Perera — දවස් 1 — Rs 3,500 (ගෙවූ Rs 14,000)',
    'Sunil Fernando — දවස් 1 — Rs 3,800 (ගෙවූ Rs 10,000)',
    'Kamal Silva — දවස් 1 — Rs 2,200 (ගෙවා නැත, අත්තිකාරම් Rs 5,000)',
    'Ruwan Jayasinghe — දවස් 1.5 — Rs 5,400 (ගෙවා නැත)',
    '',
    'වෙනත් ගෙවීම්',
    'Anura Kumara — ගෙවූ Rs 2,000',
    '',
    'කම්කරුවන්: 4',
    'දින: 4.5',
    'වැටුප්: Rs 14,900',
    'ගෙවූ: Rs 26,000',
    'අත්තිකාරම්: Rs 5,000',
    'ගෙවිය යුතු: Rs 7,600',
    '',
    FOOTER.si,
  ),
  ta: lines(
    `*வேலை மற்றும் சம்பளம் — ${SCHOOL}*`,
    'தேதி: 21 Oct 2026',
    '',
    'Nimal Perera — 1 நாள் — Rs 3,500 (செலுத்தியது Rs 14,000)',
    'Sunil Fernando — 1 நாள் — Rs 3,800 (செலுத்தியது Rs 10,000)',
    'Kamal Silva — 1 நாள் — Rs 2,200 (செலுத்தவில்லை, முன்பணம் Rs 5,000)',
    'Ruwan Jayasinghe — 1.5 நாள் — Rs 5,400 (செலுத்தவில்லை)',
    '',
    'பிற செலுத்துகைகள்',
    'Anura Kumara — செலுத்தியது Rs 2,000',
    '',
    'தொழிலாளர்: 4',
    'நாட்கள்: 4.5',
    'கூலி: Rs 14,900',
    'செலுத்தியது: Rs 26,000',
    'முன்பணம்: Rs 5,000',
    'செலுத்த வேண்டியது: Rs 7,600',
    '',
    FOOTER.ta,
  ),
};

const STATEMENT_EXPECTED: Record<Lang, string> = {
  en: lines(
    '*Nimal Perera*',
    'Trade: Mason',
    'Daily rate: Rs 3,500',
    '',
    'Earned: Rs 24,500',
    'Advances: Rs 1,000',
    'Paid: Rs 14,000',
    'To pay: Rs 9,500',
    '',
    'Per project',
    `${SCHOOL} — 5 days — to pay Rs 3,500`,
    'Badulla Culvert Repair — 2 days — to pay Rs 6,000',
    '',
    'Last payments and advances',
    `21 Oct 2026 — Payment — Rs 14,000 — ${SCHOOL}`,
    '20 Oct 2026 — Advance — Rs 1,000 — Badulla Culvert Repair',
    '',
    FOOTER.en,
  ),
  si: lines(
    '*Nimal Perera*',
    'රැකියාව: Mason',
    'දෛනික වැටුප: Rs 3,500',
    '',
    'උපයාගත්: Rs 24,500',
    'අත්තිකාරම්: Rs 1,000',
    'ගෙවූ: Rs 14,000',
    'ගෙවිය යුතු: Rs 9,500',
    '',
    'ව්‍යාපෘතිය අනුව',
    `${SCHOOL} — දවස් 5 — ගෙවිය යුතු Rs 3,500`,
    'Badulla Culvert Repair — දවස් 2 — ගෙවිය යුතු Rs 6,000',
    '',
    'අවසන් ගෙවීම් සහ අත්තිකාරම්',
    `21 Oct 2026 — ගෙවීම — Rs 14,000 — ${SCHOOL}`,
    '20 Oct 2026 — අත්තිකාරම් — Rs 1,000 — Badulla Culvert Repair',
    '',
    FOOTER.si,
  ),
  ta: lines(
    '*Nimal Perera*',
    'தொழில்: Mason',
    'நாள் கூலி: Rs 3,500',
    '',
    'சம்பாதித்தது: Rs 24,500',
    'முன்பணம்: Rs 1,000',
    'செலுத்தியது: Rs 14,000',
    'செலுத்த வேண்டியது: Rs 9,500',
    '',
    'திட்டம் வாரியாக',
    `${SCHOOL} — 5 நாள் — செலுத்த வேண்டியது Rs 3,500`,
    'Badulla Culvert Repair — 2 நாள் — செலுத்த வேண்டியது Rs 6,000',
    '',
    'கடைசி செலுத்துகைகள் மற்றும் முன்பணம்',
    `21 Oct 2026 — செலுத்துகை — Rs 14,000 — ${SCHOOL}`,
    '20 Oct 2026 — முன்பணம் — Rs 1,000 — Badulla Culvert Repair',
    '',
    FOOTER.ta,
  ),
};

const EXPENSES_EXPECTED: Record<Lang, string> = {
  en: lines(
    `*Expenses — ${SCHOOL}*`,
    'Total: Rs 495,550 (9 expenses)',
    '',
    '22 Oct 2026 — Materials — Lanka Cement Depot, Welimada — Rs 185,000',
    '22 Oct 2026 — Food & tea — Kumari Hotel — Rs 4,200',
    '21 Oct 2026 — Transport — Perera Transport — Rs 18,500',
    '21 Oct 2026 — Fuel — Rs 12,000',
    '… and 5 more',
    '',
    FOOTER.en,
  ),
  si: lines(
    `*වියදම් — ${SCHOOL}*`,
    'එකතුව: Rs 495,550 (වියදම් 9)',
    '',
    '22 Oct 2026 — ද්‍රව්‍ය — Lanka Cement Depot, Welimada — Rs 185,000',
    '22 Oct 2026 — කෑම සහ තේ — Kumari Hotel — Rs 4,200',
    '21 Oct 2026 — ප්‍රවාහනය — Perera Transport — Rs 18,500',
    '21 Oct 2026 — ඉන්ධන — Rs 12,000',
    '… සහ තවත් 5ක්',
    '',
    FOOTER.si,
  ),
  ta: lines(
    `*செலவுகள் — ${SCHOOL}*`,
    'மொத்தம்: Rs 495,550 (9 செலவுகள்)',
    '',
    '22 Oct 2026 — பொருட்கள் — Lanka Cement Depot, Welimada — Rs 185,000',
    '22 Oct 2026 — உணவு & தேநீர் — Kumari Hotel — Rs 4,200',
    '21 Oct 2026 — போக்குவரத்து — Perera Transport — Rs 18,500',
    '21 Oct 2026 — எரிபொருள் — Rs 12,000',
    '… மேலும் 5',
    '',
    FOOTER.ta,
  ),
};

const TOOLS_EXPECTED: Record<Lang, string> = {
  en: lines(
    `*Tools out — ${SCHOOL}*`,
    'Tools out: 2',
    '',
    'Concrete mixer (BM-T-002) — with Nimal Perera — since 19 Oct 2026',
    'Hilti drill (BM-T-001) — with Sunil Fernando — since 20 Oct 2026',
    '',
    FOOTER.en,
  ),
  si: lines(
    `*පිටත ඇති උපකරණ — ${SCHOOL}*`,
    'පිටත ඇති උපකරණ: 2',
    '',
    'Concrete mixer (BM-T-002) — Nimal Perera ළඟ — 19 Oct 2026 සිට',
    'Hilti drill (BM-T-001) — Sunil Fernando ළඟ — 20 Oct 2026 සිට',
    '',
    FOOTER.si,
  ),
  ta: lines(
    `*வெளியே உள்ள கருவிகள் — ${SCHOOL}*`,
    'வெளியே உள்ள கருவிகள்: 2',
    '',
    'Concrete mixer (BM-T-002) — Nimal Perera இடம் — 19 Oct 2026 முதல்',
    'Hilti drill (BM-T-001) — Sunil Fernando இடம் — 20 Oct 2026 முதல்',
    '',
    FOOTER.ta,
  ),
};

const NOTE_EXPECTED: Record<Lang, string> = {
  en: lines(
    `*Site note — ${SCHOOL}*`,
    'Date: 22 Oct 2026',
    'Weather: Sunny',
    '',
    'First-floor slab shuttering completed on the east side.',
    'Waiting for the bar-bending inspection before pouring.',
    '',
    FOOTER.en,
  ),
  si: lines(
    `*සයිට් සටහන — ${SCHOOL}*`,
    'දිනය: 22 Oct 2026',
    'කාලගුණය: අව්ව',
    '',
    'First-floor slab shuttering completed on the east side.',
    'Waiting for the bar-bending inspection before pouring.',
    '',
    FOOTER.si,
  ),
  ta: lines(
    `*தளக் குறிப்பு — ${SCHOOL}*`,
    'தேதி: 22 Oct 2026',
    'வானிலை: வெயில்',
    '',
    'First-floor slab shuttering completed on the east side.',
    'Waiting for the bar-bending inspection before pouring.',
    '',
    FOOTER.ta,
  ),
};

describe('the exact text of each message', () => {
  it.each(LANGS)('project, %s', (lang) => {
    expect(projectMessage(project, lang)).toBe(PROJECT_EXPECTED[lang]);
  });
  it.each(LANGS)('estimate, %s', (lang) => {
    expect(estimateMessage(estimate, lang)).toBe(ESTIMATE_EXPECTED[lang]);
  });
  it.each(LANGS)('work and pay of a day, %s', (lang) => {
    expect(daySheetMessage(daySheet, lang)).toBe(DAY_SHEET_EXPECTED[lang]);
  });
  it.each(LANGS)('worker statement, %s', (lang) => {
    expect(workerStatementMessage(statement, lang)).toBe(STATEMENT_EXPECTED[lang]);
  });
  it.each(LANGS)('expenses of a project, %s', (lang) => {
    expect(expensesMessage(expenses, lang)).toBe(EXPENSES_EXPECTED[lang]);
  });
  it.each(LANGS)('tools out on a project, %s', (lang) => {
    expect(toolsOutMessage(tools, lang)).toBe(TOOLS_EXPECTED[lang]);
  });
  it.each(LANGS)('site note, %s', (lang) => {
    expect(noteMessage(note, lang)).toBe(NOTE_EXPECTED[lang]);
  });

  it('the figures of the fixtures were worked out by hand and by the helpers, not copied from the builders', () => {
    // the estimate: 1,234,567.89 less 23,456.78 is 1,211,111.11; tax 18 % is 218,000.00 (half up); total 1,429,111.11
    expect(SUMS).toEqual({ subtotal_cents: 123_456_789, discount_cents: 2_345_678, tax_cents: 21_800_000, total_cents: 142_911_111 });
    // 30 % / 40 % / 30 %, the last stage takes the remainder so the stages add up to the total to the cent
    expect(allocatePayments(SUMS.total_cents, [3000, 4000, 3000])).toEqual([42_873_333, 57_164_444, 42_873_334]);
    // the project: 495,550 + 61,800 = 557,350 of 18,500,000 is 3 %
    expect(Math.round(((49_555_000 + 6_180_000) / 1_850_000_000) * 100)).toBe(3);
  });
});

// ================================================================ the shape every message has

const EVERY_MESSAGE: [string, (lang: Lang) => string][] = [
  ['project', (l) => projectMessage(project, l)],
  ['estimate', (l) => estimateMessage(estimate, l)],
  ['work and pay', (l) => daySheetMessage(daySheet, l)],
  ['worker statement', (l) => workerStatementMessage(statement, l)],
  ['expenses', (l) => expensesMessage(expenses, l)],
  ['tools out', (l) => toolsOutMessage(tools, l)],
  ['note', (l) => noteMessage(note, l)],
];

describe.each(EVERY_MESSAGE)('the shape of the %s message', (_name, build) => {
  it.each(LANGS)('%s: bold title first, footer with the date last, tidy lines, no emoji', (lang) => {
    const text = build(lang);
    const all = text.split('\n');
    expect(all[0]).toMatch(/^\*[^*\n]+\*$/);
    expect(all[all.length - 1]).toBe(FOOTER[lang]);
    expect(all[all.length - 2]).toBe(''); // a blank line before the footer
    expect(text).not.toMatch(/\r/);
    expect(text).not.toMatch(/\n\n\n/);
    expect(text.startsWith('\n') || text.endsWith('\n')).toBe(false);
    for (const line of all) {
      expect({ line, tidy: line === line.trim() }).toEqual({ line, tidy: true });
      expect({ line, empty: /:\s*$/.test(line) }).toEqual({ line, empty: false });
    }
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toMatch(/undefined|null|NaN/);
    expect(text.length).toBeLessThanOrEqual(SHARE_LIMITS.message);
  });

  it('Sinhala messages contain Sinhala and Tamil messages contain Tamil', () => {
    expect(build('si')).toMatch(/[\u{0D80}-\u{0DFF}]/u);
    expect(build('ta')).toMatch(/[\u{0B80}-\u{0BFF}]/u);
    expect(build('en')).not.toMatch(/[\u{0D80}-\u{0DFF}\u{0B80}-\u{0BFF}]/u);
  });
});

// ================================================================ what is left out

describe('a label whose value is empty is left out', () => {
  it('a project with nothing but a name: no client, location, contract or lists', () => {
    const bare: ProjectShareInput = {
      today: TODAY,
      project: { name: 'Site A', client: null, location: null, status: 'active', contract_cents: null },
      cost: { expense_cents: 0, labour_cents: 0, labour_paid_cents: 0 },
      categories: [],
      workerCount: 0,
      toolsOutCount: 0,
      notes: [],
      noteCount: 0,
    };
    expect(projectMessage(bare, 'en')).toBe(
      lines('*Site A*', 'Status: Active', '', 'Total cost: Rs 0', 'Expenses: Rs 0', 'Labour (earned): Rs 0', 'Labour paid: Rs 0', '', 'Workers: 0', '', FOOTER.en),
    );
  });

  it('a contract value of 0 counts as no contract (as on the project screen), so there is no percentage to divide by', () => {
    const text = projectMessage({ ...project, project: { ...project.project, contract_cents: 0 } }, 'en');
    expect(text).not.toMatch(/Contract value|Contract used|Left in contract|Over contract|%/);
    expect(text).toContain('Total cost: Rs 557,350');
  });

  it('a project over its contract says by how much, and the share is more than 100 %', () => {
    const text = projectMessage({ ...project, project: { ...project.project, contract_cents: 50_000_000 } }, 'en');
    expect(text).toContain('Contract value: Rs 500,000');
    expect(text).toContain('Contract used: 111%'); // 557,350 / 500,000
    expect(text).toContain('Over contract: Rs 57,350');
    expect(text).not.toContain('Left in contract');
  });

  it('a project whose contract is exactly used is "left: Rs 0", not "over"', () => {
    const text = projectMessage({ ...project, project: { ...project.project, contract_cents: 55_735_000 } }, 'en');
    expect(text).toContain('Contract used: 100%');
    expect(text).toContain('Left in contract: Rs 0');
  });

  it('tools out are only mentioned when there are some; workers are always mentioned', () => {
    const none = projectMessage({ ...project, workerCount: 0, toolsOutCount: 0 }, 'en');
    expect(none).toContain('Workers: 0');
    expect(none).not.toContain('Tools out');
  });

  it('an estimate without location, discount, tax, stages or company details', () => {
    const bare: EstimateShareInput = {
      today: TODAY,
      estimate: { number: 'EST-2026-001', title: 'Wall', client_name: 'Client', location: null, issue_day: '2026-10-22', valid_days: 30, tax_bp: 0 },
      payments: [],
      total: { estimate_id: 'e', item_count: 0, subtotal_cents: 0, discount_cents: 0, tax_cents: 0, total_cents: 0, scheduled_bp: 0 },
      company: { name: '', phone: '' },
    };
    expect(estimateMessage(bare, 'en')).toBe(
      lines('*Estimate EST-2026-001*', 'Project: Wall', 'Client: Client', 'Date: 22 Oct 2026', 'Valid until: 21 Nov 2026', '', 'Items: 0', 'Subtotal: Rs 0', '*TOTAL: Rs 0*', '', FOOTER.en),
    );
  });

  it('an estimate shows a discount or a tax line only when there is one, and only the company details that are filled in', () => {
    const base = { ...estimate, total: { ...estimate.total, discount_cents: 0, tax_cents: 0 }, estimate: { ...estimate.estimate, tax_bp: 0 } };
    const text = estimateMessage({ ...base, company: { name: 'Bluemoon Engineering (Pvt) Ltd', phone: '' } }, 'en');
    expect(text).not.toMatch(/Discount|Tax/);
    expect(text).toContain('Bluemoon Engineering (Pvt) Ltd');
    expect(text).not.toContain('Phone');
    expect(estimateMessage({ ...base, company: { name: '', phone: '077 337 0056' } }, 'en')).toContain('\n\nPhone: 077 337 0056\n\n');
  });

  it('a tax of 12.5 % shows its decimals', () => {
    const text = estimateMessage({ ...estimate, estimate: { ...estimate.estimate, tax_bp: 1250 } }, 'en');
    expect(text).toContain('Tax (12.5%): Rs ');
  });

  it('a day with no work at all', () => {
    expect(daySheetMessage({ today: TODAY, projectName: 'Site A', day: '2026-10-22', rows: [] }, 'en')).toBe(
      lines('*Work and pay — Site A*', 'Date: 22 Oct 2026', '', 'No work recorded for this day', '', FOOTER.en),
    );
  });

  it('a day with a payment and nobody working shows the payment and the totals, with 0 workers', () => {
    const text = daySheetMessage({ today: TODAY, projectName: 'Site A', day: '2026-10-22', rows: [{ name: 'Anura Kumara', days: null, work_cents: 0, paid_cents: 200_000, advance_cents: 0 }] }, 'en');
    expect(text).toContain('Other payments\nAnura Kumara — paid Rs 2,000');
    expect(text).toContain('Workers: 0\nDays: 0\nWages: Rs 0\nPaid: Rs 2,000\nTo pay: Rs 0');
    expect(text).not.toContain('Advances');
  });

  it('a person who neither worked nor was paid on that day is not on the sheet', () => {
    const text = daySheetMessage({ today: TODAY, projectName: 'Site A', day: '2026-10-22', rows: [{ name: 'Idle Person', days: null, work_cents: 0, paid_cents: 0, advance_cents: 0 }] }, 'en');
    expect(text).not.toContain('Idle Person');
    expect(text).toContain('No work recorded for this day');
  });

  it('what is still to pay is worked out per worker: an overpaid worker does not cancel out an unpaid one', () => {
    const text = daySheetMessage(
      {
        today: TODAY,
        projectName: 'Site A',
        day: '2026-10-22',
        rows: [
          { name: 'Overpaid', days: 1, work_cents: 100_000, paid_cents: 500_000, advance_cents: 0 },
          { name: 'Unpaid', days: 1, work_cents: 100_000, paid_cents: 0, advance_cents: 0 },
        ],
      },
      'en',
    );
    expect(text).toContain('Wages: Rs 2,000\nPaid: Rs 5,000\nTo pay: Rs 1,000');
  });

  it('days are shown as 1 day, 0.5 days, 1.25 days, 2 days', () => {
    const row = (days: number) => ({ name: `W${days}`, days, work_cents: 100_000, paid_cents: 0, advance_cents: 0 });
    const text = daySheetMessage({ today: TODAY, projectName: 'S', day: '2026-10-22', rows: [row(1), row(0.5), row(1.25), row(2), row(0.1 + 0.2)] }, 'en');
    expect(text).toContain('W1 — 1 day —');
    expect(text).toContain('W0.5 — 0.5 days —');
    expect(text).toContain('W1.25 — 1.25 days —');
    expect(text).toContain('W2 — 2 days —');
    expect(text).toContain('— 0.3 days —'); // 0.30000000000000004
    expect(text).toContain('Days: 5.05');
  });

  it('a statement of a settled worker with no trade, rate, projects or payments', () => {
    const bare: WorkerStatementShareInput = {
      today: TODAY,
      worker: { name: 'Kamal Silva', trade: null, daily_rate_cents: 0 },
      projectName: null,
      totals: { earned_cents: 0, advance_cents: 0, paid_cents: 0, balance_cents: 0 },
      projects: [],
      recent: [],
      recentCount: 0,
    };
    expect(workerStatementMessage(bare, 'en')).toBe(lines('*Kamal Silva*', 'Earned: Rs 0', 'Advances: Rs 0', 'Paid: Rs 0', 'Balance: Settled', '', FOOTER.en));
  });

  it('a worker who has had more than he earned: "Advance over", and the same in the project lines', () => {
    const text = workerStatementMessage(
      { ...statement, totals: { earned_cents: 100_000, advance_cents: 150_000, paid_cents: 0, balance_cents: -50_000 }, projects: [{ name: 'Site A', days_total: 1, balance_cents: -50_000 }, { name: 'Site B', days_total: 0, balance_cents: 0 }] },
      'en',
    );
    expect(text).toContain('Advance over: Rs 500');
    expect(text).toContain('Site A — 1 day — advance over Rs 500');
    expect(text).toContain('Site B — settled');
    expect(text).not.toContain('To pay');
  });

  it('a statement for one project names the project and has no per-project list or project on the payment lines', () => {
    const text = workerStatementMessage({ ...statement, projectName: SCHOOL, projects: [] }, 'en');
    expect(text).toBe(
      lines(
        '*Nimal Perera*',
        'Trade: Mason',
        `Project: ${SCHOOL}`,
        'Daily rate: Rs 3,500',
        '',
        'Earned: Rs 24,500',
        'Advances: Rs 1,000',
        'Paid: Rs 14,000',
        'To pay: Rs 9,500',
        '',
        'Last payments and advances',
        '21 Oct 2026 — Payment — Rs 14,000',
        '20 Oct 2026 — Advance — Rs 1,000',
        '',
        FOOTER.en,
      ),
    );
  });

  it('expenses of all projects name the project on every line; with none, the message says so', () => {
    const all = expensesMessage({ ...expenses, projectName: null, rows: expenses.rows.slice(0, 2), totalCount: 2, totalCents: 18_920_000 }, 'en');
    expect(all).toBe(
      lines(
        '*Expenses — All projects*',
        'Total: Rs 189,200 (2 expenses)',
        '',
        `22 Oct 2026 — Materials — Lanka Cement Depot, Welimada — Rs 185,000 — ${SCHOOL}`,
        `22 Oct 2026 — Food & tea — Kumari Hotel — Rs 4,200 — ${SCHOOL}`,
        '',
        FOOTER.en,
      ),
    );
    expect(expensesMessage({ today: TODAY, projectName: null, rows: [], totalCents: 0, totalCount: 0 }, 'en')).toBe(
      lines('*Expenses — All projects*', 'Total: Rs 0', '', 'No expenses yet', '', FOOTER.en),
    );
    expect(expensesMessage({ ...expenses, rows: expenses.rows.slice(0, 1), totalCount: 1, totalCents: 18_500_000 }, 'en')).toContain('Total: Rs 185,000 (1 expense)\n');
  });

  it('a category the app does not know is shown as typed; an empty one as "Other"', () => {
    const rows = [
      { day: '2026-10-22', category: 'scaffolding', amount_cents: 100_000, paid_to: null, project_name: 'S' },
      { day: '2026-10-22', category: '', amount_cents: 100_000, paid_to: null, project_name: 'S' },
      { day: '2026-10-22', category: '__proto__', amount_cents: 100_000, paid_to: null, project_name: 'S' },
    ];
    const text = expensesMessage({ today: TODAY, projectName: 'S', rows, totalCents: 300_000, totalCount: 3 }, 'en');
    expect(text).toContain('22 Oct 2026 — scaffolding — Rs 1,000');
    expect(text).toContain('22 Oct 2026 — Other — Rs 1,000');
    expect(text).toContain('22 Oct 2026 — __proto__ — Rs 1,000');
  });

  it('tools out: with nobody known and no day, the line is just the tool; with none, the message says so', () => {
    const text = toolsOutMessage({ today: TODAY, projectName: null, tools: [{ name: 'Vibrator poker', code: null, with_name: null, since: null, project_name: null }] }, 'en');
    expect(text).toBe(lines('*Tools out — All projects*', 'Tools out: 1', '', 'Vibrator poker', '', FOOTER.en));
    expect(toolsOutMessage({ today: TODAY, projectName: 'Site A', tools: [] }, 'en')).toBe(lines('*Tools out — Site A*', 'No tools are out right now', '', FOOTER.en));
  });

  it('tools out of all projects name the project, and a tool taken by an outsider names him', () => {
    const text = toolsOutMessage(
      { today: TODAY, projectName: null, tools: [{ name: 'Total station', code: 'BM-T-004', with_name: 'Contractor Silva', since: '2026-10-20', project_name: SCHOOL }] },
      'en',
    );
    expect(text).toContain(`Total station (BM-T-004) — with Contractor Silva — since 20 Oct 2026 — ${SCHOOL}`);
  });

  it('a note without weather, or with a weather word the app does not know, has no weather line', () => {
    expect(noteMessage({ ...note, weather: null }, 'en')).not.toContain('Weather');
    expect(noteMessage({ ...note, weather: 'hailstorm' }, 'en')).not.toContain('Weather');
    expect(noteMessage({ ...note, weather: 'rain' }, 'ta')).toContain('வானிலை: மழை');
    expect(noteMessage({ ...note, weather: 'cloudy' }, 'si')).toContain('කාලගුණය: වලාකුළු');
  });

  it('a note with a missing day or body still makes a message', () => {
    expect(noteMessage({ today: TODAY, projectName: 'Site A', day: '', body: '', weather: null }, 'en')).toBe(lines('*Site note — Site A*', '', FOOTER.en));
  });

  it('the footer has no date when the day is not a real day, and the message still ends with the product line', () => {
    const text = projectMessage({ ...project, today: '2026-02-30' }, 'en');
    expect(text.endsWith('\n\nDeveloped with Bluemoon Site')).toBe(true);
  });
});

// ================================================================ caps

describe('lists are capped, with "… and N more"', () => {
  const rowsOf = <T,>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));

  it('the limits are the documented ones', () => {
    expect(SHARE_LIMITS).toMatchObject({ message: 3500, note: 160, expenses: 30, tools: 40, notes: 3, workers: 40, categories: 5, projects: 15, payments: 5, stages: 10 });
  });

  it.each(LANGS)('%s: 45 expenses show 30 and say 15 more', (lang) => {
    const rows = rowsOf(45, (i) => ({ day: '2026-10-22', category: 'materials', amount_cents: 100_000, paid_to: `Shop ${i + 1}`, project_name: 'S' }));
    const text = expensesMessage({ today: TODAY, projectName: 'S', rows, totalCents: 4_500_000, totalCount: 45 }, lang);
    const shown = text.split('\n').filter((l) => /Shop \d+/.test(l));
    expect(shown).toHaveLength(30);
    expect(shown[0]).toContain('Shop 1 ');
    expect(shown[29]).toContain('Shop 30 ');
    expect(text).toContain(`\n${more(lang, 15)}\n`);
    expect(text).toContain('Rs 45,000'); // the total of all 45, not of the 30 shown
  });

  it('expenses: the "more" counts the ones that were not loaded too (100 in all, 30 loaded)', () => {
    const rows = rowsOf(30, (i) => ({ day: '2026-10-22', category: 'fuel', amount_cents: 1_000, paid_to: `Shop ${i + 1}`, project_name: 'S' }));
    const text = expensesMessage({ today: TODAY, projectName: 'S', rows, totalCents: 100_000, totalCount: 100 }, 'en');
    expect(text).toContain('Total: Rs 1,000 (100 expenses)');
    expect(text).toContain('\n… and 70 more\n');
  });

  it('expenses: 10 loaded and 10 in all show all 10 and no "more"', () => {
    const rows = rowsOf(10, (i) => ({ day: '2026-10-22', category: 'fuel', amount_cents: 1_000, paid_to: `Shop ${i + 1}`, project_name: 'S' }));
    expect(expensesMessage({ today: TODAY, projectName: 'S', rows, totalCents: 10_000, totalCount: 10 }, 'en')).not.toContain('more');
  });

  it.each(LANGS)('%s: 55 tools show 40 and say 15 more', (lang) => {
    const list = rowsOf(55, (i) => ({ name: `Tool ${i + 1}`, code: null, with_name: 'Nimal', since: '2026-10-20', project_name: 'S' }));
    const text = toolsOutMessage({ today: TODAY, projectName: 'S', tools: list }, lang);
    expect(text.split('\n').filter((l) => /^Tool \d+/.test(l))).toHaveLength(40);
    expect(text).toContain(`\n${more(lang, 15)}\n`);
    expect(text).toContain(`: 55\n`); // the count line is all 55
  });

  it.each(LANGS)('%s: 50 workers on a day show 40 and say 10 more; the totals are of all 50', (lang) => {
    const rows = rowsOf(50, (i) => ({ name: `Worker ${i + 1}`, days: 1, work_cents: 100_000, paid_cents: 0, advance_cents: 0 }));
    const text = daySheetMessage({ today: TODAY, projectName: 'S', day: '2026-10-22', rows }, lang);
    expect(text.split('\n').filter((l) => /^Worker \d+ —/.test(l))).toHaveLength(40);
    expect(text).toContain(`\n${more(lang, 10)}\n`);
    const L = SHARE_LABELS[lang];
    expect(text).toContain(`${L.workers}: 50\n${L.days}: 50\n${L.wages}: Rs 50,000\n${L.paid}: Rs 0\n${L.toPay}: Rs 50,000`);
  });

  it('the project message shows 3 notes and says how many more there are', () => {
    const notes = rowsOf(3, (i) => ({ day: `2026-10-${22 - i}`, body: `Note number ${i + 1}` }));
    const text = projectMessage({ ...project, notes, noteCount: 8 }, 'en');
    expect(text).toContain('Latest notes\n22 Oct 2026 — Note number 1\n21 Oct 2026 — Note number 2\n20 Oct 2026 — Note number 3\n… and 5 more\n');
  });

  it('even if more than 3 notes are handed over, only 3 are shown', () => {
    const notes = rowsOf(7, (i) => ({ day: '2026-10-22', body: `Note number ${i + 1}` }));
    const text = projectMessage({ ...project, notes, noteCount: 7 }, 'en');
    expect(text.split('\n').filter((l) => l.includes('Note number'))).toHaveLength(3);
    expect(text).toContain('… and 4 more');
  });

  it('a note inside the project message is cut at 160 characters with an ellipsis', () => {
    const body = 'The east wall shuttering was checked by the engineer and approved for pouring. '.repeat(6);
    const text = projectMessage({ ...project, notes: [{ day: '2026-10-22', body }], noteCount: 1 }, 'en');
    const line = text.split('\n').find((l) => l.startsWith('22 Oct 2026 — ')) ?? '';
    const shown = line.slice('22 Oct 2026 — '.length);
    expect(shown.length).toBeLessThanOrEqual(160);
    expect(shown.length).toBeGreaterThan(150);
    expect(shown.endsWith('…')).toBe(true);
    expect(body.startsWith(shown.slice(0, -1))).toBe(true);
    // a note of exactly 160 is not cut
    const exact = 'x'.repeat(160);
    expect(projectMessage({ ...project, notes: [{ day: '2026-10-22', body: exact }], noteCount: 1 }, 'en')).toContain(` — ${exact}\n`);
  });

  it('9 expense categories show the top 5 and say 4 more', () => {
    const categories = ['materials', 'subcontract', 'machinery', 'transport', 'fuel', 'utilities', 'tools', 'food', 'other'].map((category, i) => ({ category, cents: (9 - i) * 100_000 }));
    const text = projectMessage({ ...project, categories }, 'en');
    expect(text).toContain('By category\nMaterials: Rs 9,000\nSub-contract: Rs 8,000\nMachine hire: Rs 7,000\nTransport: Rs 6,000\nFuel: Rs 5,000\n… and 4 more\n');
  });

  it('categories with nothing spent are not listed', () => {
    const text = projectMessage({ ...project, categories: [{ category: 'fuel', cents: 0 }, { category: 'food', cents: 500 }] }, 'en');
    expect(text).toContain('By category\nFood & tea: Rs 5\n\n');
    expect(text).not.toContain('Fuel');
  });

  it('a statement shows 15 projects and 5 payments, and says how many more', () => {
    const projects = rowsOf(20, (i) => ({ name: `Project ${i + 1}`, days_total: 1, balance_cents: 100_000 }));
    const recent = rowsOf(5, (i) => ({ day: '2026-10-22', kind: 'payment' as const, amount_cents: 100_000, project_name: `Project ${i + 1}` }));
    const text = workerStatementMessage({ ...statement, projects, recent, recentCount: 12 }, 'en');
    expect(text.split('\n').filter((l) => /^Project \d+ — 1 day/.test(l))).toHaveLength(15);
    expect(text).toContain('\n… and 5 more\n\nLast payments and advances\n');
    expect(text).toContain('… and 7 more\n\n' + FOOTER.en);
  });

  it('an estimate shows 10 payment stages and says how many more', () => {
    const payments = rowsOf(12, (i) => ({ label: `Stage ${i + 1}`, percent_bp: 500 }));
    const text = estimateMessage({ ...estimate, payments, total: { ...estimate.total, scheduled_bp: 6000 } }, 'en');
    expect(text.split('\n').filter((l) => /^Stage \d+ \(5%\): /.test(l))).toHaveLength(10);
    expect(text).toContain('\n… and 2 more\n');
  });

  it('a stage amount is the share of the total (allocatePayments), and stages under 100 % stand alone', () => {
    const text = estimateMessage({ ...estimate, payments: [{ label: 'Advance', percent_bp: 2500 }, { label: 'Balance', percent_bp: 1250 }], total: { ...estimate.total, scheduled_bp: 3750 } }, 'en');
    const parts = allocatePayments(SUMS.total_cents, [2500, 1250]);
    expect(text).toContain(`Advance (25%): Rs ${(parts[0] / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    expect(text).toContain(`Balance (12.5%): Rs ${(parts[1] / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  });
});

describe('the length of a message is capped, and the lists give way, never the totals', () => {
  const wide = (s: string, n: number) => (s + ' ').repeat(n).slice(0, n);

  it('expenses: 200 long lines are cut from the end until the message fits; the total, the count and the footer stay', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ day: '2026-10-22', category: 'materials', amount_cents: 100_000, paid_to: `${i + 1}. ${wide('Supplier', 60)}`, project_name: wide('Project', 60) }));
    const text = expensesMessage({ today: TODAY, projectName: null, rows, totalCents: 20_000_000, totalCount: 500 }, 'en');
    expect(text.length).toBeLessThanOrEqual(SHARE_LIMITS.message);
    expect(text.length).toBeGreaterThan(SHARE_LIMITS.message - 400); // cut as little as needed
    expect(text).toContain('Total: Rs 200,000 (500 expenses)');
    expect(text.endsWith(FOOTER.en)).toBe(true);
    const shown = text.split('\n').filter((l) => /^22 Oct 2026 — /.test(l)).length;
    expect(shown).toBeGreaterThan(10);
    expect(shown).toBeLessThan(30);
    expect(text).toContain(`\n… and ${500 - shown} more\n`);
    // the lines that stay are the newest ones, in order
    expect(text).toContain('1. Supplier');
    expect(text).toContain(`${shown}. Supplier`);
    expect(text).not.toContain(`${shown + 1}. Supplier`);
  });

  it.each(LANGS)('%s: tools out, 55 long lines: cut to fit, count and footer stay', (lang) => {
    const list = Array.from({ length: 55 }, (_, i) => ({ name: `${i + 1}. ${wide('Hydraulic breaker', 60)}`, code: 'BM-T-0001', with_name: wide('Somebody', 60), since: '2026-10-20', project_name: wide('Project', 60) }));
    const text = toolsOutMessage({ today: TODAY, projectName: null, tools: list }, lang);
    expect(text.length).toBeLessThanOrEqual(SHARE_LIMITS.message);
    expect(text).toContain(`${SHARE_LABELS[lang].toolsOut}: 55\n`);
    expect(text.endsWith(FOOTER[lang])).toBe(true);
    const shown = text.split('\n').filter((l) => /^\d+\. Hydraulic/.test(l)).length;
    expect(shown).toBeLessThan(40);
    expect(text).toContain(`\n${more(lang, 55 - shown)}\n`);
  });

  it('work and pay: the totals of 100 workers are intact while their lines are cut', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ name: `${i + 1}. ${wide('Worker with a long name', 60)}`, days: 1, work_cents: 350_000, paid_cents: 100_000, advance_cents: 0 }));
    const text = daySheetMessage({ today: TODAY, projectName: wide('Project', 100), day: '2026-10-22', rows }, 'en');
    expect(text.length).toBeLessThanOrEqual(SHARE_LIMITS.message);
    expect(text).toContain('Workers: 100\nDays: 100\nWages: Rs 350,000\nPaid: Rs 100,000\nTo pay: Rs 250,000');
    const shown = text.split('\n').filter((l) => /^\d+\. Worker/.test(l)).length;
    expect(shown).toBeLessThan(40);
    expect(text).toContain(`\n… and ${100 - shown} more\n`);
  });

  it('the last list gives way first: other payments go before the workers of the day', () => {
    const worker = Array.from({ length: 40 }, (_, i) => ({ name: `${i + 1}. ${wide('Worker with a long name', 60)}`, days: 1, work_cents: 350_000, paid_cents: 100_000, advance_cents: 0 }));
    const paidOnly = Array.from({ length: 5 }, (_, i) => ({ name: `Paid only ${i + 1}`, days: null, work_cents: 0, paid_cents: 100_000, advance_cents: 0 }));
    const text = daySheetMessage({ today: TODAY, projectName: 'S', day: '2026-10-22', rows: [...worker, ...paidOnly] }, 'en');
    expect(text.length).toBeLessThanOrEqual(SHARE_LIMITS.message);
    // the five payments (small lines) went first, so there is no "Other payments" block left
    expect(text).not.toContain('Other payments');
    expect(text).toContain('Paid: Rs 45,000'); // 40 x 1,000 + 5 x 1,000: the cut lines still count in the totals
  });

  it('a statement at its caps with the longest names still fits, with its totals', () => {
    const projects = Array.from({ length: 15 }, (_, i) => ({ name: `${i + 1}. ${wide('Project name', 100)}`, days_total: 3, balance_cents: 100_000 }));
    const recent = Array.from({ length: 5 }, (_, i) => ({ day: '2026-10-22', kind: 'payment' as const, amount_cents: 100_000, project_name: `${i + 1}. ${wide('Project name', 100)}` }));
    const text = workerStatementMessage({ ...statement, projects, recent, recentCount: 30 }, 'en');
    expect(text.length).toBeLessThanOrEqual(SHARE_LIMITS.message);
    expect(text).toContain('Earned: Rs 24,500\nAdvances: Rs 1,000\nPaid: Rs 14,000\nTo pay: Rs 9,500');
    expect(text).toContain('… and 25 more');
  });

  it('a long site note is sent whole up to 2,500 characters and cut with an ellipsis after that; its paragraphs stay', () => {
    const paragraph = 'The shuttering of the east side was inspected. ';
    const body = `${paragraph.repeat(20)}\n\n${paragraph.repeat(20)}`;
    expect(body.length).toBeGreaterThan(1800);
    const text = noteMessage({ ...note, body }, 'en');
    expect(text).toContain(`${paragraph.repeat(20).trim()}\n\n${paragraph.repeat(20).trim()}\n\n${FOOTER.en}`);
    expect(text.length).toBeLessThanOrEqual(SHARE_LIMITS.message);

    const huge = noteMessage({ ...note, body: 'word '.repeat(2000) }, 'en');
    const bodyOnly = huge.split('\n\n')[1];
    expect(bodyOnly.length).toBeLessThanOrEqual(SHARE_LIMITS.noteFull);
    expect(bodyOnly.length).toBeGreaterThan(SHARE_LIMITS.noteFull - 10);
    expect(bodyOnly.endsWith('…')).toBe(true);
    expect(huge.length).toBeLessThanOrEqual(SHARE_LIMITS.message);
  });

  it('a note keeps blank lines between paragraphs but not three in a row, and trims each line', () => {
    const text = noteMessage({ ...note, body: '  First line  \n\n\n\n   Second line\t\r\nThird' }, 'en');
    expect(text).toContain('\n\nFirst line\n\nSecond line\nThird\n\n');
  });
});

// ================================================================ typed text can not break a message

describe('typed text is cleaned', () => {
  it('asterisks are removed everywhere, so the bold title can not be broken', () => {
    const text = projectMessage(
      {
        ...project,
        project: { ...project.project, name: 'Evil *bold* Name**', client: '*Client*', location: 'Lo*cation' },
        notes: [{ day: '2026-10-22', body: 'a *starred* note' }],
        noteCount: 1,
      },
      'en',
    );
    expect(text.split('\n')[0]).toBe('*Evil bold Name*');
    expect(text).toContain('Client: Client\n');
    expect(text).toContain('Location: Location\n');
    expect(text).toContain('22 Oct 2026 — a starred note');
    expect((text.match(/\*/g) ?? []).length).toBe(2);
  });

  it('asterisks and back-ticks are removed in every message and every field', () => {
    const star = (s: string) => `*${s}*\`${s}\``;
    const all = [
      estimateMessage({ ...estimate, estimate: { ...estimate.estimate, number: star('N'), title: star('T'), client_name: star('C'), location: star('L') }, payments: [{ label: star('S'), percent_bp: 10000 }], company: { name: star('Co'), phone: star('P') } }, 'en'),
      daySheetMessage({ ...daySheet, projectName: star('P'), rows: daySheet.rows.map((r) => ({ ...r, name: star(r.name) })) }, 'en'),
      workerStatementMessage({ ...statement, worker: { name: star('W'), trade: star('T'), daily_rate_cents: 1 }, projectName: star('P'), projects: [], recent: [{ day: '2026-10-22', kind: 'payment', amount_cents: 1, project_name: star('X') }] }, 'en'),
      expensesMessage({ ...expenses, projectName: star('P'), rows: [{ day: '2026-10-22', category: star('c'), amount_cents: 1, paid_to: star('s'), project_name: star('P') }] }, 'en'),
      toolsOutMessage({ ...tools, projectName: star('P'), tools: [{ name: star('t'), code: star('c'), with_name: star('w'), since: '2026-10-20', project_name: star('p') }] }, 'en'),
      noteMessage({ ...note, projectName: star('P'), body: `${star('b')}\n${star('b')}` }, 'en'),
    ];
    for (const text of all) {
      expect(text).not.toContain('`');
      const stars = (text.match(/\*/g) ?? []).length;
      expect(stars === 2 || stars === 4).toBe(true); // the title, and for the estimate the TOTAL line
      expect(text.split('\n')[0]).toMatch(/^\*[^*]+\*$/);
    }
    expect(all[0].split('\n').filter((l) => l.startsWith('*'))).toEqual(['*Estimate NN*', '*TOTAL: Rs 1,429,111.11*']);
  });

  it('a name that is only asterisks does not leave an empty bold title', () => {
    expect(projectMessage({ ...project, project: { ...project.project, name: '***' } }, 'en').split('\n')[0]).toBe('*Project*');
    expect(workerStatementMessage({ ...statement, worker: { name: '  ', trade: null, daily_rate_cents: 0 } }, 'en').split('\n')[0]).toBe('*Workers*');
    expect(estimateMessage({ ...estimate, estimate: { ...estimate.estimate, number: '*' } }, 'en').split('\n')[0]).toBe('*Estimate*');
  });

  it('a measurement like 150*150 keeps its meaning', () => {
    expect(singleLine('150*150 mm blocks, 2 * 3 m, a*b')).toBe('150×150 mm blocks, 2×3 m, ab');
    expect(noteMessage({ ...note, body: 'Use 150*150 mm posts' }, 'en')).toContain('Use 150×150 mm posts');
  });

  it('line breaks, tabs and control characters become single spaces in a one-line field', () => {
    expect(singleLine('Kamal\nPerera\r\n\tSilva\u{2028}x')).toBe('Kamal Perera Silva x');
    expect(singleLine('  many    spaces  ')).toBe('many spaces');
    expect(singleLine('bell\u0007here')).toBe('bell here');
    expect(singleLine(null)).toBe('');
    expect(singleLine(undefined)).toBe('');
    expect(singleLine(42)).toBe('');
    expect(singleLine({})).toBe('');
  });

  it('a name with a line break can not push a second line into the message', () => {
    const text = toolsOutMessage({ ...tools, tools: [{ name: 'Drill\nSecond line', code: null, with_name: 'A\r\nB', since: null, project_name: null }] }, 'en');
    expect(text).toContain('Drill Second line — with A B\n');
  });

  it('lone surrogates (a broken emoji) are dropped, so the message can always be turned into a link', () => {
    const text = noteMessage({ ...note, body: 'ok \uD83D broken \uDE00 and fine 😀' }, 'en');
    expect(text).toContain('ok broken and fine 😀');
    expect(() => encodeURIComponent(text)).not.toThrow();
  });

  it('very long names are cut: the title at 100 characters, a name in a list line at 60', () => {
    const long = 'Very long name '.repeat(40);
    const text = projectMessage({ ...project, project: { ...project.project, name: long, client: long, location: long } }, 'en');
    const first = text.split('\n')[0];
    expect(first.length).toBe(1 + 100 + 1);
    expect(first.endsWith('…*')).toBe(true);
    expect(text.split('\n')[1].length).toBe('Client: '.length + 100);
    const ex = expensesMessage({ ...expenses, rows: [{ day: '2026-10-22', category: 'fuel', amount_cents: 100, paid_to: long, project_name: null }], totalCount: 1 }, 'en');
    const line = ex.split('\n').find((l) => l.startsWith('22 Oct 2026')) ?? '';
    expect(line).toBe(`22 Oct 2026 — Fuel — ${long.trim().slice(0, 59).trimEnd()}… — Rs 1`);
    expect(text.length).toBeLessThanOrEqual(SHARE_LIMITS.message);
  });

  it('cutting never splits an emoji or a Sinhala or Tamil letter from its vowel sign or joiner', () => {
    expect(ellipsize('short', 10)).toBe('short');
    expect(ellipsize('😀'.repeat(100), 10)).toBe('😀😀😀😀…');
    expect(ellipsize('කා'.repeat(50), 10)).toBe('කාකාකාකා…'); // a vowel sign stays with its consonant
    expect(ellipsize('கா'.repeat(50), 10)).toBe('காகாகாகா…');
    // a conjunct (consonant, virama, joiner, consonant) is not left hanging on its joiner
    const cut = ellipsize('ක්‍ෂ'.repeat(40), 11);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toMatch(/[\u{200c}\u{200d}]\u{2026}$/u);
    expect(cut.length).toBeLessThanOrEqual(11);
    for (const text of ['කා'.repeat(80), 'கா'.repeat(80), 'ක්‍ෂ'.repeat(80), 'ஸ்ரீ'.repeat(60), '😀a'.repeat(60)]) {
      for (const max of [10, 11, 12, 13, 59, 60, 100]) {
        const out = ellipsize(text, max);
        expect(out.length).toBeLessThanOrEqual(max);
        expect(/[\uD800-\uDFFF]/u.test(out)).toBe(false); // no half of an emoji
        expect(out).not.toMatch(/[\u{200c}\u{200d}]\u{2026}$/u);
      }
    }
  });
});

// ================================================================ messageTitle

describe('messageTitle', () => {
  it('is the first line without its bold marks', () => {
    expect(messageTitle(projectMessage(project, 'en'))).toBe(SCHOOL);
    expect(messageTitle(estimateMessage(estimate, 'si'))).toBe('ඇස්තමේන්තුව EST-2026-014');
    expect(messageTitle('*Title*\nrest')).toBe('Title');
    expect(messageTitle('')).toBe('');
  });
});

// ================================================================ nasty input

/** A small seeded random generator, so a failure can be reproduced. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEXTS: unknown[] = [
  '',
  ' ',
  'Kamal Perera',
  'කමල් පෙරේරා',
  'நிமல் பெரேரா',
  'A*B',
  '***',
  '5*5 plate',
  'two\nlines\r\nhere',
  '\t tabs \t',
  'x'.repeat(250),
  'ක්‍ෂ'.repeat(90),
  'ஸ்ரீ'.repeat(70),
  '😀 emoji site',
  'broken \uD83D half',
  'back`tick',
  'Rs 5 *bold* _it_ ~st~',
  'a: b: c',
  42,
  true,
  {},
  [],
  null,
  undefined,
];
const LONG_TEXTS: unknown[] = ['x'.repeat(250), 'Hydraulic breaker '.repeat(20), 'ක්‍ෂ'.repeat(90), 'ஸ்ரீ'.repeat(70), 'Very long supplier name, Welimada Town '.repeat(8), '😀 long emoji site name '.repeat(12)];
const MONEY: unknown[] = [0, 1, 99, 100, 123_456, 1_850_000_000, -5000, 12.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e300, Number.MAX_SAFE_INTEGER, '1000', null, undefined];
const DAYS: unknown[] = ['2026-10-22', '2026-10-01', '2026-02-30', '2026-13-01', '', 'garbage', null, undefined, 20261022];
const COUNTS: unknown[] = [0, 1, 2, 5, 40, 1000, 1e9, -3, 2.7, Number.NaN, '7', null, undefined];
const DAYS_WORKED: unknown[] = [0.5, 1, 1.5, 2, 0.25, 31, 1e300, -1, 0, Number.NaN, Number.POSITIVE_INFINITY, null, undefined];
const BPS: unknown[] = [0, 1, 1250, 1800, 3000, 10000, 123456789, -5, 2.5, Number.NaN, 1e300, null, undefined];
const CATEGORIES: unknown[] = ['materials', 'transport', 'fuel', 'machinery', 'food', 'tools', 'subcontract', 'utilities', 'other', 'scaffolding', '__proto__', 'constructor', ...TEXTS];
const STATUSES: unknown[] = ['active', 'on_hold', 'completed', 'weird', ...TEXTS];
const WEATHERS: unknown[] = ['sunny', 'cloudy', 'rain', 'snow', ...TEXTS];

describe('nasty input never breaks a message', () => {
  const ITERATIONS = 250;

  /** `heavy`: long names and long lists everywhere, so the length cap has to cut. */
  function make(seed: number, heavy = false) {
    const rnd = random(seed);
    const pick = <T,>(pool: readonly T[]): T => pool[Math.floor(rnd() * pool.length)];
    const text = () => pick(heavy ? LONG_TEXTS : TEXTS);
    const rows = <T,>(make: () => T): unknown => {
      const kind = rnd();
      if (kind < 0.06 && !heavy) return pick([null, undefined, {}, 'rows', 5]);
      const n = heavy ? pick([33, 45, 70, 100]) : pick([0, 0, 1, 2, 3, 5, 12, 33, 45, 70]);
      return Array.from({ length: n }, () => (rnd() < 0.03 && !heavy ? pick([null, undefined, 7, 'x']) : make()));
    };
    const loose = (o: Record<string, unknown>) => (rnd() < 0.05 ? pick([null, undefined, 7, 'x']) : o);

    return {
      project: {
        today: pick(DAYS),
        project: loose({ name: text(), client: text(), location: text(), status: pick(STATUSES), contract_cents: pick(MONEY) }),
        cost: loose({ expense_cents: pick(MONEY), labour_cents: pick(MONEY), labour_paid_cents: pick(MONEY) }),
        categories: rows(() => ({ category: pick(CATEGORIES), cents: pick(MONEY) })),
        workerCount: pick(COUNTS),
        toolsOutCount: pick(COUNTS),
        notes: rows(() => ({ day: pick(DAYS), body: text() })),
        noteCount: pick(COUNTS),
      },
      estimate: {
        today: pick(DAYS),
        estimate: loose({ number: text(), title: text(), client_name: text(), location: text(), issue_day: pick(DAYS), valid_days: pick([30, 1, 365, 0, -4, 1.5, Number.NaN, 1e300, null, undefined]), tax_bp: pick(BPS) }),
        payments: rows(() => ({ label: text(), percent_bp: pick(BPS) })),
        total: loose({ item_count: pick(COUNTS), subtotal_cents: pick(MONEY), discount_cents: pick(MONEY), tax_cents: pick(MONEY), total_cents: pick(MONEY), scheduled_bp: pick(BPS) }),
        company: loose({ name: text(), phone: text() }),
      },
      daySheet: {
        today: pick(DAYS),
        projectName: text(),
        day: pick(DAYS),
        rows: rows(() => ({ name: text(), days: pick(DAYS_WORKED), work_cents: pick(MONEY), paid_cents: pick(MONEY), advance_cents: pick(MONEY) })),
      },
      statement: {
        today: pick(DAYS),
        worker: loose({ name: text(), trade: text(), daily_rate_cents: pick(MONEY) }),
        projectName: text(),
        totals: loose({ earned_cents: pick(MONEY), advance_cents: pick(MONEY), paid_cents: pick(MONEY), balance_cents: pick(MONEY) }),
        projects: rows(() => ({ name: text(), days_total: pick(DAYS_WORKED), balance_cents: pick(MONEY) })),
        recent: rows(() => ({ day: pick(DAYS), kind: pick(['payment', 'advance', 'x', null]), amount_cents: pick(MONEY), project_name: text() })),
        recentCount: pick(COUNTS),
      },
      expenses: {
        today: pick(DAYS),
        projectName: text(),
        rows: rows(() => ({ day: pick(DAYS), category: pick(CATEGORIES), amount_cents: pick(MONEY), paid_to: text(), project_name: text() })),
        totalCents: pick(MONEY),
        totalCount: pick(COUNTS),
      },
      tools: {
        today: pick(DAYS),
        projectName: text(),
        tools: rows(() => ({ name: text(), code: text(), with_name: text(), since: pick(DAYS), project_name: text() })),
      },
      note: { today: pick(DAYS), projectName: text(), day: pick(DAYS), body: text(), weather: pick(WEATHERS) },
    };
  }

  const BUILDERS = {
    project: (i: unknown, l: Lang) => projectMessage(i as ProjectShareInput, l),
    estimate: (i: unknown, l: Lang) => estimateMessage(i as EstimateShareInput, l),
    daySheet: (i: unknown, l: Lang) => daySheetMessage(i as DaySheetShareInput, l),
    statement: (i: unknown, l: Lang) => workerStatementMessage(i as WorkerStatementShareInput, l),
    expenses: (i: unknown, l: Lang) => expensesMessage(i as ExpensesShareInput, l),
    tools: (i: unknown, l: Lang) => toolsOutMessage(i as ToolsOutShareInput, l),
    note: (i: unknown, l: Lang) => noteMessage(i as NoteShareInput, l),
  } as const;

  /** What must hold for any message, whatever it was built from. Returns the first thing that does not. */
  function problem(text: string, kind: keyof typeof BUILDERS, lang: Lang): string | null {
    if (typeof text !== 'string') return 'not a string';
    if (text.length > SHARE_LIMITS.message) return `too long (${text.length})`;
    if (/undefined|null|NaN|Infinity/.test(text)) return 'contains undefined, null, NaN or Infinity';
    if (/\de[+-]?\d/.test(text)) return 'a number in exponent notation';
    if (/Rs -?\d[\d,]*\.\d{3,}/.test(text)) return 'an amount with more than two decimals';
    const all = text.split('\n');
    if (!/^\*[^*\n]+\*$/.test(all[0])) return `the first line is not a bold title: ${all[0]}`;
    const stars = (text.match(/\*/g) ?? []).length;
    if (stars !== (kind === 'estimate' ? 4 : 2)) return `${stars} asterisks`; // the title, and the estimate's TOTAL line
    if (text.includes('`')) return 'a back-tick';
    if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u{2028}\u{2029}]/u.test(text)) return 'a control character';
    if (/[\uD800-\uDFFF]/u.test(text)) return 'a lone surrogate';
    if (/\n\n\n/.test(text) || text.startsWith('\n') || text.endsWith('\n')) return 'blank lines in the wrong place';
    for (const line of all) {
      if (line !== line.trim()) return `an untidy line: "${line}"`;
      if (/:\s*$/.test(line)) return `a label without a value: "${line}"`;
      // a "… and N more" line says how many: a whole number, one or more
      if (line.startsWith('…') && !/^… \S.*[1-9]\d*/.test(line)) return `a "more" line without a number: "${line}"`;
    }
    if (!all[all.length - 1].startsWith(SHARE_LABELS[lang].footer)) return 'the footer is not last';
    try {
      encodeURIComponent(text);
    } catch {
      return 'cannot be encoded as a link';
    }
    return null;
  }

  it.each(LANGS)(`%s: ${ITERATIONS} random inputs for each of the 7 builders give a clean message`, (lang) => {
    const failures: string[] = [];
    for (let seed = 1; seed <= ITERATIONS; seed++) {
      const input = make(seed * 7919 + (lang === 'en' ? 1 : lang === 'si' ? 2 : 3));
      for (const kind of Object.keys(BUILDERS) as (keyof typeof BUILDERS)[]) {
        const data = input[kind];
        let text = '';
        try {
          text = BUILDERS[kind](data, lang);
        } catch (e) {
          failures.push(`${kind} #${seed}: threw ${String(e)}`);
          continue;
        }
        const why = problem(text, kind, lang);
        if (why) failures.push(`${kind} #${seed}: ${why}\n${text.slice(0, 300)}`);
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it.each(LANGS)('%s: with long names and long lists the length cap cuts the lists, and every message is still clean', (lang) => {
    const failures: string[] = [];
    let cut = 0;
    let withMore = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const input = make(seed * 104729 + (lang === 'en' ? 1 : lang === 'si' ? 2 : 3), true);
      for (const kind of Object.keys(BUILDERS) as (keyof typeof BUILDERS)[]) {
        const message = BUILDERS[kind](input[kind], lang);
        const why = problem(message, kind, lang);
        if (why) failures.push(`${kind} #${seed}: ${why}`);
        if (message.length > 3000) cut++;
        if (message.split('\n').some((l) => l.startsWith('…'))) withMore++;
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
    // the run really reached the cap and the "more" lines (the cap is only reachable by three of the seven messages)
    expect(cut).toBeGreaterThan(20);
    expect(withMore).toBeGreaterThan(60);
  });

  it('the builders accept nothing at all, and an unknown language, without printing rubbish', () => {
    for (const kind of Object.keys(BUILDERS) as (keyof typeof BUILDERS)[]) {
      for (const data of [undefined, null, {}, 5, 'text', []]) {
        const text = BUILDERS[kind](data, 'en');
        expect({ kind, why: problem(text, kind, 'en') }).toEqual({ kind, why: null });
      }
      const odd = BUILDERS[kind](make(3)[kind], 'de' as unknown as Lang);
      expect(odd.endsWith('Developed with Bluemoon Site') || odd.includes('Developed with Bluemoon Site · ')).toBe(true);
    }
  });

  it('huge amounts are printed as whole numbers, never as 1e+21', () => {
    const text = projectMessage(
      { ...project, project: { ...project.project, contract_cents: Number.MAX_SAFE_INTEGER }, cost: { expense_cents: Number.MAX_SAFE_INTEGER, labour_cents: Number.MAX_SAFE_INTEGER, labour_paid_cents: 1e300 } },
      'en',
    );
    expect(text).toContain('Contract value: Rs 90,071,992,547,409.91');
    expect(text).toContain('Labour paid: Rs 0');
    expect(text).not.toMatch(/e\+/);
  });
});

// ================================================================ pure

describe('the builders stay pure', () => {
  /** The modules a file imports as values (a type import is gone when the app runs). */
  const importsOf = (file: string) =>
    [...readFileSync(join(__dirname, '..', file), 'utf8').matchAll(/^import (?!type )[\s\S]*?from '([^']+)';/gm)].map((m) => m[1]).sort();

  it('shareText.ts and shareLabels.ts import no database, React, phone or Expo module', () => {
    expect(importsOf('shareText.ts')).toEqual(['./dates', './estimate', './money', './shareLabels']);
    expect(importsOf('shareLabels.ts')).toEqual([]);
  });
});
