/**
 * What every printable list shares: the page frame, the header and the hand-off to the phone.
 *
 * The HTML side (`pageHtml`, `table`, `esc`) is pure, so the builders in src/lib/reports/ run on
 * Node for tests and in any Chromium for a visual check. The page engine is the one of the project
 * report (reportHtml.ts) and the estimate (estimateHtml.ts): one outer table puts a spacer in its
 * <thead> and <tfoot>, which browsers repeat on every printed page, so every page gets the same top
 * and bottom margin on every print engine; @page itself is 0 so nothing is counted twice.
 *
 * Two layouts, like those two:
 *  - plain: the logo and the company details on the first page, 16 mm margins
 *  - letterhead: the letterhead picture carries the logo and contact details, so the page starts with
 *    the title block and stays inside LETTERHEAD_MARGIN_MM
 *
 * `exportHtmlPdf` is the export half: expo-print renders the HTML on A4, the letterhead is applied
 * (optional, with the same fallback as the estimate: a picture that cannot be read or used gives a
 * plain PDF and a notice), and the file is written to the cache, ready for expo-sharing. These PDFs
 * carry no embedded data: they are for reading, not for Import PDF.
 */
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';

import { reportError } from '@/lib/errors';

import { LOGO_ASPECT, LOGO_DATA_URI } from './brandLogo';
import { A4_H, A4_W, applyLetterhead, LETTERHEAD_MARGIN_MM, PLAIN_MARGIN_MM } from './letterhead';
import { loadLetterhead } from './pdf';
import { printedPdfBytes } from './printBytes';
import { COMPANY, esc, table, type Col } from './reportHtml';

export { COMPANY, esc, table, type Col };

const NAVY = '#253046';
const BLUE = '#1D4ED8';

export interface PageInput {
  /** The big title: a worker's name, "Expenses", a project's name (plain text, escaped here). */
  title: string;
  /** Under the title: client and location, a project's name, the day (plain text). */
  subtitle?: string;
  /** What the page is and when it was printed: "Statement · 22 Oct 2026" (plain text). */
  kicker: string;
  letterhead: boolean;
  /** The language of the labels, for the html tag. */
  lang?: string;
  /** The body: sections made with `h2`, `table`, `boxes` (already HTML). */
  body: string;
  /** The last line of the page (plain text). */
  footer: string;
}

/** A section heading with an optional count badge, as in the project report. */
export function h2(label: string, count?: number): string {
  return `<h2>${label}${count == null ? '' : ` <span class="count">${count}</span>`}</h2>`;
}

/** The row of headline boxes (label over value) under the header. */
export function boxes(items: [label: string, value: string][]): string {
  if (!items.length) return '';
  return `<div class="grid">${items.map(([label, value]) => `<div class="box"><span class="muted small">${label}</span><b class="n">${value}</b></div>`).join('')}</div>`;
}

/** One line of "Label: value" pairs, for the filters an expense list was made with. */
export function metaLine(pairs: [label: string, value: string][]): string {
  if (!pairs.length) return '';
  return `<div class="meta">${pairs.map(([k, v]) => `<span><span class="muted">${k}:</span> ${v}</span>`).join('')}</div>`;
}

/** Two signature lines at the end of a sheet. */
export function signatures(captions: string[]): string {
  return `<div class="sign">${captions.map((cap) => `<div class="sig"><div class="space"></div><div class="rule"></div><div class="cap">${cap}</div></div>`).join('')}</div>`;
}

/** A plain line of text in a section (an empty list, a remark). */
export function remark(text: string): string {
  return `<div class="muted remark">${text}</div>`;
}

