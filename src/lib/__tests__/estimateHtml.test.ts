/**
 * The estimate (quotation) as HTML: what it prints and what it leaves out, for each language and
 * both layouts. buildEstimateHtml does no money arithmetic, so every amount below is checked to be
 * printed exactly as it was supplied (the same numbers the database view reports).
 */
import type { CompanyProfile, Estimate, EstimateItem, EstimatePayment, EstimateTotal } from '@/db/types';
import type { Lang } from '@/i18n';
import { LOGO_DATA_URI } from '@/lib/brandLogo';
import { allocatePayments, estimateSums, formatQty, lineAmount, validUntil } from '@/lib/estimate';
import { buildEstimateHtml, type EstimateHtmlInput } from '@/lib/estimateHtml';
import { ESTIMATE_LABELS, estimateLabels, fillLabel, type EstimateLabelKey } from '@/lib/estimateLabels';
import { LETTERHEAD_MARGIN_MM, PLAIN_MARGIN_MM } from '@/lib/letterhead';
import { formatLKR } from '@/lib/money';

const base = { created_at: '2026-10-22T00:00:00.000Z', updated_at: '2026-10-22T00:00:00.000Z', deleted_at: null, version: 1, device_id: 'd' };

const COMPANY: CompanyProfile = {
  name: 'Bluemoon Engineering (Pvt) Ltd',
  reg_no: 'PV 00232701',
  address: 'Ambagaha Kumbura, Silmiyapura, Welimada, Badulla',
  phone: '077 337 0056',
  email: 'bluemoonengi@gmail.com',
  bank_name: "People's Bank",
  account_name: 'Bluemoon Engineering (Pvt) Ltd',
  account_no: '123-1-001-4-0098765',
  branch: 'Welimada',
  default_terms: '',
  default_valid_days: 30,
};

function item(i: number, over: Partial<EstimateItem> = {}): EstimateItem {
  return {
    ...base,
    id: `i${i}`,
    estimate_id: 'e1',
    position: i,
    description: `Item ${i}`,
    unit: 'm²',
    qty_milli: 12_500,
    rate_cents: 1_250_050,
    ...over,
  };
}

function stage(i: number, label: string, bp: number): EstimatePayment {
  return { ...base, id: `p${i}`, estimate_id: 'e1', position: i, label, percent_bp: bp };
}

const STANDARD = [stage(1, 'Advance', 3000), stage(2, 'Progress payment', 4000), stage(3, 'On completion', 3000)];

interface Opts {
  items?: EstimateItem[];
  payments?: EstimatePayment[];
  estimate?: Partial<Estimate>;
  company?: Partial<CompanyProfile>;
  lang?: Lang;
  letterhead?: boolean;
  discount?: number;
  taxBp?: number;
}

/** A complete input the way estimatePdf.ts makes it (real helpers), with every optional part filled unless overridden. */
function input(o: Opts = {}): EstimateHtmlInput {
  const items = o.items ?? [item(1), item(2, { description: 'Second item', qty_milli: 3000, rate_cents: 8_500_000 })];
  const payments = o.payments ?? STANDARD;
  const discount = o.discount ?? 0;
  const taxBp = o.taxBp ?? 0;
  const sums = estimateSums(items, discount, taxBp);
  const total: EstimateTotal = {
    estimate_id: 'e1',
    item_count: items.length,
    ...sums,
    scheduled_bp: payments.reduce((a, p) => a + p.percent_bp, 0),
  };
  const estimate: Estimate = {
    ...base,
    id: 'e1',
    number: 'EST-2026-014',
    client_name: 'Mr. K. A. Perera',
    client_phone: '071 234 5678',
    client_address: '45/2, Temple Road\nBadulla',
    title: 'Boundary wall and gate',
    location: 'Welimada, Badulla',
    issue_day: '2026-10-22',
    valid_days: 30,
    discount_cents: discount,
    tax_bp: taxBp,
    status: 'draft',
    terms: '1. Prices are valid for 30 days.\n2. Payment within 7 days.',
    notes: 'Rates exclude VAT.',
    project_id: null,
    ...o.estimate,
  };
  return {
    estimate,
    items,
    payments,
    total,
    company: { ...COMPANY, ...o.company },
    lang: o.lang ?? 'en',
    letterhead: o.letterhead ?? false,
    lines: items.map((it) => ({ qty: formatQty(it.qty_milli), amountCents: lineAmount(it.qty_milli, it.rate_cents) })),
    scheduleCents: allocatePayments(
      total.total_cents,
      payments.map((p) => p.percent_bp),
    ),
    validUntil: validUntil(estimate.issue_day, estimate.valid_days),
    day: '2026-10-22',
  };
}

