/**
 * The printable estimate (quotation) as HTML, for expo-print. Pure: everything it prints is passed
 * in (quantities as text, amounts as cents), so it runs on Node for tests and in any Chromium for
 * a visual check, and it never does money arithmetic of its own.
 *
 * Page engine: the same as reportHtml.ts. One outer table puts a spacer in its <thead> and
 * <tfoot>; browsers repeat those on every printed page, which gives every page the same top and
 * bottom margin whether or not the print engine honours @page margins (so @page margin is 0).
 * Left and right margins are padding.
 *
 * Two layouts, like the project report:
 *  - plain: logo and company details at the top of the first page, 16 mm margins
 *  - letterhead: the letterhead picture supplies logo and contact details, so the page starts with
 *    the title block and stays inside LETTERHEAD_MARGIN_MM
 *
 * Page flow: the items table repeats its header row on every page and never splits a row; the
 * totals, payment blocks and signature block each stay in one piece.
 */
import type { CompanyProfile, Estimate, EstimateItem, EstimatePayment, EstimateTotal } from '@/db/types';
import type { Lang } from '@/i18n';

import { LOGO_ASPECT, LOGO_DATA_URI } from './brandLogo';
import { formatDay } from './dates';
import { estimateLabels, fillLabel } from './estimateLabels';
import { LETTERHEAD_MARGIN_MM, PLAIN_MARGIN_MM } from './letterhead';
import { formatAmount, formatLKR } from './money';
import { amountInWords } from './numberToWords';
import { esc } from './reportHtml';

/** What is printed for one item beside its description and rate. */
export interface EstimateLine {
  /** The quantity as shown ("12.5", "3"), from formatQty. */
  qty: string;
  /** The line amount in cents, from lineAmount. */
  amountCents: number;
}

export interface EstimateHtmlInput {
  estimate: Estimate;
  items: EstimateItem[];
  payments: EstimatePayment[];
  /** From v_estimate_total; printed exactly as it is. */
  total: EstimateTotal;
  company: CompanyProfile;
  lang: Lang;
  letterhead: boolean;
  /** One entry per item, same order as `items`. */
  lines: EstimateLine[];
  /** Amount in cents of each payment stage, same order as `payments` (allocatePayments). */
  scheduleCents: number[];
  /** Last day the estimate stands, "YYYY-MM-DD" (validUntil). */
  validUntil: string;
  /** Local calendar day the PDF is made, "YYYY-MM-DD". */
  day: string;
}

const NAVY = '#253046';
const BLUE = '#1D4ED8';

/** Summary block: "Rs 1,250.00". Always two decimals, so amounts line up and nothing looks rounded. */
const money = (cents: number) => formatLKR(cents, { forceDecimals: true });
/** Table cells: "1,250.00"; the column header says (LKR). */
const figure = (cents: number) => formatAmount(cents, { forceDecimals: true });

