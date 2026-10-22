/**
 * Letterhead export: placing report pages on the company letterhead (pdf-lib) and the report
 * HTML layout for both modes. Runs on Node with the real letterhead JPEG; the native modules
 * that pdf.ts imports are replaced with stubs because only the pure parts are exercised here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BlendMode, PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';

import type { Project, ProjectCost } from '@/db/types';
import { LOGO_DATA_URI } from '@/lib/brandLogo';
import { A4_H, A4_W, applyLetterhead, LETTERHEAD_MARGIN_MM, LETTERHEAD_WASH, PLAIN_MARGIN_MM } from '@/lib/letterhead';
import { BUNDLE_FORMAT, BUNDLE_VERSION, sha256Hex, type Bundle } from '@/lib/bundle';
import { readProjectPdf } from '@/lib/pdf';
import { buildReportHtml, type ReportInput } from '@/lib/reportHtml';
import { encodeUtf8 } from '@/lib/utf8';

// jest hoists these above the imports
jest.mock('expo-asset', () => ({ Asset: { fromModule: jest.fn() } }));
jest.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));
jest.mock('expo-print', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_algorithm: string, data: Uint8Array) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const out = require('node:crypto').createHash('sha256').update(data).digest() as Buffer;
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  },
}));
jest.mock('@/db', () => ({
  all: jest.fn(),
  classifyRow: jest.fn(),
  deviceId: jest.fn(() => 'test-device'),
  first: jest.fn(),
  mergeRow: jest.fn(),
  notify: jest.fn(),
  remove: jest.fn(),
  save: jest.fn(),
  tx: jest.fn((fn: () => unknown) => fn()),
  newId: jest.fn(() => 'id'),
}));
jest.mock('@/i18n', () => ({ tNow: (key: string) => key }));
jest.mock('@/lib/errors', () => ({ reportError: jest.fn() }));

const LETTERHEAD = new Uint8Array(readFileSync(join(__dirname, '../../../assets/brand/letterhead.jpeg')));

/** A small report PDF like the one expo-print makes: A4-ish pages with some text. */
async function sampleReport(pages: number, size: [number, number] = [595, 842]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(size);
    page.drawText(`Report page ${i + 1}`, { x: 60, y: size[1] - 200, size: 18, font });
  }
  return doc.save();
}