/** The whole page around `body`. Everything in `input` apart from `body` is plain text and escaped here. */
export function pageHtml(input: PageInput): string {
  const { letterhead, body } = input;
  const m = letterhead ? LETTERHEAD_MARGIN_MM : PLAIN_MARGIN_MM;
  const logoH = 22; // mm: the logo is a stacked lockup, so it needs height for its lettering to read
  const logoW = (logoH * LOGO_ASPECT).toFixed(1);
  const subtitle = input.subtitle ? `<div class="muted">${esc(input.subtitle)}</div>` : '';

  const header = letterhead
    ? `<div class="title">
         <h1>${esc(input.title)}</h1>
         ${subtitle}
         <div class="muted small">${esc(input.kicker)}</div>
       </div>`
    : `<div class="brand">
         <img src="${LOGO_DATA_URI}" style="height:${logoH}mm;width:${logoW}mm" alt="Bluemoon Engineering (Pvt) Ltd">
         <div class="muted small right">
           ${esc(COMPANY.address)}<br>${esc(COMPANY.phone)} · ${esc(COMPANY.email)}<br>${esc(COMPANY.reg)}<br>
           <b class="date">${esc(input.kicker)}</b>
         </div>
       </div>
       <div class="title">
         <h1>${esc(input.title)}</h1>
         ${subtitle}
       </div>`;

  return `<!doctype html><html${input.lang ? ` lang="${esc(input.lang)}"` : ''}><head><meta charset="utf-8"><title>${esc(input.title)}</title><style>
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
  .title h1 { margin: 0; font-size: 19pt; line-height: 1.25; color: ${NAVY}; font-weight: 700; overflow-wrap: anywhere; }
  .title { margin-bottom: 5mm; ${letterhead ? `padding-bottom: 3mm; border-bottom: 1.2pt solid ${NAVY};` : ''} }
  .muted { color: #475467; }
  .small { font-size: 8.5pt; }
  .right { text-align: right; line-height: 1.45; }
  .right .date { color: #344054; font-weight: 700; display: inline-block; margin-top: 1mm; }
  .grid { display: flex; flex-wrap: wrap; gap: 3mm; margin: 0 0 2mm; }
  .box { flex: 1; min-width: 30mm; border: 0.75pt solid #D0D5DD; border-radius: 2mm; padding: 2.5mm 3mm; break-inside: avoid; page-break-inside: avoid; }
  .box span { display: block; }
  .box b { display: block; font-size: 12.5pt; color: ${NAVY}; font-weight: 700; }
  .meta { display: flex; flex-wrap: wrap; gap: 1mm 6mm; margin: 2mm 0 0; font-size: 9pt; }
  h2 { font-size: 11.5pt; margin: 7mm 0 2mm; color: ${NAVY}; font-weight: 700; break-after: avoid; page-break-after: avoid; }
  h2 .count { font-weight: 600; font-size: 9pt; color: #475467; background: #EAECF0; border-radius: 3mm; padding: 0.3mm 2mm; margin-left: 1mm; }
  table.data { width: 100%; border-collapse: collapse; }
  table.data thead { display: table-header-group; }
  table.data th { text-align: left; font-size: 8.5pt; font-weight: 700; color: #344054; background: #F2F4F7; padding: 1.6mm 2mm; border-bottom: 0.75pt solid #98A2B3; }
  table.data td { padding: 1.6mm 2mm; border-bottom: 0.5pt solid #E4E7EC; vertical-align: top; overflow-wrap: anywhere; }
  table.data tr { break-inside: avoid; page-break-inside: avoid; }
  table.data .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.data tr.total td { font-weight: 700; color: ${NAVY}; border-top: 1.2pt solid ${NAVY}; border-bottom: 0; background: #EEF3FD; }
  table.data td.pre { white-space: pre-wrap; }
  table.data td.when { color: #475467; white-space: nowrap; }
  .tag { display: inline-block; font-size: 8pt; font-weight: 600; color: #475467; background: #EAECF0; border-radius: 3mm; padding: 0 1.8mm; margin-left: 1mm; }
  .tag.out { color: #B54708; background: #FFFAEB; }
  .tag.in { color: #067647; background: #ECFDF3; }
  .remark { margin: 1mm 0; }
  .sign { display: flex; gap: 14mm; margin: 12mm 0 0; break-inside: avoid; page-break-inside: avoid; }
  .sig { flex: 1; min-width: 0; }
  .sig .space { height: 17mm; }
  .sig .rule { border-top: 0.75pt solid #475467; }
  .sig .cap { font-size: 8.5pt; color: #344054; font-weight: 600; padding-top: 1.2mm; }
  .foot { margin-top: 8mm; font-size: 8pt; color: #667085; }
  b.n, .box b { font-variant-numeric: tabular-nums; }
  .accent { color: ${BLUE}; }
  </style></head><body>
  <table class="frame">
    <thead><tr><td><div class="spacer-top"></div></td></tr></thead>
    <tfoot><tr><td><div class="spacer-bottom"></div></td></tr></tfoot>
    <tbody><tr><td><div class="page">
      ${header}
      ${body}
      <div class="foot">${esc(input.footer)}</div>
    </div></td></tr></tbody>
  </table>
  </body></html>`;
}