const html = (o: Opts = {}) => buildEstimateHtml(input(o));

/** The inner HTML of the first element with this class (a table, div ...), for focused assertions. */
function block(source: string, tag: string, cls: string): string {
  const m = new RegExp(`<${tag} class="${cls}[^"]*">([\\s\\S]*?)</${tag}>`).exec(source);
  return m ? m[1].replace(/>\s+</g, '><') : '';
}

/** Visible text: tags removed, entities kept, whitespace squeezed. */
function text(source: string): string {
  return source
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('what the estimate prints', () => {
  it('prints the header, parties, items, totals, words, schedule, bank, terms, notes, signatures and footer', () => {
    const out = html({ discount: 1_000_000, taxBp: 1800 });
    const t = text(out);
    expect(out).toContain('<title>ESTIMATE EST-2026-014 · Mr. K. A. Perera</title>');
    expect(t).toContain('ESTIMATE');
    expect(t).toContain('Estimate No. EST-2026-014');
    expect(t).toContain('Date 22 Oct 2026');
    expect(t).toContain('Valid until 21 Nov 2026');
    expect(t).toContain('Prepared for Mr. K. A. Perera');
    expect(t).toContain('Tel: 071 234 5678');
    expect(t).toContain('45/2, Temple Road');
    expect(t).toContain('Project Boundary wall and gate');
    expect(t).toContain('Site: Welimada, Badulla');
    for (const heading of ['No.', 'Description', 'Unit', 'Qty', 'Rate (LKR)', 'Amount (LKR)']) expect(t).toContain(heading);
    expect(t).toContain('Second item');
    expect(t).toContain('Amount in words');
    expect(t).toContain('Payment schedule');
    expect(t).toContain('Advance');
    expect(t).toContain('Payment details');
    expect(t).toContain("People's Bank");
    expect(t).toContain('123-1-001-4-0098765');
    expect(t).toContain('Terms and conditions');
    expect(t).toContain('Payment within 7 days.');
    expect(t).toContain('Notes Rates exclude VAT.');
    expect(t).toContain('Authorised signature');
    expect(t).toContain('Accepted by client (name, signature, date)');
    expect(t).toContain('Prices are in Sri Lankan Rupees (LKR). Valid until 21 Nov 2026.');
    expect(t).toContain('Printed 22 Oct 2026');
  });

  it('prints items numbered from 1 in the order given, with the supplied quantity text and unit', () => {
    const items = [item(1, { description: 'Excavation', unit: 'm³', qty_milli: 12_500 }), item(2, { description: 'Door', unit: 'nos', qty_milli: 3000 }), item(3, { description: 'Lump sum item', unit: null })];
    const out = html({ items });
    const rows = [...out.matchAll(/<td class="no">(\d+)<\/td>\s*<td class="desc">([^<]*)<\/td>\s*<td class="unit">([^<]*)<\/td>\s*<td class="n">([^<]*)<\/td>/g)];
    expect(rows.map((r) => r.slice(1))).toEqual([
      ['1', 'Excavation', 'm³', '12.5'],
      ['2', 'Door', 'nos', '3'],
      ['3', 'Lump sum item', '', '12.5'],
    ]);
  });

  it('prints every amount with two decimals, so a column lines up', () => {
    const out = html({ items: [item(1, { qty_milli: 1000, rate_cents: 100_000 }), item(2, { qty_milli: 1000, rate_cents: 123_456 })] });
    expect(out).toContain('<td class="n">1,000.00</td>');
    expect(out).toContain('<td class="n">1,234.56</td>');
    expect(block(out, 'table', 'totals')).toContain('Rs 2,234.56');
  });
});

describe('totals, words and schedule are printed exactly as supplied', () => {
  it('prints the subtotal, discount, tax and total of the view, not a recalculation', () => {
    const base0 = input({ discount: 1, taxBp: 1800 });
    // Deliberately not what the lines add up to: the PDF must print the numbers it was given.
    const supplied: EstimateHtmlInput = {
      ...base0,
      total: { ...base0.total, subtotal_cents: 987_654_321, discount_cents: 1_234_500, tax_cents: 55_555, total_cents: 111_222_333, scheduled_bp: 10_000 },
    };
    const totals = block(buildEstimateHtml(supplied), 'table', 'totals');
    expect(totals).toContain('Rs 9,876,543.21');
    expect(totals).toContain('− Rs 12,345.00');
    expect(totals).toContain('Rs 555.55');
    expect(totals).toContain('<td>Total (LKR)</td><td class="n">Rs 1,112,223.33</td>');
    expect(totals.indexOf('Subtotal')).toBeLessThan(totals.indexOf('Discount'));
    expect(totals.indexOf('Discount')).toBeLessThan(totals.indexOf('Tax'));
    expect(totals.indexOf('Tax')).toBeLessThan(totals.indexOf('Total (LKR)'));
  });

  it('writes the supplied total in English words, with cents', () => {
    const base0 = input();
    const out = buildEstimateHtml({ ...base0, total: { ...base0.total, total_cents: 12_500_050 } });
    expect(out).toContain('Rupees One Hundred and Twenty-Five Thousand and Fifty Cents Only');
    const whole = buildEstimateHtml({ ...base0, total: { ...base0.total, total_cents: 12_500_000 } });
    expect(whole).toContain('Rupees One Hundred and Twenty-Five Thousand Only');
  });

  it('prints each line amount as supplied, even when it differs from quantity times rate', () => {
    const base0 = input({ items: [item(1)] });
    const out = buildEstimateHtml({ ...base0, lines: [{ qty: '12.5', amountCents: 424_242 }] });
    const rows = block(out, 'table', 'items');
    expect(rows).toContain('<td class="n">4,242.42</td>');
    expect(rows).not.toContain('156,256.25');
  });

  it('prints each schedule amount and percentage as supplied, and the scheduled total', () => {
    const base0 = input({ payments: [stage(1, 'Advance', 3000), stage(2, 'Progress', 1250), stage(3, 'Last', 5)] });
    const out = buildEstimateHtml({ ...base0, scheduleCents: [111, 22_222, 3_333_333] });
    const sched = block(out, 'div', 'block sched');
    expect(sched).toContain('<td class="n">30%</td><td class="n">1.11</td>');
    expect(sched).toContain('<td class="n">12.5%</td><td class="n">222.22</td>');
    expect(sched).toContain('<td class="n">0.05%</td><td class="n">33,333.33</td>');
    // total row: the scheduled share of the view and the sum of the supplied amounts
    expect(sched).toContain('<td class="n">42.55%</td><td class="n">33,556.66</td>');
  });

  it('allocates a schedule that adds up to the total to the cent when the real helper supplies it', () => {
    const items = [item(1, { qty_milli: 1000, rate_cents: 10_000_001 })];
    const out = html({ items, payments: [stage(1, 'A', 3333), stage(2, 'B', 3333), stage(3, 'C', 3334)] });
    const total = estimateSums(items, 0, 0).total_cents;
    const parts = allocatePayments(total, [3333, 3333, 3334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    const sched = block(out, 'div', 'block sched');
    for (const cents of parts) expect(sched).toContain(`${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>`);
    expect(sched).toContain('100%');
    expect(sched).not.toContain('not scheduled');
  });

  it('prints percentages with up to two decimals', () => {
    const out = html({ taxBp: 1805, payments: [stage(1, 'A', 1250)] });
    expect(out).toContain('Tax (18.05%)');
    expect(out).toContain('12.5%');
    expect(html({ taxBp: 1 })).toContain('Tax (0.01%)');
    expect(html({ taxBp: 1800 })).toContain('Tax (18%)');
  });

  it('notes when the stages do not add up to 100 %, with the missing share', () => {
    const under = html({ payments: [stage(1, 'Advance', 3000), stage(2, 'Progress', 4000)] });
    expect(under).toContain('30% of the total is not scheduled yet.');
    const underFraction = html({ payments: [stage(1, 'Advance', 3333)] });
    expect(underFraction).toContain('66.67% of the total is not scheduled yet.');
    const over = html({ payments: [stage(1, 'A', 6000), stage(2, 'B', 5000)] });
    expect(over).toContain('The stages add up to 110% of the total.');
    expect(html({ payments: STANDARD })).not.toContain('not scheduled');
    expect(html({ payments: STANDARD })).not.toContain('The stages add up');
  });
});

describe('empty optional parts are left out cleanly', () => {
  const none = {
    estimate: { client_phone: null, client_address: null, location: null, terms: null, notes: null },
    company: { bank_name: '', account_name: '', account_no: '', branch: '' },
    payments: [] as EstimatePayment[],
  };

  it('omits discount and tax rows when there is none, and shows them when there is', () => {
    const plain = block(html(), 'table', 'totals');
    expect(plain).not.toContain('Discount');
    expect(plain).not.toContain('Tax');
    const both = block(html({ discount: 500_000, taxBp: 1800 }), 'table', 'totals');
    expect(both).toContain('Discount');
    expect(both).toContain('Tax (18%)');
    expect(block(html({ discount: 500_000 }), 'table', 'totals')).not.toContain('Tax');
    expect(block(html({ taxBp: 1800 }), 'table', 'totals')).not.toContain('Discount');
  });

  it('omits the payment schedule, bank block, terms, notes, phone, address and location when empty', () => {
    const out = html(none);
    const t = text(out);
    for (const gone of ['Payment schedule', 'Payment details', 'Terms and conditions', 'Notes', 'Tel:', 'Site:', 'Bank', 'Account']) expect(t).not.toContain(gone);
    expect(out).not.toContain('class="duo"');
    expect(out).not.toContain('class="prosebox');
    // the client and project are still there
    expect(t).toContain('Mr. K. A. Perera');
    expect(t).toContain('Boundary wall and gate');
  });

  it('treats blank and whitespace-only text like empty', () => {
    const out = html({
      estimate: { client_phone: '   ', client_address: '\n \n', location: ' ', terms: '  \n ', notes: '\t' },
      company: { bank_name: ' ', account_name: '', account_no: '  ', branch: '' },
      payments: [],
    });
    const t = text(out);
    for (const gone of ['Payment details', 'Terms and conditions', 'Notes', 'Tel:', 'Site:']) expect(t).not.toContain(gone);
  });

  it('prints only the filled bank lines', () => {
    const out = html({ company: { bank_name: 'Sampath Bank', account_name: '', account_no: '0012345', branch: '' }, payments: [] });
    const kv = block(out, 'table', 'kv');
    expect(kv).toContain('Bank');
    expect(kv).toContain('Sampath Bank');
    expect(kv).toContain('Account number');
    expect(kv).toContain('0012345');
    expect(kv).not.toContain('Account name');
    expect(kv).not.toContain('Branch');
    expect(kv.match(/<tr>/g)).toHaveLength(2);
  });

  it('prints only the schedule when there is no bank block, and only the bank block when there is no schedule', () => {
    const scheduleOnly = html({ company: none.company });
    expect(scheduleOnly).toContain('Payment schedule');
    expect(scheduleOnly).not.toContain('Payment details');
    const bankOnly = html({ payments: [] });
    expect(bankOnly).toContain('Payment details');
    expect(bankOnly).not.toContain('Payment schedule');
  });

  it('prints terms without notes, and notes without terms', () => {
    const termsOnly = html({ estimate: { notes: null } });
    expect(termsOnly).toContain('Terms and conditions');
    expect(termsOnly).not.toContain('>Notes<');
    const notesOnly = html({ estimate: { terms: null } });
    expect(notesOnly).toContain('>Notes<');
    expect(notesOnly).not.toContain('Terms and conditions');
  });

  it('omits the company lines that are empty and the signature caption of an unnamed company', () => {
    const out = html({ company: { phone: '', email: '', reg_no: '', name: '', address: '' } });
    expect(out).not.toContain('Reg. No.');
    expect(out).not.toContain('class="muted small right"');
    expect(out).not.toContain('class="sub"');
    const partial = html({ company: { phone: '', email: 'a@b.lk' } });
    expect(partial).toContain('a@b.lk');
    expect(partial).not.toContain(' · a@b.lk');
    expect(partial).not.toContain('a@b.lk ·');
  });

  it('has no empty lines, "undefined", "null" or "NaN" in any combination of parts', () => {
    const variants: Opts[] = [
      {},
      none,
      { ...none, items: [item(1)] },
      { items: [], payments: [] },
      { discount: 100, taxBp: 1, estimate: { client_address: '' } },
      { lang: 'si', ...none },
      { lang: 'ta', letterhead: true },
    ];
    for (const v of variants) {
      const out = html(v);
      expect(out).not.toMatch(/undefined|NaN|\bnull\b/);
      expect(out).not.toMatch(/<div class="line[^"]*">\s*<\/div>/);
      expect(out).not.toMatch(/<td class="(desc|unit)"><\/td>\s*<td class="n">undefined/);
    }
  });

  it('survives an estimate with no items (a zero total) and still prints the total and the words', () => {
    const out = html({ items: [], payments: [], estimate: { terms: null, notes: null } });
    expect(out).not.toContain('<table class="items">');
    expect(out).toContain('Rs 0.00');
    expect(out).toContain('Rupees Zero Only');
  });

  it('does not print "undefined" when a line is missing from the supplied lines', () => {
    const base0 = input({ items: [item(1), item(2)] });
    const out = buildEstimateHtml({ ...base0, lines: [base0.lines[0]], scheduleCents: [] });
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('NaN');
  });
});

describe('escaping', () => {
  const evil = '<img src=x onerror=alert(1)> & "quoted" <b>bold</b>';
  const evilEscaped = '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot; &lt;b&gt;bold&lt;/b&gt;';

  it('escapes everything the user typed, wherever it is printed', () => {
    const out = html({
      items: [item(1, { description: evil, unit: evil })],
      payments: [stage(1, evil, 10_000)],
      estimate: { number: evil, client_name: evil, client_phone: evil, client_address: evil, title: evil, location: evil, terms: evil, notes: evil },
      company: { name: evil, reg_no: evil, address: evil, phone: evil, email: evil, bank_name: evil, account_name: evil, account_no: evil, branch: evil },
    });
    expect(out).not.toContain('<img src=x');
    expect(out).not.toContain('<b>bold</b>');
    expect(out).not.toContain('onerror=alert(1)>');
    // the logo is the only picture
    expect(out.match(/<img /g)).toHaveLength(1);
    // once per place it appears: number (title + meta), client (title + party), phone, address, project title, site,
    // item description and unit, stage label, terms, notes, company name (alt + signature), reg, address, phone/email, four bank lines
    expect(out.split(evilEscaped).length - 1).toBeGreaterThanOrEqual(18);
    expect(out).toContain('alt="&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot;');
  });

  it('keeps Sinhala and Tamil text exactly as typed', () => {
    const out = html({
      items: [item(1, { description: 'සිමෙන්ති බදාම ගෑම', unit: 'මීටර්' }), item(2, { description: 'கான்கிரீட் தரை அமைத்தல்', unit: 'சதுர மீ' })],
      estimate: { client_name: 'කමල් පෙරේරා', title: 'ශ්‍රී ලංකා පාසල', location: 'வெலிமடை' },
    });
    for (const s of ['සිමෙන්ති බදාම ගෑම', 'මීටර්', 'கான்கிரீட் தரை அமைத்தல்', 'சதுர மீ', 'කමල් පෙරේරා', 'ශ්‍රී ලංකා පාසල', 'வெலிமடை']) expect(out).toContain(s);
  });

  it('keeps the line breaks of descriptions, addresses, terms and notes (printed with white-space: pre-line)', () => {
    const out = html({
      items: [item(1, { description: 'Line one\nLine two' })],
      estimate: { client_address: 'No 1\r\nMain St', terms: 'A\n\nB', notes: 'N1\nN2' },
    });
    expect(out).toContain('Line one\nLine two');
    expect(out).toContain('No 1\nMain St');
    expect(out).toContain('A\n\nB');
    expect(out).toContain('N1\nN2');
    expect(out).toMatch(/\.prose \{[^}]*white-space: pre-line/);
    expect(out).toMatch(/\.pre \{ white-space: pre-line/);
    expect(out).toMatch(/table\.items td\.desc \{[^}]*white-space: pre-line/);
  });
});

describe('languages', () => {
  const langs: Lang[] = ['en', 'si', 'ta'];

  it.each(langs)('%s: every fixed label comes from the label table, in that language', (lang) => {
    const L = estimateLabels(lang);
    const out = html({ lang, discount: 100, taxBp: 1800, payments: [stage(1, 'Advance', 3000)] });
    const t = text(out);
    expect(out).toContain(`<html lang="${lang}">`);
    expect(out).toContain(`<body class="l-${lang}">`);
    for (const key of ['title', 'estimateNo', 'date', 'validUntil', 'preparedFor', 'project', 'tel', 'site', 'colNo', 'colDescription', 'colUnit', 'colQty', 'colRate', 'colAmount', 'subtotal', 'discount', 'tax', 'total', 'amountInWords', 'paymentSchedule', 'colStage', 'paymentDetails', 'bankName', 'accountName', 'accountNo', 'branch', 'terms', 'notes', 'authorisedSignature', 'acceptedByClient', 'printed'] as EstimateLabelKey[]) {
      expect(t).toContain(L[key]);
    }
    expect(t).toContain(fillLabel(L.footer, { date: '21 Nov 2026' }));
  });

  it('prints the labels of the other languages nowhere', () => {
    const si = text(html({ lang: 'si' }));
    const ta = text(html({ lang: 'ta' }));
    for (const gone of ['Prepared for', 'Description', 'Payment schedule', 'Terms and conditions', 'Authorised signature', 'Amount in words']) {
      expect(si).not.toContain(gone);
      expect(ta).not.toContain(gone);
    }
    expect(si).toContain('ඇස්තමේන්තුව');
    expect(ta).toContain('மதிப்பீடு');
    expect(text(html({ lang: 'en' }))).not.toContain('ඇස්තමේන්තුව');
  });

  it('keeps the amount in words in English and the figures in Western digits in every language', () => {
    for (const lang of langs) {
      const out = html({ lang, items: [item(1, { qty_milli: 1000, rate_cents: 12_500_050 })], payments: [] });
      expect(out).toContain('Rupees One Hundred and Twenty-Five Thousand and Fifty Cents Only');
      expect(out).toContain('Rs 125,000.50');
    }
  });

  it('applies no letter-spacing to Sinhala or Tamil (only the English capitals are spaced)', () => {
    for (const lang of langs) {
      const css = /<style>([\s\S]*?)<\/style>/.exec(html({ lang }))?.[1] ?? '';
      const spaced = [...css.matchAll(/([^{}]+)\{[^}]*letter-spacing[^}]*\}/g)].map((m) => m[1].trim());
      expect(spaced.length).toBeGreaterThan(0);
      for (const selector of spaced) expect(selector).toMatch(/^\.l-en /); // rules that only apply under body.l-en
    }
    expect(html({ lang: 'si' })).not.toContain('class="l-en"');
    expect(html({ lang: 'si' })).toContain('<body class="l-si">');
  });

  it('uses the report font stack (Noto Sinhala and Tamil, Nirmala) and the same line height', () => {
    const out = html({ lang: 'si' });
    expect(out).toContain("font-family: 'Noto Sans', 'Noto Sans Sinhala', 'Noto Sans Tamil', Roboto, 'Segoe UI', 'Nirmala UI', sans-serif");
    expect(out).toMatch(/body \{[^}]*line-height: 1\.5/);
    expect(out).not.toMatch(/text-transform: uppercase[^}]*\}[^{]*\.l-si/);
  });

  it('falls back to English for an unknown language', () => {
    expect(text(html({ lang: 'xx' as Lang }))).toContain('Prepared for');
  });
});

describe('estimate labels', () => {
  const keys = Object.keys(ESTIMATE_LABELS.en) as EstimateLabelKey[];

  it('every language has every key, filled in', () => {
    for (const lang of ['en', 'si', 'ta'] as Lang[]) {
      expect(Object.keys(ESTIMATE_LABELS[lang]).sort()).toEqual([...keys].sort());
      for (const key of keys) expect(ESTIMATE_LABELS[lang][key].trim()).not.toBe('');
    }
  });

  it('Sinhala and Tamil are translated, not copies of the English text (apart from units like (LKR) and %)', () => {
    for (const lang of ['si', 'ta'] as Lang[]) {
      for (const key of keys) {
        if (key === 'colPercent') continue;
        expect(ESTIMATE_LABELS[lang][key]).not.toBe(ESTIMATE_LABELS.en[key]);
      }
    }
  });

  it('keeps the same placeholders in every language', () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of keys) {
      for (const lang of ['si', 'ta'] as Lang[]) expect(holes(ESTIMATE_LABELS[lang][key])).toEqual(holes(ESTIMATE_LABELS.en[key]));
    }
    expect(holes(ESTIMATE_LABELS.en.footer)).toEqual(['date']);
    expect(holes(ESTIMATE_LABELS.en.scheduleShort)).toEqual(['pct']);
  });

  it('fillLabel fills known placeholders and leaves unknown ones', () => {
    expect(fillLabel('Valid until {date} ({pct}%)', { date: '1 Jan 2027', pct: 30 })).toBe('Valid until 1 Jan 2027 (30%)');
    expect(fillLabel('A {x} B', {})).toBe('A {x} B');
  });
});