describe('applyLetterhead', () => {
  it('uses the real letterhead artwork (a JPEG of A4 at 200 dpi)', () => {
    expect(LETTERHEAD.byteLength).toBeGreaterThan(100_000);
    expect(Array.from(LETTERHEAD.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]); // JPEG magic
  });

  it('keeps one output page per report page, all exactly A4', async () => {
    const out = await applyLetterhead(await sampleReport(3), LETTERHEAD);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      expect(width).toBeCloseTo(595.28, 2);
      expect(height).toBeCloseTo(841.89, 2);
    }
  });

  it('fits a US Letter report onto A4 without changing the page size', async () => {
    const out = await applyLetterhead(await sampleReport(1, [612, 792]), LETTERHEAD);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(A4_W, 2);
    expect(height).toBeCloseTo(A4_H, 2);
  });

  it('embeds the letterhead once; the report pages are multiplied over a light wash on every page', async () => {
    const out = await applyLetterhead(await sampleReport(4), LETTERHEAD);
    const doc = await PDFDocument.load(out);

    // One picture however many pages (the file stays small)...
    const widths: number[] = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      const dict = obj instanceof PDFDict ? obj : (obj as { dict?: PDFDict }).dict;
      if (dict?.get(PDFName.of('Subtype'))?.toString() === '/Image') widths.push(Number(dict.get(PDFName.of('Width'))?.toString()));
    }
    expect(widths).toEqual([1653]);
    expect(out.byteLength).toBeLessThan(LETTERHEAD.byteLength + 60_000);

    // ...and every page multiplies the report over the letterhead, with a light wash under the text.
    for (const page of doc.getPages()) {
      const states = page.node.Resources()?.lookupMaybe(PDFName.of('ExtGState'), PDFDict);
      const blends = (states?.keys() ?? []).map((k) => states?.lookupMaybe(k, PDFDict)?.get(PDFName.of('BM'))?.toString());
      expect(blends).toContain(`/${BlendMode.Multiply}`);
      const alphas = (states?.keys() ?? []).map((k) => Number(states?.lookupMaybe(k, PDFDict)?.get(PDFName.of('ca'))?.toString()));
      expect(alphas).toContain(LETTERHEAD_WASH.opacity);
    }
  });

  it('keeps the data attachments so another phone can still import the PDF', async () => {
    const letterheaded = await applyLetterhead(await sampleReport(2), LETTERHEAD);

    // Same attachment step as pdf.ts buildPdf, applied to the letterheaded document.
    const bundle: Bundle = {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      kind: 'project',
      exported_at: '2026-10-22T10:00:00.000Z',
      device_id: 'phone-a',
      project_id: 'p1',
      project_name: 'කොළඹ පාර — Culvert',
      tables: { projects: [{ id: 'p1', name: 'කොළඹ පාර — Culvert' }] },
    };
    const json = encodeUtf8(JSON.stringify(bundle));
    const doc = await PDFDocument.load(letterheaded);
    await doc.attach(json, 'bluemoon-data.json', { mimeType: 'application/json' });
    await doc.attach(encodeUtf8(await sha256Hex(json)), 'bluemoon-data.sha256', { mimeType: 'text/plain' });
    const finalPdf = await doc.save({ useObjectStreams: true });

    const read = await readProjectPdf(finalPdf);
    expect(read.status).toBe('ok');
    if (read.status === 'ok') {
      expect(read.bundle.project_name).toBe('කොළඹ පාර — Culvert');
      expect(read.bundle.tables.projects).toHaveLength(1);
    }
    expect((await PDFDocument.load(finalPdf)).getPageCount()).toBe(2);
  });

  it('keeps the wash inside the writing area: clear of the header block, border and bottom band', () => {
    expect(LETTERHEAD_WASH.topMm).toBeGreaterThan(58.3); // header block ends at 58.3 mm
    expect(LETTERHEAD_WASH.bottomMm).toBeLessThan(286.3); // bottom band starts at 286.3 mm
    expect(LETTERHEAD_WASH.leftMm).toBeGreaterThan(5); // the border is within 5 mm of the edge
    expect(LETTERHEAD_WASH.rightMm).toBeGreaterThan(5);
    expect(LETTERHEAD_WASH.opacity).toBeGreaterThan(0);
    expect(LETTERHEAD_WASH.opacity).toBeLessThan(1);
  });

  it('rejects something that is not a JPEG instead of producing a broken PDF', async () => {
    await expect(applyLetterhead(await sampleReport(1), new Uint8Array([1, 2, 3, 4]))).rejects.toBeDefined();
  });
});

// ------------------------------------------------------------------ report HTML

const project: Project = {
  id: 'p1',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  deleted_at: null,
  version: 1,
  device_id: 'd',
  name: 'Welimada <School> & "Hall"',
  client: 'Zonal Education Office',
  location: 'Welimada',
  contract_cents: 1_850_000_000,
  start_date: null,
  end_date: null,
  status: 'active',
  notes: null,
};

const cost: ProjectCost = {
  project_id: 'p1',
  name: project.name,
  status: 'active',
  contract_cents: project.contract_cents,
  expense_cents: 12_345_600,
  labour_cents: 3_500_000,
  labour_paid_cents: 2_000_000,
};