/** Basis points as a percentage with up to 2 decimals: 1800 -> "18", 1250 -> "12.5", 5 -> "0.05". */
function percentText(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (!frac) return String(whole);
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** Trimmed text, or '' for null, undefined and blank. */
function clean(s: string | null | undefined): string {
  return (s ?? '').trim();
}

/** User text with line breaks kept (the CSS uses white-space: pre-line). */
function multiline(s: string): string {
  return esc(s.replace(/\r\n?/g, '\n'));
}

function wordsOf(cents: number): string {
  try {
    return amountInWords(cents);
  } catch {
    return '';
  }
}

export function buildEstimateHtml(input: EstimateHtmlInput): string {
  const { estimate: e, items, payments, total, company, lang, letterhead, lines, scheduleCents } = input;
  const L = estimateLabels(lang);
  const t = (key: keyof typeof L) => esc(L[key]);
  const m = letterhead ? LETTERHEAD_MARGIN_MM : PLAIN_MARGIN_MM;

  const logoH = 20; // mm: the logo is a stacked lockup, so it needs height for its lettering to read
  const logoW = (logoH * LOGO_ASPECT).toFixed(1);

  // ---- header
  // Plain layout only: address, "phone · email", registration number; whatever is empty is left out.
  const regNo = clean(company.reg_no);
  const contact = [clean(company.address), [clean(company.phone), clean(company.email)].filter(Boolean).join(' · '), regNo ? `${L.regNo} ${regNo}` : '']
    .filter(Boolean)
    .map((line) => esc(line))
    .join('<br>');

  const brand = letterhead
    ? ''
    : `<div class="brand">
         <img src="${LOGO_DATA_URI}" style="height:${logoH}mm;width:${logoW}mm" alt="${esc(clean(company.name) || 'Bluemoon Engineering')}">
         ${contact ? `<div class="muted small right">${contact}</div>` : ''}
       </div>`;

  const metaRows = [
    [t('estimateNo'), esc(e.number)],
    [t('date'), esc(formatDay(e.issue_day))],
    [t('validUntil'), esc(formatDay(input.validUntil))],
  ]
    .map(([k, v]) => `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`)
    .join('');

  const head = `<div class="head">
       <h1>${t('title')}</h1>
       <table class="meta">${metaRows}</table>
     </div>`;

  // ---- client and project
  const phone = clean(e.client_phone);
  const address = clean(e.client_address);
  const location = clean(e.location);
  const client = `<div class="party">
         <div class="lbl">${t('preparedFor')}</div>
         <div class="name">${esc(e.client_name)}</div>
         ${phone ? `<div class="line">${t('tel')}: <span class="num">${esc(phone)}</span></div>` : ''}
         ${address ? `<div class="line pre">${multiline(address)}</div>` : ''}
       </div>`;
  const project = `<div class="party">
         <div class="lbl">${t('project')}</div>
         <div class="name">${esc(e.title)}</div>
         ${location ? `<div class="line">${t('site')}: ${esc(location)}</div>` : ''}
       </div>`;

  // ---- items
  const itemRows = items
    .map((it, i) => {
      const line = lines[i];
      return `<tr>
        <td class="no">${i + 1}</td>
        <td class="desc">${multiline(it.description)}</td>
        <td class="unit">${esc(clean(it.unit))}</td>
        <td class="n">${esc(line?.qty ?? '')}</td>
        <td class="n">${esc(figure(it.rate_cents))}</td>
        <td class="n">${esc(line ? figure(line.amountCents) : '')}</td>
      </tr>`;
    })
    .join('');
  const itemsTable = items.length
    ? `<table class="items">
         <thead><tr>
           <th class="no">${t('colNo')}</th><th>${t('colDescription')}</th><th>${t('colUnit')}</th>
           <th class="n">${t('colQty')}</th><th class="n">${t('colRate')}</th><th class="n">${t('colAmount')}</th>
         </tr></thead>
         <tbody>${itemRows}</tbody>
       </table>`
    : '';

  // ---- totals and amount in words
  const taxLabel = `${t('tax')} (${esc(percentText(e.tax_bp))}%)`;
  const totalRows = [
    `<tr><td>${t('subtotal')}</td><td class="n">${esc(money(total.subtotal_cents))}</td></tr>`,
    total.discount_cents > 0 ? `<tr><td>${t('discount')}</td><td class="n">− ${esc(money(total.discount_cents))}</td></tr>` : '',
    e.tax_bp > 0 ? `<tr><td>${taxLabel}</td><td class="n">${esc(money(total.tax_cents))}</td></tr>` : '',
    `<tr class="grand"><td>${t('total')}</td><td class="n">${esc(money(total.total_cents))}</td></tr>`,
  ].join('');
  const words = wordsOf(total.total_cents);
  const summary = `<div class="summary">
       <div class="words">${words ? `<div class="lbl">${t('amountInWords')}</div><div class="wordtext">${esc(words)}</div>` : ''}</div>
       <table class="totals">${totalRows}</table>
     </div>`;

  // ---- payment schedule
  const scheduled = scheduleCents.reduce((a, b) => a + b, 0);
  let scheduleBlock = '';
  if (payments.length) {
    const rows = payments
      .map(
        (p, i) => `<tr>
          <td class="no">${i + 1}</td>
          <td>${esc(p.label)}</td>
          <td class="n">${esc(percentText(p.percent_bp))}%</td>
          <td class="n">${esc(figure(scheduleCents[i] ?? 0))}</td>
        </tr>`,
      )
      .join('');
    const sumRow =
      payments.length > 1
        ? `<tr class="sum"><td></td><td>${t('scheduledTotal')}</td><td class="n">${esc(percentText(total.scheduled_bp))}%</td><td class="n">${esc(figure(scheduled))}</td></tr>`
        : '';
    let note = '';
    if (total.scheduled_bp < 10000) note = fillLabel(L.scheduleShort, { pct: percentText(10000 - total.scheduled_bp) });
    else if (total.scheduled_bp > 10000) note = fillLabel(L.scheduleOver, { pct: percentText(total.scheduled_bp) });
    scheduleBlock = `<div class="block sched">
         <h2>${t('paymentSchedule')}</h2>
         <table class="plain">
           <thead><tr><th class="no">${t('colNo')}</th><th>${t('colStage')}</th><th class="n">${t('colPercent')}</th><th class="n">${t('colAmount')}</th></tr></thead>
           <tbody>${rows}${sumRow}</tbody>
         </table>
         ${note ? `<div class="note">${esc(note)}</div>` : ''}
       </div>`;
  }

  // ---- payment details (only the filled lines)
  const bankLines = [
    [t('bankName'), clean(company.bank_name)],
    [t('accountName'), clean(company.account_name)],
    [t('accountNo'), clean(company.account_no)],
    [t('branch'), clean(company.branch)],
  ].filter(([, v]) => v);
  const bankBlock = bankLines.length
    ? `<div class="block bank">
         <h2>${t('paymentDetails')}</h2>
         <table class="kv">${bankLines.map(([k, v]) => `<tr><td class="k">${k}</td><td class="v">${esc(v)}</td></tr>`).join('')}</table>
       </div>`
    : '';
  const payRow = scheduleBlock || bankBlock ? `<div class="duo">${scheduleBlock}${bankBlock}</div>` : '';

  // ---- terms and notes
  const terms = clean(e.terms);
  const notes = clean(e.notes);
  // The last text block is kept with the signature block, so signatures never sit alone on a page.
  const proseBlocks = [terms ? ([t('terms'), terms] as const) : null, notes ? ([t('notes'), notes] as const) : null].filter((b) => b != null);
  const textBlocks = proseBlocks
    .map(([label, text], i) => `<div class="prosebox${i === proseBlocks.length - 1 ? ' keepnext' : ''}"><h2>${label}</h2><div class="prose">${multiline(text)}</div></div>`)
    .join('');

  // ---- signatures and footer
  const companyName = clean(company.name);
  const signatures = `<div class="sign">
       <div class="sig"><div class="space"></div><div class="rule"></div><div class="cap">${t('authorisedSignature')}</div>${companyName ? `<div class="sub">${esc(companyName)}</div>` : ''}</div>
       <div class="sig"><div class="space"></div><div class="rule"></div><div class="cap">${t('acceptedByClient')}</div></div>
     </div>`;
  const footer = `<div class="foot"><span>${esc(fillLabel(L.footer, { date: formatDay(input.validUntil) }))}</span><span class="printed">${t('printed')} ${esc(formatDay(input.day))}</span></div>`;

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(`${L.title} ${e.number} · ${e.client_name}`)}</title><style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body { font-family: 'Noto Sans', 'Noto Sans Sinhala', 'Noto Sans Tamil', Roboto, 'Segoe UI', 'Nirmala UI', sans-serif;
         color: #101828; font-size: 9.5pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table.frame { width: 100%; border-collapse: collapse; }
  table.frame > thead { display: table-header-group; }
  table.frame > tfoot { display: table-footer-group; }
  table.frame > thead > tr > td, table.frame > tfoot > tr > td, table.frame > tbody > tr > td { padding: 0; border: 0; }
  .spacer-top { height: ${m.top}mm; }
  .spacer-bottom { height: ${m.bottom}mm; }
  .page { padding: 0 ${m.right}mm 0 ${m.left}mm; }
  .muted { color: #475467; }
  .small { font-size: 8.5pt; }
  .right { text-align: right; line-height: 1.5; }
  .num { font-variant-numeric: tabular-nums; }
  .pre { white-space: pre-line; }

  .brand { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 4mm; border-bottom: 1.2pt solid ${NAVY}; margin-bottom: 7mm; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; margin: 0 0 6mm; ${letterhead ? `padding-bottom: 4mm; border-bottom: 1.2pt solid ${NAVY};` : ''} }
  .head h1 { margin: 0; font-size: 24pt; line-height: 1.3; color: ${NAVY}; font-weight: 700; }
  .head h1::after { content: ''; display: block; width: 16mm; height: 1.6mm; margin-top: 2mm; background: ${BLUE}; border-radius: 1mm; }
  .l-en .head h1 { letter-spacing: 0.14em; }
  table.meta { border-collapse: collapse; }
  table.meta td { padding: 0.7mm 0; vertical-align: top; }
  table.meta td.k { color: #667085; font-size: 8.5pt; padding-right: 6mm; }
  table.meta td.v { font-weight: 700; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; color: #101828; }

  .lbl { font-size: 8pt; font-weight: 700; color: #667085; margin-bottom: 0.8mm; }
  .l-en .lbl { text-transform: uppercase; letter-spacing: 0.08em; }

  .parties { display: flex; gap: 4mm; margin: 0 0 6mm; }
  .party { flex: 1; min-width: 0; border: 0.75pt solid #D0D5DD; border-radius: 2mm; padding: 3mm 4mm; break-inside: avoid; page-break-inside: avoid; overflow-wrap: anywhere; }
  .party .name { font-size: 11pt; font-weight: 700; color: ${NAVY}; line-height: 1.4; }
  .party .line { color: #344054; font-size: 9pt; margin-top: 0.4mm; }

  table.items { width: 100%; border-collapse: collapse; margin: 0 0 5mm; }
  table.items thead { display: table-header-group; }
  table.items th { text-align: left; font-size: 8.5pt; font-weight: 700; color: ${NAVY}; background: #F2F4F7; padding: 2mm 2mm; border-top: 1.2pt solid ${NAVY}; border-bottom: 0.75pt solid #98A2B3; }
  table.items td { padding: 2mm 2mm; border-bottom: 0.5pt solid #E4E7EC; vertical-align: top; font-size: 9pt; }
  table.items tbody tr:last-child td { border-bottom: 0.75pt solid ${NAVY}; }
  table.items tr { break-inside: avoid; page-break-inside: avoid; }
  table.items .no { width: 9mm; color: #667085; text-align: left; }
  table.items td.desc { overflow-wrap: anywhere; white-space: pre-line; }
  table.items td.unit { white-space: nowrap; color: #344054; }
  table.items .n, table.plain .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.items th.n { width: 1%; }

  .summary { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; margin: 0 0 7mm; break-inside: avoid; page-break-inside: avoid; }
  .words { flex: 1; min-width: 0; padding-top: 1mm; }
  .wordtext { font-size: 10pt; font-weight: 700; color: ${NAVY}; line-height: 1.5; overflow-wrap: anywhere; }
  table.totals { width: 82mm; flex: none; border-collapse: collapse; }
  table.totals td { padding: 1.4mm 2mm; border-bottom: 0.5pt solid #E4E7EC; color: #344054; }
  table.totals td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; color: #101828; }
  table.totals tr.grand td { border-top: 1.2pt solid ${NAVY}; border-bottom: 1.2pt solid ${NAVY}; background: #EEF3FD; color: ${NAVY}; font-weight: 700; font-size: 11pt; padding: 2.2mm 2mm; }
  table.totals tr.grand td.n { color: ${NAVY}; }

  h2 { font-size: 10pt; margin: 0 0 2mm; padding-bottom: 1.2mm; color: ${NAVY}; font-weight: 700; border-bottom: 0.75pt solid #98A2B3; break-after: avoid; page-break-after: avoid; }
  .duo { display: flex; align-items: flex-start; gap: 9mm; margin: 0 0 7mm; break-inside: avoid; page-break-inside: avoid; }
  .block { flex: 1; min-width: 0; }
  .block.sched { flex: 1.45; }
  table.plain { width: 100%; border-collapse: collapse; }
  table.plain th { text-align: left; font-size: 8pt; font-weight: 700; color: #667085; padding: 1mm 2mm; border-bottom: 0.5pt solid #E4E7EC; }
  table.plain td { padding: 1.4mm 2mm; border-bottom: 0.5pt solid #E4E7EC; vertical-align: top; overflow-wrap: anywhere; }
  table.plain .no { width: 8mm; color: #667085; }
  table.plain tr.sum td { font-weight: 700; color: ${NAVY}; border-bottom: 0; border-top: 0.75pt solid ${NAVY}; }
  table.plain tr { break-inside: avoid; page-break-inside: avoid; }
  .note { margin-top: 2mm; font-size: 8.5pt; color: #B54708; background: #FFFAEB; border-left: 2pt solid #F79009; padding: 1.2mm 2.5mm; }
  table.kv { width: 100%; border-collapse: collapse; }
  table.kv td { padding: 1.1mm 0; vertical-align: top; overflow-wrap: anywhere; }
  table.kv td.k { color: #667085; font-size: 8.5pt; width: 1%; white-space: nowrap; padding-right: 4mm; }
  table.kv td.v { font-weight: 700; color: #101828; font-variant-numeric: tabular-nums; }

  .prosebox { margin: 0 0 6mm; }
  .prosebox.keepnext { break-after: avoid; page-break-after: avoid; }
  .prose { white-space: pre-line; overflow-wrap: anywhere; font-size: 9pt; color: #344054; orphans: 3; widows: 3; }

  .sign { display: flex; gap: 14mm; margin: 9mm 0 0; break-inside: avoid; page-break-inside: avoid; break-after: avoid; page-break-after: avoid; }
  .sig { flex: 1; min-width: 0; }
  .sig .space { height: 17mm; }
  .sig .rule { border-top: 0.75pt solid #475467; }
  .sig .cap { font-size: 8.5pt; color: #344054; font-weight: 600; padding-top: 1.2mm; }
  .sig .sub { font-size: 8pt; color: #667085; }

  .foot { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 1mm 6mm; margin-top: 9mm; padding-top: 2mm; border-top: 0.5pt solid #D0D5DD; font-size: 8pt; color: #667085; break-inside: avoid; page-break-inside: avoid; }
  </style></head><body class="l-${lang}">
  <table class="frame">
    <thead><tr><td><div class="spacer-top"></div></td></tr></thead>
    <tfoot><tr><td><div class="spacer-bottom"></div></td></tr></tfoot>
    <tbody><tr><td><div class="page">
      ${brand}
      ${head}
      <div class="parties">${client}${project}</div>
      ${itemsTable}
      ${summary}
      ${payRow}
      ${textBlocks}
      ${signatures}
      ${footer}
    </div></td></tr></tbody>
  </table>
  </body></html>`;
}