describe('layouts', () => {
  it('plain: logo and company details on the page, 16 mm margins', () => {
    const out = html({ letterhead: false });
    expect(out).toContain(LOGO_DATA_URI);
    expect(out).toContain('Ambagaha Kumbura, Silmiyapura, Welimada, Badulla');
    expect(out).toContain('077 337 0056 · bluemoonengi@gmail.com');
    expect(out).toContain('Reg. No. PV 00232701');
    expect(out).toContain(`.spacer-top { height: ${PLAIN_MARGIN_MM.top}mm; }`);
    expect(out).toContain(`.spacer-bottom { height: ${PLAIN_MARGIN_MM.bottom}mm; }`);
    expect(out).toContain(`padding: 0 ${PLAIN_MARGIN_MM.right}mm 0 ${PLAIN_MARGIN_MM.left}mm`);
  });

  it('plain: prints the company details of the profile, in the language of the labels', () => {
    const out = html({ letterhead: false, company: { reg_no: 'PV 1', address: 'No 5, Main Road', phone: '011 222 3333', email: '' }, lang: 'si' });
    expect(out).toContain('No 5, Main Road');
    expect(out).toContain('011 222 3333');
    expect(out).toContain('ලියාපදිංචි අංකය PV 1');
  });

  it('letterhead: nothing of its own at the top (the letterhead has logo and contacts), 64 / 20 / 16 mm margins', () => {
    const out = html({ letterhead: true });
    expect(out).not.toContain(LOGO_DATA_URI);
    expect(out).not.toContain('<img');
    expect(out).not.toContain('Reg. No.');
    expect(out).not.toContain('Ambagaha Kumbura');
    expect(out).not.toContain('class="brand"');
    expect(LETTERHEAD_MARGIN_MM).toEqual({ top: 64, right: 16, bottom: 20, left: 16 });
    expect(out).toContain('.spacer-top { height: 64mm; }');
    expect(out).toContain('.spacer-bottom { height: 20mm; }');
    expect(out).toContain('padding: 0 16mm 0 16mm');
    // the same content as the plain layout
    expect(text(out)).toContain('Prepared for Mr. K. A. Perera');
    expect(text(out)).toContain('Authorised signature');
  });

  it('both layouts repeat the margin spacers on every page and set @page margin to zero', () => {
    for (const letterhead of [false, true]) {
      const out = html({ letterhead });
      expect(out).toContain('@page { size: A4; margin: 0; }');
      expect(out).toContain('<thead><tr><td><div class="spacer-top">');
      expect(out).toContain('<tfoot><tr><td><div class="spacer-bottom">');
      expect(out).toMatch(/table\.frame > thead \{ display: table-header-group; \}/);
      expect(out).toMatch(/table\.frame > tfoot \{ display: table-footer-group; \}/);
    }
  });
});

