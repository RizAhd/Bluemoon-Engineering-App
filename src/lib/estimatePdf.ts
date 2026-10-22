/**
 * Estimate (quotation) PDF export.
 *
 * expo-print renders the quotation from HTML (estimateHtml.ts); with the letterhead option every
 * page is then placed on the company letterhead, exactly as for the project report. pdf-lib embeds
 * the estimate data as `bluemoon-data.json` plus its SHA-256 (bundle kind 'estimate'), so any PDF
 * viewer shows the quotation and another Bluemoon phone can read it back through Import PDF.
 *
 * The file is built next to its final name and swapped in only when it verified, so a failure never
 * leaves a half-written or unreadable PDF behind.
 */
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

import { deviceId } from '@/db';
import { loadEstimate, type LoadedEstimate } from '@/db/estimates';
import type { CompanyProfile, Estimate } from '@/db/types';
import type { Lang } from '@/i18n';
import { nowIso, today } from '@/lib/dates';
import { reportError } from '@/lib/errors';

import { BUNDLE_FORMAT, BUNDLE_VERSION, collectEstimate, sha256Hex, type Bundle } from './bundle';
import { getCompanyProfile } from './company';
import { allocatePayments, formatQty, lineAmount, validUntil } from './estimate';
import { buildEstimateHtml, type EstimateHtmlInput } from './estimateHtml';
import { A4_H, A4_W, applyLetterhead, LETTERHEAD_MARGIN_MM, PLAIN_MARGIN_MM } from './letterhead';
import { printedPdfBytes } from './printBytes';
import { DATA_NAME, HASH_NAME, loadLetterhead, readProjectPdf } from './pdf';
import { encodeUtf8 } from './utf8';

export interface EstimatePdfOptions {
  /** Print on the company letterhead (same picture and margins as the project report). */
  letterhead: boolean;
  /** Language of the printed labels. The client's language, not necessarily the app's. */
  lang: Lang;
  onNotice?: (notice: 'letterhead-unavailable') => void;
}

const MM = 72 / 25.4;

/**
 * Make the estimate PDF and return the file (in the cache folder, ready to share).
 * Throws when the estimate does not exist (or is deleted) or when the PDF cannot be built.
 */