// ---------------------------------------------------------------- the file

export interface HtmlPdfOptions {
  /**
   * The page as HTML for the layout asked for. Called with `true` when the letterhead is to be applied and
   * again with `false` if that fails, so the plain page can carry the logo and company details instead.
   */
  html: (letterhead: boolean) => string;
  /** The file's name in the cache folder, "Something.pdf" (see pdfFileName). */
  fileName: string;
  /** Print every page on the company letterhead. */
  letterhead: boolean;
  /** Told when the letterhead could not be used, so the screen can say so (the plain PDF is still made). */
  onNotice?: (notice: 'letterhead-unavailable') => void;
  /** Where failures are logged: "<tag>.letterhead.load" and "<tag>.letterhead.apply". */
  tag?: string;
}

/**
 * Print `html` to a PDF in the cache folder and return the file, ready for Sharing.shareAsync.
 * Throws when the PDF cannot be printed or written; the letterhead alone failing is only a notice.
 */
export async function exportHtmlPdf(opts: HtmlPdfOptions): Promise<File> {
  const tag = opts.tag ?? 'pdfShell';
  let letterhead: Uint8Array | null = null;
  if (opts.letterhead) {
    try {
      letterhead = await loadLetterhead();
    } catch (e) {
      reportError(e, `${tag}.letterhead.load`);
      opts.onNotice?.('letterhead-unavailable');
    }
  }

  // Every file expo-print made; all are deleted at the end, whatever happens.
  const printed: string[] = [];
  try {
    const print = async (withLetterhead: boolean): Promise<Uint8Array> => {
      // A4 explicitly: expo-print defaults to US Letter.
      const out = await Print.printToFileAsync({ html: opts.html(withLetterhead), base64: true, width: Math.round(A4_W), height: Math.round(A4_H) });
      printed.push(out.uri);
      return printedPdfBytes(out);
    };

    let bytes = await print(letterhead != null);
    if (letterhead) {
      try {
        bytes = await applyLetterhead(bytes, letterhead);
      } catch (e) {
        // The picture is unusable: print the plain page again (with the logo and company details on it)
        // rather than hand over a page with an empty letterhead area and no company name.
        reportError(e, `${tag}.letterhead.apply`);
        opts.onNotice?.('letterhead-unavailable');
        bytes = await print(false);
      }
    }

    if (!isPdf(bytes)) throw new Error('the print engine did not make a PDF');
    return writeSwap(bytes, opts.fileName);
  } finally {
    for (const uri of printed) {
      try {
        const tmp = new File(uri);
        if (tmp.exists) tmp.delete();
      } catch {
        // temp file already gone
      }
    }
  }
}

/** A PDF starts with "%PDF". */
function isPdf(bytes: Uint8Array): boolean {
  return bytes.byteLength > 8 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/**
 * Write the PDF under a temporary name, check it was written completely, then swap it in under its
 * final name, so a failure never leaves a half-written file where the real one belongs.
 */
function writeSwap(bytes: Uint8Array, fileName: string): File {
  const tmp = new File(Paths.cache, `${fileName}.tmp`);
  let moved = false; // after a move, `tmp` points at the finished file: it must not be deleted then
  try {
    if (tmp.exists) tmp.delete();
    tmp.create();
    tmp.writeSync(bytes);
    if (tmp.size !== bytes.byteLength) throw new Error('PDF was not written completely');
    const out = new File(Paths.cache, fileName);
    if (out.exists) out.delete();
    tmp.moveSync(out);
    moved = true;
    return out;
  } finally {
    if (!moved) {
      try {
        if (tmp.exists) tmp.delete();
      } catch {
        // nothing left to clean up
      }
    }
  }
}

/** Letters (any script), marks, digits and the joiner Sinhala conjuncts need; everything else becomes "-". */
function slug(text: string, max: number): string {
  return text
    .replace(/[^\p{L}\p{M}\p{N}\u200d]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** `Bluemoon-<kind>-<parts…>-<day>.pdf`, safe on every file system and short enough to share. */
export function pdfFileName(kind: string, parts: (string | null | undefined)[], day: string): string {
  const names = parts.map((p) => slug(p ?? '', 30)).filter(Boolean);
  return `${['Bluemoon', slug(kind, 20), ...names, slug(day, 10)].filter(Boolean).join('-')}.pdf`;
}