describe('long and short estimates', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1, { description: `Work item number ${i + 1} with a reasonably long description of the work` }));

  it('60 items: 60 numbered rows in order, one table, header row repeated, no row split', () => {
    const out = html({ items: many(60) });
    expect(out.match(/<table class="items">/g)).toHaveLength(1);
    const numbers = [...out.matchAll(/<td class="no">(\d+)<\/td>\s*<td class="desc">/g)].map((m) => Number(m[1]));
    expect(numbers).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(block(out, 'table', 'items').match(/<thead>/g)).toHaveLength(1);
    expect(out).toMatch(/table\.items thead \{ display: table-header-group; \}/);
    expect(out).toMatch(/table\.items tr \{ break-inside: avoid; page-break-inside: avoid; \}/);
    expect(out).toMatch(/table\.plain tr \{ break-inside: avoid; page-break-inside: avoid; \}/);
    expect(block(out, 'table', 'totals')).toContain(formatLKR(estimateSums(many(60), 0, 0).subtotal_cents, { forceDecimals: true }));
  });

  it('keeps the totals, payment blocks, signature block, footer and party boxes in one piece, and headings with what follows', () => {
    const out = html();
    for (const cls of ['summary', 'duo', 'sign', 'foot', 'party']) {
      expect(out).toMatch(new RegExp(`\\.${cls} \\{[^}]*break-inside: avoid; page-break-inside: avoid;`));
    }
    expect(out).toMatch(/h2 \{[^}]*break-after: avoid; page-break-after: avoid;/);
    // the last text block travels with the signature block, so signatures never stand alone
    expect(out).toMatch(/\.prosebox\.keepnext \{ break-after: avoid; page-break-after: avoid; \}/);
    expect(out).toMatch(/\.sign \{[^}]*break-after: avoid;/);
    expect(out.match(/class="prosebox keepnext"/g)).toHaveLength(1);
    expect(out.indexOf('Terms and conditions')).toBeLessThan(out.indexOf('class="prosebox keepnext"'));
  });

  it('marks the last of the terms and notes blocks to keep with the signatures', () => {
    expect(html({ estimate: { notes: null } })).toMatch(/class="prosebox keepnext"><h2>Terms and conditions/);
    expect(html({ estimate: { terms: null } })).toMatch(/class="prosebox keepnext"><h2>Notes/);
    expect(html()).toMatch(/class="prosebox"><h2>Terms and conditions/);
    expect(html({ estimate: { terms: null, notes: null } })).not.toContain('keepnext"');
  });

  it('right-aligns the numeric columns with tabular figures', () => {
    const out = html();
    expect(out).toContain('<th class="n">Qty</th>');
    expect(out).toContain('<th class="n">Rate (LKR)</th>');
    expect(out).toContain('<th class="n">Amount (LKR)</th>');
    expect(out).toMatch(/table\.items \.n, table\.plain \.n \{ text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; \}/);
    expect(out).toMatch(/table\.totals td\.n \{ text-align: right; font-variant-numeric: tabular-nums;/);
  });

  it('prints one line for a one-line estimate, and builds 200 items quickly', () => {
    const one = html({ items: [item(1)], payments: [], estimate: { terms: null, notes: null } });
    expect(one.match(/<td class="no">1<\/td>/g)).toHaveLength(1);
    const started = Date.now();
    const big = html({ items: many(200) });
    expect(big.match(/<td class="desc">/g)).toHaveLength(200);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
