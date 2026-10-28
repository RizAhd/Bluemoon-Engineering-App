/**
 * The printable project report as HTML, for expo-print. Pure: everything it needs is passed in,
 * so it can be unit tested and printed by any Chromium for a visual check.
 *
 * Page margins: a single outer table puts a spacer in its <thead> and <tfoot>. Browsers repeat
 * those on every printed page, which gives every page the same top and bottom margin on every
 * print engine, whether or not it honours @page margins. @page itself is set to 0 so nothing is
 * counted twice. Left and right margins are padding.
 *
 * Two layouts:
 *  - plain: logo and date on the first page, 16 mm margins
 *  - letterhead: the company letterhead supplies the logo and contact details, so the report
 *    starts with the title block and keeps clear of the header block, border and bottom band
 *    (see LETTERHEAD_MARGIN_MM)
 */
import type { Expense, Project, ProjectCost, SiteNote, Tool, ToolMovement, WageEntry } from '@/db/types';
import type { TKey } from '@/i18n';

import { LOGO_ASPECT, LOGO_DATA_URI } from './brandLogo';
import { formatDay } from './dates';
import { LETTERHEAD_MARGIN_MM, PLAIN_MARGIN_MM } from './letterhead';
import { formatLKR } from './money';
import { fill } from './shareLabels';
import { isSinglePiece, qtyText } from './toolStock';

type Row = Record<string, string | number | null>;

export interface ReportTables {
  expenses?: Row[];
  wage_entries?: Row[];
  tool_movements?: Row[];
  site_notes?: Row[];
  workers?: Row[];
  tools?: Row[];
}

export interface ReportInput {
  project: Project;
  tables: ReportTables;
  cost: ProjectCost | null;
  photoCount: number;
  skippedPhotos: number;
  letterhead: boolean;
  /** Translate a key into the user's language (not yet HTML-escaped). */
  t: (key: TKey) => string;
  /** Local calendar day printed on the report, "YYYY-MM-DD". */
  day: string;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string);
}

/** Printed beside the logo on plain reports (the letterhead already carries these). */
const COMPANY = {
  address: 'Ambagaha Kumbura, Silmiyapura, Welimada, Badulla',
  phone: '077 337 0056',
  email: 'bluemoonengi@gmail.com',
  reg: 'Reg. No. PV 00232701',
};

const NAVY = '#253046';
const BLUE = '#1D4ED8';

interface Col {
  label: string;
  /** Right-aligned numeric column. */
  num?: boolean;
  width?: string;
}