function input(over: Partial<ReportInput> = {}): ReportInput {
  const base = { id: 'x', created_at: '', updated_at: '', deleted_at: null, version: 1, device_id: 'd' };
  return {
    project,
    cost,
    photoCount: 2,
    skippedPhotos: 0,
    letterhead: false,
    day: '2026-10-22',
    t: (k) => k,
    tables: {
      expenses: [
        { ...base, id: 'e1', project_id: 'p1', day: '2026-10-20', category: 'materials', amount_cents: 18_500_000, paid_to: 'Lanka <Cement>', method: 'bank', note: 'සිමෙන්ති 50' },
        { ...base, id: 'e2', project_id: 'p1', day: '2026-10-21', category: 'fuel', amount_cents: 1_200_000, paid_to: 'Ceypetco', method: 'cash', note: null },
        { ...base, id: 'e3', project_id: 'p1', day: '2026-10-21', category: 'food', amount_cents: 99_900, paid_to: 'கடை', method: 'cash', note: null, deleted_at: '2026-10-22T00:00:00Z' },
      ],
      workers: [{ id: 'w1', name: 'Nimal Perera' }],
      wage_entries: [{ ...base, id: 'g1', worker_id: 'w1', project_id: 'p1', day: '2026-10-21', kind: 'work', days: 1.5, amount_cents: 525_000 }],
      site_notes: [{ ...base, id: 'n1', project_id: 'p1', day: '2026-10-21', body: 'Slab shuttering done.\nWaiting for inspection.', weather: 'sunny' }],
    },
    ...over,
  };
}

describe('buildReportHtml', () => {
  it('plain report: logo header and 16 mm page margins', () => {
    const html = buildReportHtml(input());
    expect(html).toContain(LOGO_DATA_URI);
    expect(html).toContain('Reg. No. PV 00232701'); // company details beside the logo
    expect(html).toContain('077 337 0056');
    expect(html).toContain(`.spacer-top { height: ${PLAIN_MARGIN_MM.top}mm; }`);
    expect(html).toContain(`.spacer-bottom { height: ${PLAIN_MARGIN_MM.bottom}mm; }`);
    expect(html).toContain(`padding: 0 ${PLAIN_MARGIN_MM.right}mm 0 ${PLAIN_MARGIN_MM.left}mm`);
  });

  it('letterhead report: no own brand header, 64 / 20 / 16 mm margins, same sections', () => {
    const html = buildReportHtml(input({ letterhead: true }));
    expect(html).not.toContain(LOGO_DATA_URI);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('Reg. No. PV 00232701'); // the letterhead artwork already prints it
    expect(LETTERHEAD_MARGIN_MM).toEqual({ top: 64, right: 16, bottom: 20, left: 16 });
    expect(html).toContain('.spacer-top { height: 64mm; }');
    expect(html).toContain('.spacer-bottom { height: 20mm; }');
    expect(html).toContain('padding: 0 16mm 0 16mm');
    for (const section of ['byCategory', 'expenses', 'workers', 'siteNotes']) expect(html).toContain(section);
  });

  it('repeats the margin spacers on every printed page and sets @page margin to zero', () => {
    for (const letterhead of [false, true]) {
      const html = buildReportHtml(input({ letterhead }));
      expect(html).toContain('@page { size: A4; margin: 0; }');
      expect(html).toContain('<thead><tr><td><div class="spacer-top">');
      expect(html).toContain('<tfoot><tr><td><div class="spacer-bottom">');
      expect(html).toMatch(/table\.frame > thead \{ display: table-header-group; \}/);
      expect(html).toMatch(/table\.frame > tfoot \{ display: table-footer-group; \}/);
    }
  });

  it('escapes text, skips deleted rows, and keeps Sinhala and Tamil intact', () => {
    const html = buildReportHtml(input());
    expect(html).toContain('Welimada &lt;School&gt; &amp; &quot;Hall&quot;');
    expect(html).toContain('Lanka &lt;Cement&gt;');
    expect(html).not.toContain('<Cement>');
    expect(html).toContain('සිමෙන්ති 50');
    expect(html).not.toContain('கடை'); // that expense was deleted
    expect(html).toContain('<span class="count">2</span>'); // two live expenses
  });

  it('right-aligns amounts and repeats table headers across pages', () => {
    const html = buildReportHtml(input());
    expect(html).toContain('<th class="n"');
    expect(html).toMatch(/table\.data thead \{ display: table-header-group; \}/);
    expect(html).toMatch(/table\.data tr \{ break-inside: avoid;/);
    expect(html).toContain('Rs 185,000');
  });

  it('works for a project with no rows at all', () => {
    const html = buildReportHtml(input({ tables: {}, cost: null, photoCount: 0 }));
    expect(html).toContain('Rs 0');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });
});
