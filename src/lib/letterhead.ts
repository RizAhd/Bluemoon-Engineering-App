/**
 * Company letterhead for exported PDF reports.
 *
 * The letterhead is a full A4 picture (assets/brand/letterhead.jpeg, 1653 x 2339 px) with
 * the Bluemoon logo, phone, e-mail, address and registration number in a navy header block,
 * a navy border, and a faint skyline at the bottom. The report is printed with generous
 * margins so nothing touches those areas, then every page is placed on the letterhead.
 *
 * This file is plain pdf-lib (no native modules) so it can be unit tested on Node.
 */
import { BlendMode, PDFDocument, rgb } from 'pdf-lib';

/** A4 in PDF points. */
export const A4_W = 595.28;
export const A4_H = 841.89;

/**
 * Where text may go on the letterhead, measured on the artwork: the header block ends at
 * 58.3 mm (its text at 56 mm), the bottom band starts at 286.3 mm, the border is within 5 mm of
 * the paper edge. Margins below leave at least 5 mm of clear space around all of it.
 */
export const LETTERHEAD_MARGIN_MM = { top: 64, right: 16, bottom: 20, left: 16 } as const;

/** Margins for a plain (no letterhead) report. */
export const PLAIN_MARGIN_MM = { top: 16, right: 16, bottom: 16, left: 16 } as const;

/**
 * The faint skyline at the bottom of the letterhead sits right behind the last table rows.
 * A semi-transparent white wash over the writing area only (header block, border and bottom
 * band are left alone) keeps it as a watermark but makes amounts and text easy to read.
 */
export const LETTERHEAD_WASH = { leftMm: 8, rightMm: 8, topMm: 60, bottomMm: 283, opacity: 0.6 } as const;

const MM = 72 / 25.4;

/**
 * Put every page of `reportPdf` on the letterhead.
 *
 * Per page: the letterhead picture, a light white wash over the writing area, then the report
 * page multiplied on top. Multiply keeps black text black and lets a white or transparent
 * report background show the letterhead, whichever way the print engine paints its page
 * background.
 */
export async function applyLetterhead(reportPdf: Uint8Array, letterheadJpeg: Uint8Array): Promise<Uint8Array> {
  const source = await PDFDocument.load(reportPdf, { updateMetadata: false });
  const out = await PDFDocument.create();
  const background = await out.embedJpg(letterheadJpeg);
  const embedded = await out.embedPdf(source, source.getPageIndices());

  const wash = LETTERHEAD_WASH;
  for (const page of embedded) {
    const target = out.addPage([A4_W, A4_H]);

    target.drawImage(background, { x: 0, y: 0, width: A4_W, height: A4_H });
    target.drawRectangle({
      x: wash.leftMm * MM,
      y: A4_H - wash.bottomMm * MM,
      width: A4_W - (wash.leftMm + wash.rightMm) * MM,
      height: (wash.bottomMm - wash.topMm) * MM,
      color: rgb(1, 1, 1),
      opacity: wash.opacity,
    });

    // Fit the report page onto A4 (it is A4 already; allow a tiny rounding difference).
    const scale = Math.min(A4_W / page.width, A4_H / page.height);
    const w = page.width * scale;
    const h = page.height * scale;
    target.drawPage(page, { x: (A4_W - w) / 2, y: A4_H - h, width: w, height: h, blendMode: BlendMode.Multiply });
  }
  return out.save({ useObjectStreams: true });
}