function table(cols: Col[], rows: string[][], cls = ''): string {
  const head = cols
    .map((c) => `<th class="${c.num ? 'n' : ''}"${c.width ? ` style="width:${c.width}"` : ''}>${c.label}</th>`)
    .join('');
  const body = rows.map((r) => `<tr>${r.map((cell, i) => `<td class="${cols[i]?.num ? 'n' : ''}">${cell}</td>`).join('')}</tr>`).join('');
  return `<table class="data ${cls}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function buildReportHtml(input: ReportInput): string {
  const { project: p, tables, cost, photoCount, skippedPhotos, letterhead, day } = input;
  const t = (k: TKey) => esc(input.t(k));
  const live = <T extends { deleted_at: string | null }>(rows: unknown[] | undefined) => ((rows ?? []) as T[]).filter((r) => !r.deleted_at);

  const expenses = live<Expense>(tables.expenses).sort((a, b) => a.day.localeCompare(b.day));
  const wages = live<WageEntry>(tables.wage_entries);
  const moves = live<ToolMovement>(tables.tool_movements).sort((a, b) => a.day.localeCompare(b.day));
  const notes = live<SiteNote>(tables.site_notes).sort((a, b) => a.day.localeCompare(b.day));
  const workerName = new Map(((tables.workers ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));
  // A bundle made before quantities existed has no count columns: every such tool and movement is one piece.
  const tools = new Map(
    ((tables.tools ?? []) as unknown as Partial<Tool>[]).map((r) => [
      String(r.id),
      { name: r.name ?? '', quantity_milli: r.quantity_milli ?? 1000, unit: r.unit ?? null, is_material: r.is_material ?? 0 },
    ]),
  );
  const toolName = (id: string) => tools.get(id)?.name ?? '';
  const toolUnit = (id: string) => tools.get(id)?.unit ?? null;

  const byCat = new Map<string, number>();
  expenses.forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount_cents));

  const byWorker = new Map<string, { work: number; given: number; days: number }>();
  wages.forEach((w) => {
    const r = byWorker.get(w.worker_id) ?? { work: 0, given: 0, days: 0 };
    if (w.kind === 'work') {
      r.work += w.amount_cents;
      r.days += w.days ?? 0;
    } else r.given += w.amount_cents;
    byWorker.set(w.worker_id, r);
  });

  const total = (cost?.expense_cents ?? 0) + (cost?.labour_cents ?? 0);
  const m = letterhead ? LETTERHEAD_MARGIN_MM : PLAIN_MARGIN_MM;
  const subtitle = [p.client, p.location].filter(Boolean).map(esc).join(' · ');
  const logoH = 22; // mm: the logo is a stacked lockup, so it needs height for its lettering to read
  const logoW = (logoH * LOGO_ASPECT).toFixed(1);

  const header = letterhead
    ? `<div class="title">
         <h1>${esc(p.name)}</h1>
         ${subtitle ? `<div class="muted">${subtitle}</div>` : ''}
         <div class="muted small">${t('costSummary')} · ${esc(formatDay(day))}</div>
       </div>`
    : `<div class="brand">
         <img src="${LOGO_DATA_URI}" style="height:${logoH}mm;width:${logoW}mm" alt="Bluemoon Engineering (Pvt) Ltd">
         <div class="muted small right">
           ${esc(COMPANY.address)}<br>${esc(COMPANY.phone)} · ${esc(COMPANY.email)}<br>${esc(COMPANY.reg)}<br>
           <b class="date">${t('costSummary')} · ${esc(formatDay(day))}</b>
         </div>
       </div>
       <div class="title">
         <h1>${esc(p.name)}</h1>
         ${subtitle ? `<div class="muted">${subtitle}</div>` : ''}
       </div>`;

  const boxes = [
    [t('totalCost'), formatLKR(total)],
    [t('materialsAndOther'), formatLKR(cost?.expense_cents ?? 0)],
    [t('labour'), formatLKR(cost?.labour_cents ?? 0)],
    ...(p.contract_cents ? [[t('contract'), formatLKR(p.contract_cents)]] : []),
  ]
    .map(([label, value]) => `<div class="box"><span class="muted small">${label}</span><b class="n">${esc(value)}</b></div>`)
    .join('');

  const sections: string[] = [];

  sections.push(`<h2>${t('byCategory')}</h2>`);
  sections.push(
    table(
      [{ label: t('category') }, { label: t('amount'), num: true, width: '34%' }],
      // wages are part of the total cost too, so they get their own row beside the expense categories (as on the project screen)
      [
        ...[...byCat.entries()].map(([c, v]) => [t(`cat_${c}` as TKey), v] as const),
        ...((cost?.labour_cents ?? 0) > 0 ? [[t('wages'), cost?.labour_cents ?? 0] as const] : []),
      ]
        .sort((a, b) => b[1] - a[1])
        .map(([label, v]) => [label, esc(formatLKR(v))]),
    ),
  );

  sections.push(`<h2>${t('expenses')} <span class="count">${expenses.length}</span></h2>`);
  sections.push(
    table(
      [
        { label: t('date'), width: '16%' },
        { label: t('category'), width: '17%' },
        { label: t('paidTo') },
        { label: t('method'), width: '11%' },
        { label: t('amount'), num: true, width: '19%' },
      ],
      expenses.map((e) => [
        esc(formatDay(e.day)),
        t(`cat_${e.category}` as TKey),
        `${esc(e.paid_to ?? '')}${e.note ? `<div class="muted small">${esc(e.note)}</div>` : ''}`,
        t(`method_${e.method}` as TKey),
        esc(formatLKR(e.amount_cents)),
      ]),
    ),
  );

  if (byWorker.size) {
    sections.push(`<h2>${t('workers')} <span class="count">${byWorker.size}</span></h2>`);
    sections.push(
      table(
        [
          { label: t('name') },
          { label: t('days'), num: true, width: '14%' },
          { label: t('earned'), num: true, width: '24%' },
          { label: t('paid'), num: true, width: '24%' },
        ],
        [...byWorker.entries()].map(([id, r]) => [esc(workerName.get(id) ?? ''), String(r.days), esc(formatLKR(r.work)), esc(formatLKR(r.given))]),
      ),
    );
  }

  if (moves.length) {
    sections.push(`<h2>${t('tools')} <span class="count">${moves.length}</span></h2>`);
    // What is left of each tool with several pieces ("Ladder: 2 of 4 in store") and each material ("Cement: 80 bags left"),
    // from the whole history the bundle carries. A single piece has nothing to add: the table says where it is.
    const outOf = new Map<string, number>();
    moves.forEach((mv) => outOf.set(mv.tool_id, (outOf.get(mv.tool_id) ?? 0) + (mv.kind === 'issue' ? 1 : -1) * (mv.qty_milli ?? 1000)));
    const stock = [...tools.entries()]
      .filter(([id, tl]) => !isSinglePiece(tl) && outOf.has(id))
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, tl]) => {
        const left = Math.max(0, tl.quantity_milli - (outOf.get(id) ?? 0));
        const line = tl.is_material
          ? fill(t('leftCount'), { n: esc(qtyText(left, tl.unit)) })
          : fill(t('inStoreOf'), { n: esc(qtyText(left)), total: esc(qtyText(tl.quantity_milli, tl.unit)) });
        return `<div>${esc(tl.name)}: ${line}</div>`;
      });
    if (stock.length) sections.push(`<div class="stock">${stock.join('')}</div>`);
    sections.push(
      table(
        [
          { label: t('date'), width: '16%' },
          { label: t('tool') },
          { label: '', width: '13%' },
          { label: t('quantity'), num: true, width: '13%' },
          { label: t('takenBy'), width: '26%' },
        ],
        moves.map((mv) => [
          esc(formatDay(mv.day)),
          esc(toolName(mv.tool_id)),
          t(mv.kind === 'issue' ? 'issue' : 'return'),
          esc(qtyText(mv.qty_milli ?? 1000, toolUnit(mv.tool_id))),
          esc(mv.worker_id ? (workerName.get(mv.worker_id) ?? '') : (mv.taken_by ?? '')),
        ]),
      ),
    );
  }

  if (notes.length) {
    sections.push(`<h2>${t('siteNotes')} <span class="count">${notes.length}</span></h2>`);
    sections.push(
      `<table class="data notes"><tbody>${notes
        .map((n) => `<tr><td class="when">${esc(formatDay(n.day))}</td><td>${esc(n.body)}</td></tr>`)
        .join('')}</tbody></table>`,
    );
  }

  const photoLine = `${photoCount} photos${skippedPhotos ? ` (${skippedPhotos} more not included)` : ''} · Made with the Bluemoon Engineering site app. Open this PDF in the app (Import PDF) to load all records.`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.name)}</title><style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body { font-family: 'Noto Sans', 'Noto Sans Sinhala', 'Noto Sans Tamil', Roboto, 'Segoe UI', 'Nirmala UI', sans-serif;
         color: #101828; font-size: 10pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table.frame { width: 100%; border-collapse: collapse; }
  table.frame > thead { display: table-header-group; }
  table.frame > tfoot { display: table-footer-group; }
  table.frame > thead > tr > td, table.frame > tfoot > tr > td, table.frame > tbody > tr > td { padding: 0; border: 0; }
  .spacer-top { height: ${m.top}mm; }
  .spacer-bottom { height: ${m.bottom}mm; }
  .page { padding: 0 ${m.right}mm 0 ${m.left}mm; }
  .brand { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 4mm; border-bottom: 1.2pt solid ${NAVY}; margin-bottom: 5mm; }
  .title h1 { margin: 0; font-size: 19pt; line-height: 1.25; color: ${NAVY}; font-weight: 700; }
  .title { margin-bottom: 5mm; ${letterhead ? `padding-bottom: 3mm; border-bottom: 1.2pt solid ${NAVY};` : ''} }
  .muted { color: #475467; }
  .small { font-size: 8.5pt; }
  .right { text-align: right; line-height: 1.45; }
  .right .date { color: #344054; font-weight: 700; display: inline-block; margin-top: 1mm; }
  .grid { display: flex; gap: 3mm; margin: 0 0 2mm; }
  .box { flex: 1; border: 0.75pt solid #D0D5DD; border-radius: 2mm; padding: 2.5mm 3mm; break-inside: avoid; page-break-inside: avoid; }
  .box span { display: block; }
  .box b { display: block; font-size: 12.5pt; color: ${NAVY}; font-weight: 700; }
  h2 { font-size: 11.5pt; margin: 7mm 0 2mm; color: ${NAVY}; font-weight: 700; break-after: avoid; page-break-after: avoid; }
  h2 .count { font-weight: 600; font-size: 9pt; color: #475467; background: #EAECF0; border-radius: 3mm; padding: 0.3mm 2mm; margin-left: 1mm; }
  table.data { width: 100%; border-collapse: collapse; }
  table.data thead { display: table-header-group; }
  table.data th { text-align: left; font-size: 8.5pt; font-weight: 700; color: #344054; background: #F2F4F7; padding: 1.6mm 2mm; border-bottom: 0.75pt solid #98A2B3; }
  table.data td { padding: 1.6mm 2mm; border-bottom: 0.5pt solid #E4E7EC; vertical-align: top; }
  table.data tr { break-inside: avoid; page-break-inside: avoid; }
  table.data .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .stock { margin: 0 0 2mm; font-size: 9pt; color: #344054; font-variant-numeric: tabular-nums; }
  table.notes td.when { width: 22%; color: #475467; white-space: nowrap; }
  table.notes td { white-space: pre-wrap; }
  .foot { margin-top: 8mm; font-size: 8pt; color: #667085; }
  b.n, .box b { font-variant-numeric: tabular-nums; }
  .accent { color: ${BLUE}; }
  </style></head><body>
  <table class="frame">
    <thead><tr><td><div class="spacer-top"></div></td></tr></thead>
    <tfoot><tr><td><div class="spacer-bottom"></div></td></tr></tfoot>
    <tbody><tr><td><div class="page">
      ${header}
      <div class="grid">${boxes}</div>
      ${sections.join('\n      ')}
      <div class="foot">${esc(photoLine)}</div>
    </div></td></tr></tbody>
  </table>
  </body></html>`;
}