export async function exportEstimatePdf(estimateId: string, opts: EstimatePdfOptions): Promise<File> {
  const loaded = loadEstimate(estimateId);
  if (!loaded) throw new Error('Estimate not found');
  const company = getCompanyProfile();
  // Read the data for the PDF and for its embedded copy in the same breath (nothing awaited in between), so they agree.
  const bundle: Bundle = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    kind: 'estimate',
    exported_at: nowIso(),
    device_id: deviceId(),
    estimate_id: estimateId,
    estimate_number: loaded.estimate.number,
    tables: collectEstimate(estimateId),
  };

  // The letterhead is optional: if its picture cannot be read, export the plain quotation and say so.
  let letterhead: Uint8Array | null = null;
  if (opts.letterhead) {
    try {
      letterhead = await loadLetterhead();
    } catch (e) {
      reportError(e, 'estimatePdf.letterhead.load');
      opts.onNotice?.('letterhead-unavailable');
    }
  }

  // Every file expo-print made; all are deleted at the end, whatever happens.
  const printed: string[] = [];
  try {
    const print = async (withLetterhead: boolean): Promise<Uint8Array> => {
      const html = buildEstimateHtml(htmlInput(loaded, company, opts.lang, withLetterhead));
      // A4 explicitly: expo-print defaults to US Letter.
      const out = await Print.printToFileAsync({ html, base64: true, width: Math.round(A4_W), height: Math.round(A4_H) });
      printed.push(out.uri);
      return printedPdfBytes(out);
    };

    let usedLetterhead = letterhead != null;
    let report = await print(usedLetterhead);
    if (letterhead) {
      try {
        report = await applyLetterhead(report, letterhead);
      } catch (e) {
        // The picture is unusable: print the plain quotation again (with the logo and company details
        // on the page) rather than hand over a page with an empty letterhead area and no company name.
        reportError(e, 'estimatePdf.letterhead.apply');
        opts.onNotice?.('letterhead-unavailable');
        usedLetterhead = false;
        report = await print(false);
      }
    }
    return await buildFile(report, loaded.estimate, company, bundle, usedLetterhead);
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

/** Everything the HTML prints, worked out by the shared helpers (nothing is calculated in the HTML). */
function htmlInput(loaded: LoadedEstimate, company: CompanyProfile, lang: Lang, letterhead: boolean): EstimateHtmlInput {
  const { estimate, items, payments, total } = loaded;
  return {
    estimate,
    items,
    payments,
    total,
    company,
    lang,
    letterhead,
    lines: items.map((it) => ({ qty: formatQty(it.qty_milli), amountCents: lineAmount(it.qty_milli, it.rate_cents) })),
    scheduleCents: allocatePayments(
      total.total_cents,
      payments.map((p) => p.percent_bp),
    ),
    validUntil: validUntil(estimate.issue_day, estimate.valid_days),
    day: today(),
  };
}

/**
 * Page "n / N" at the bottom right and the estimate number at the bottom left of every page of a
 * multi-page quotation, drawn in the bottom margin (clear of the letterhead's bottom band). Plain
 * Helvetica, so the number is only printed when it is plain ASCII; a one-page quotation has none.
 */
async function stampPageNumbers(doc: PDFDocument, number: string, letterhead: boolean): Promise<void> {
  const pages = doc.getPages();
  if (pages.length < 2) return;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const margin = letterhead ? LETTERHEAD_MARGIN_MM : PLAIN_MARGIN_MM;
  const baseline = (letterhead ? 14.5 : 9) * MM; // inside the bottom margin; the letterhead band starts 10.7 mm from the edge
  const size = 8;
  const color = rgb(0.4, 0.44, 0.52);
  const label = /^[\x20-\x7e]{1,40}$/.test(number.trim()) ? number.trim() : '';
  pages.forEach((page, i) => {
    const { width } = page.getSize();
    const text = `${i + 1} / ${pages.length}`;
    page.drawText(text, { x: width - margin.right * MM - font.widthOfTextAtSize(text, size), y: baseline, size, font, color });
    if (label) page.drawText(label, { x: margin.left * MM, y: baseline, size, font, color });
  });
}

/** Attach the data, write the PDF under a temporary name, check it reads back, then swap it in. */
async function buildFile(report: Uint8Array, estimate: Estimate, company: CompanyProfile, bundle: Bundle, letterhead: boolean): Promise<File> {
  const doc = await PDFDocument.load(report);
  await stampPageNumbers(doc, estimate.number, letterhead);

  const json = encodeUtf8(JSON.stringify(bundle));
  const hash = await sha256Hex(json);
  const now = new Date();
  doc.setTitle(`Estimate ${estimate.number} — ${estimate.client_name}`);
  doc.setAuthor(company.name);
  doc.setCreator('Bluemoon Engineering site app');
  doc.setSubject(`${BUNDLE_FORMAT} v${BUNDLE_VERSION}`);
  await doc.attach(json, DATA_NAME, { mimeType: 'application/json', description: 'Bluemoon estimate data', creationDate: now, modificationDate: now });
  await doc.attach(encodeUtf8(hash), HASH_NAME, { mimeType: 'text/plain', creationDate: now, modificationDate: now });
  const bytes = await doc.save({ useObjectStreams: true });

  const name = estimatePdfName(estimate);
  const tmp = new File(Paths.cache, `${name}.tmp`);
  let moved = false; // after a move, `tmp` points at the finished file: it must not be deleted then
  try {
    if (tmp.exists) tmp.delete();
    tmp.create();
    tmp.writeSync(bytes);
    if (tmp.size !== bytes.byteLength) throw new Error('estimate PDF was not written completely');
    const check = await readProjectPdf(tmp.bytesSync());
    if (check.status !== 'ok' || check.bundle.kind !== 'estimate') throw new Error(`estimate PDF failed verification (${check.status})`);

    const out = new File(Paths.cache, name);
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
    .replace(/[^\p{L}\p{M}\p{N}‍]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** `Estimate-<number>-<client>.pdf`, safe on every file system and short enough to share. */
export function estimatePdfName(estimate: Pick<Estimate, 'number' | 'client_name'>): string {
  const parts = [slug(estimate.number, 30), slug(estimate.client_name, 40)].filter(Boolean);
  return `${['Estimate', ...parts].join('-')}.pdf`;
}
