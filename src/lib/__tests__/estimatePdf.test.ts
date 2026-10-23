/**
 * exportEstimatePdf: the quotation PDF end to end on Node. The estimate, the company profile and the
 * estimate rows are supplied by mocks; expo-print, expo-asset and the file system are the harness
 * doubles from src/test-utils (setup.ts), so the real letterhead picture and real pdf-lib run.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, StandardFonts } from 'pdf-lib';

import { loadEstimate } from '@/db/estimates';
import type { CompanyProfile, Estimate, EstimateItem, EstimatePayment, EstimateTotal } from '@/db/types';
import { BUNDLE_FORMAT, BUNDLE_VERSION, collectEstimate, type Bundle } from '@/lib/bundle';
import { getCompanyProfile } from '@/lib/company';
import { allocatePayments, estimateSums } from '@/lib/estimate';
import { estimatePdfName, exportEstimatePdf } from '@/lib/estimatePdf';
import { reportError } from '@/lib/errors';
import { A4_H, A4_W, applyLetterhead } from '@/lib/letterhead';
import { readProjectPdf } from '@/lib/pdf';
import { silenceConsoleError } from '@/test-utils';

jest.mock('@/db', () => ({ ...jest.requireActual('@/db'), deviceId: jest.fn(() => 'phone-a') }));
jest.mock('@/db/estimates', () => ({ loadEstimate: jest.fn() }));
// The embedded letterhead picture, swappable per test (an unreadable picture is the "cannot be read" case).
const mockLetterhead = { data: null as string | null };
jest.mock('@/lib/letterheadData', () => ({
  get LETTERHEAD_JPEG_BASE64() {
    return mockLetterhead.data ?? jest.requireActual('@/lib/letterheadData').LETTERHEAD_JPEG_BASE64;
  },
}));
jest.mock('@/lib/company', () => ({ getCompanyProfile: jest.fn() }));
jest.mock('@/lib/bundle', () => ({ ...jest.requireActual('@/lib/bundle'), collectEstimate: jest.fn() }));
jest.mock('@/lib/errors', () => ({ ...jest.requireActual('@/lib/errors'), reportError: jest.fn() }));
jest.mock('@/lib/letterhead', () => {
  const actual = jest.requireActual('@/lib/letterhead');
  return { ...actual, applyLetterhead: jest.fn(actual.applyLetterhead) };
});

jest.setTimeout(60_000);

// ---------------------------------------------------------------- fixtures

const base = { created_at: '2026-10-22T00:00:00.000Z', updated_at: '2026-10-22T00:00:00.000Z', deleted_at: null, version: 1, device_id: 'phone-a' };

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

const ESTIMATE: Estimate = {
  ...base,
  id: 'e1',
  number: 'EST-2026-014',
  client_name: 'Mr. K. A. Perera',
  client_phone: '071 234 5678',
  client_address: '45/2, Temple Road, Badulla',
  title: 'Boundary wall and gate',
  location: 'Welimada',
  issue_day: '2026-10-22',
  valid_days: 30,
  discount_cents: 0,
  tax_bp: 0,
  status: 'draft',
  terms: 'Prices are valid for 30 days.',
  notes: null,
  project_id: null,
};

function items(n: number): EstimateItem[] {
  return Array.from({ length: n }, (_, i) => ({
    ...base,
    id: `i${i + 1}`,
    estimate_id: 'e1',
    position: i + 1,
    description: `Work item ${i + 1}`,
    unit: 'm²',
    qty_milli: 12_500,
    rate_cents: 1_250_050,
  }));
}

const PAYMENTS: EstimatePayment[] = [
  { ...base, id: 'p1', estimate_id: 'e1', position: 1, label: 'Advance', percent_bp: 3000 },
  { ...base, id: 'p2', estimate_id: 'e1', position: 2, label: 'Progress payment', percent_bp: 4000 },
  { ...base, id: 'p3', estimate_id: 'e1', position: 3, label: 'On completion', percent_bp: 3000 },
];

function loaded(over: Partial<Estimate> = {}, n = 3) {
  const estimate = { ...ESTIMATE, ...over };
  const rows = items(n);
  const total: EstimateTotal = { estimate_id: 'e1', item_count: n, ...estimateSums(rows, estimate.discount_cents, estimate.tax_bp), scheduled_bp: 10_000 };
  return { estimate, items: rows, payments: PAYMENTS, total };
}

/** What collectEstimate returns for the fixture (one estimate row plus its lines and stages). */
function tablesOf(l: ReturnType<typeof loaded>): Bundle['tables'] {
  return {
    estimates: [{ ...l.estimate }],
    estimate_items: l.items.map((r) => ({ ...r })),
    estimate_payments: l.payments.map((r) => ({ ...r })),
  };
}

let current: ReturnType<typeof loaded>;

function give(l: ReturnType<typeof loaded>) {
  current = l;
  jest.mocked(loadEstimate).mockReturnValue(l);
  jest.mocked(collectEstimate).mockReturnValue(tablesOf(l));
}

const printMock = () => jest.mocked(Print.printToFileAsync);
const htmlOf = (call: number) => (printMock().mock.calls[call][0] as { html: string }).html;

/** A printed report with `pages` A4 pages, as expo-print would leave it in the cache (and return as base64 when asked). */
function printOnce(pages: number) {
  printMock().mockImplementationOnce(async (options) => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages; i++) doc.addPage([595, 842]).drawText(`printed page ${i + 1}`, { x: 60, y: 780, size: 12, font });
    const dir = new Directory(Paths.cache, 'Print');
    if (!dir.exists) dir.create({ intermediates: true });
    const file = new File(dir, `multi-${pages}-${Math.random().toString(36).slice(2)}.pdf`);
    file.create();
    const bytes = await doc.save();
    file.writeSync(bytes);
    return { uri: file.uri, numberOfPages: pages, ...(options?.base64 ? { base64: Buffer.from(bytes).toString('base64') } : {}) };
  });
}

const cacheFile = (name: string) => new File(Paths.cache, name);

async function read(file: File) {
  return PDFDocument.load(file.bytesSync(), { updateMetadata: false });
}

/** The names of the files attached to a PDF. */
function attachmentNames(doc: PDFDocument): string[] {
  const tree = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const names: string[] = [];
  const walk = (node: PDFDict) => {
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    for (let i = 0; kids && i < kids.size(); i++) {
      const kid = kids.lookupMaybe(i, PDFDict);
      if (kid) walk(kid);
    }
    const arr = node.lookupMaybe(PDFName.of('Names'), PDFArray);
    for (let i = 0; arr && i + 1 < arr.size(); i += 2) {
      const n = arr.lookup(i);
      if (n instanceof PDFString || n instanceof PDFHexString) names.push(n.decodeText());
    }
  };
  if (tree) walk(tree);
  return names.sort();
}

/** The drawing operators of a page, as text (page numbers are drawn as hex strings in Helvetica's encoding). */
function pageContent(doc: PDFDocument, index: number): string {
  const contents = doc.getPage(index).node.Contents();
  const list: unknown[] = [];
  if (contents instanceof PDFArray) for (let i = 0; i < contents.size(); i++) list.push(contents.lookup(i));
  else list.push(contents);
  return list
    .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
    .map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString('latin1'))
    .join('\n');
}

const hex = (text: string) => Buffer.from(text, 'latin1').toString('hex');
const drawsText = (doc: PDFDocument, index: number, text: string) => pageContent(doc, index).toLowerCase().includes(hex(text));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCompanyProfile).mockReturnValue(COMPANY);
  give(loaded());
  // the cache folder starts empty for every test
  for (const f of new Directory(Paths.cache).list()) {
    try {
      f.delete();
    } catch {
      // a folder: leave it
    }
  }
});

// ---------------------------------------------------------------- tests

describe('exportEstimatePdf', () => {
  it('makes Estimate-<number>-<client>.pdf in the cache folder', async () => {
    const out = await exportEstimatePdf('e1', { letterhead: false, lang: 'en' });
    expect(out.name).toBe('Estimate-EST-2026-014-Mr-K-A-Perera.pdf');
    expect(out.exists).toBe(true);
    expect(out.parentDirectory.uri).toBe(Paths.cache.uri);
    expect(out.size).toBeGreaterThan(1000);
    expect(loadEstimate).toHaveBeenCalledWith('e1');
  });

  it('prints A4 (595 x 842 pt, never US Letter) with the labels of the chosen language', async () => {
    await exportEstimatePdf('e1', { letterhead: false, lang: 'ta' });
    expect(printMock()).toHaveBeenCalledTimes(1);
    expect(printMock().mock.calls[0][0]).toMatchObject({ base64: true, width: Math.round(A4_W), height: Math.round(A4_H) });
    expect(Math.round(A4_W)).toBe(595);
    expect(Math.round(A4_H)).toBe(842);
    const html = htmlOf(0);
    expect(html).toContain('@page { size: A4; margin: 0; }');
    expect(html).toContain('<html lang="ta">');
    expect(html).toContain('மதிப்பீடு');
    expect(html).toContain('EST-2026-014');
    expect(html).toContain('Mr. K. A. Perera');
  });

  it('prints what the shared helpers work out (schedule amounts, quantities) and the company profile', async () => {
    give(loaded({ discount_cents: 1_000_000, tax_bp: 1800 }));
    await exportEstimatePdf('e1', { letterhead: false, lang: 'en' });
    const html = htmlOf(0);
    const { total } = current;
    // the schedule is allocated by the shared helper and adds up to the total to the cent
    const parts = allocatePayments(total.total_cents, [3000, 4000, 3000]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total.total_cents);
    for (const cents of parts) expect(html).toContain(`<td class="n">${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>`);
    expect(html).toContain('<td class="n">12.5</td>');
    expect(html).toContain('Tax (18%)');
    expect(html).toContain('21 Nov 2026');
    expect(html).toContain("People's Bank");
    expect(html).toContain('Reg. No. PV 00232701');
  });

  it('carries the estimate data, readable by readProjectPdf, with a valid hash', async () => {
    const before = Date.now();
    const out = await exportEstimatePdf('e1', { letterhead: false, lang: 'en' });
    const doc = await read(out);
    expect(attachmentNames(doc)).toEqual(['bluemoon-data.json', 'bluemoon-data.sha256']);

    const res = await readProjectPdf(out.bytesSync());
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    const b = res.bundle;
    expect(b.format).toBe(BUNDLE_FORMAT);
    expect(b.version).toBe(BUNDLE_VERSION);
    expect(b.kind).toBe('estimate');
    expect(b.estimate_id).toBe('e1');
    expect(b.estimate_number).toBe('EST-2026-014');
    expect(b.device_id).toBe('phone-a');
    expect(Date.parse(b.exported_at)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(b.exported_at)).toBeLessThanOrEqual(Date.now() + 1000);
    expect(b.project_id).toBeUndefined();
    expect(collectEstimate).toHaveBeenCalledWith('e1');
    // exactly the rows collectEstimate gave, after a JSON round trip
    expect(b.tables).toEqual(JSON.parse(JSON.stringify(tablesOf(current))));
    expect(b.tables.estimate_items).toHaveLength(3);
    expect(b.tables.estimate_payments).toHaveLength(3);
    expect(res.files.size).toBe(0); // no photos in an estimate
  });

  it('keeps Sinhala and Tamil text in the embedded data', async () => {
    give(loaded({ client_name: 'කමල් පෙරේරා', title: 'வேலி கட்டுதல்' }));
    const out = await exportEstimatePdf('e1', { letterhead: false, lang: 'si' });
    const res = await readProjectPdf(out.bytesSync());
    if (res.status !== 'ok') throw new Error('not readable');
    expect(res.bundle.tables.estimates?.[0]).toMatchObject({ client_name: 'කමල් පෙරේරා', title: 'வேலி கட்டுதல்' });
    expect(out.name).toBe('Estimate-EST-2026-014-කමල්-පෙරේරා.pdf');
  });

  it('sets the PDF title, author, creator and subject', async () => {
    const out = await exportEstimatePdf('e1', { letterhead: false, lang: 'en' });
    const doc = await read(out);
    expect(doc.getTitle()).toBe('Estimate EST-2026-014 — Mr. K. A. Perera');
    expect(doc.getAuthor()).toBe('Bluemoon Engineering (Pvt) Ltd');
    expect(doc.getCreator()).toBe('Bluemoon Engineering site app');
    expect(doc.getSubject()).toBe(`${BUNDLE_FORMAT} v${BUNDLE_VERSION}`);
  });

  it('throws a clear error when the estimate does not exist, and prints nothing', async () => {
    jest.mocked(loadEstimate).mockReturnValue(null);
    await expect(exportEstimatePdf('gone', { letterhead: false, lang: 'en' })).rejects.toThrow('Estimate not found');
    expect(printMock()).not.toHaveBeenCalled();
    expect(collectEstimate).not.toHaveBeenCalled();
    expect(new Directory(Paths.cache).list().filter((f) => f.name.startsWith('Estimate'))).toHaveLength(0);
  });

  it('replaces an older file of the same name and leaves no temporary file behind', async () => {
    const stale = cacheFile('Estimate-EST-2026-014-Mr-K-A-Perera.pdf');
    stale.create();
    stale.writeSync(new Uint8Array([1, 2, 3, 4]));
    const out = await exportEstimatePdf('e1', { letterhead: false, lang: 'en' });
    expect(out.uri).toBe(stale.uri);
    expect(out.size).toBeGreaterThan(1000);
    expect((await readProjectPdf(out.bytesSync())).status).toBe('ok');
    expect(new Directory(Paths.cache).list().filter((f) => f.name.endsWith('.tmp'))).toHaveLength(0);
  });

  it('exporting twice gives one file, not two', async () => {
    const first = await exportEstimatePdf('e1', { letterhead: false, lang: 'en' });
    const second = await exportEstimatePdf('e1', { letterhead: false, lang: 'en' });
    expect(second.uri).toBe(first.uri);
    expect(new Directory(Paths.cache).list().filter((f) => f.name.startsWith('Estimate-'))).toHaveLength(1);
  });

  it('deletes the temporary printed file', async () => {
    await exportEstimatePdf('e1', { letterhead: false, lang: 'en' });
    const printed = await Promise.all(printMock().mock.results.map((r) => r.value as Promise<{ uri: string }>));
    expect(printed).toHaveLength(1);
    expect(new File(printed[0].uri).exists).toBe(false);
  });

  it('deletes the temporary printed file and leaves no half-written PDF when the build fails', async () => {
    const stale = cacheFile('Estimate-EST-2026-014-Mr-K-A-Perera.pdf');
    stale.create();
    stale.writeSync(new Uint8Array([9, 9, 9]));
    // an estimate row that does not match the estimate id: the finished file does not verify
    jest.mocked(collectEstimate).mockReturnValue({ estimates: [{ id: 'someone-else' }] });
    await expect(exportEstimatePdf('e1', { letterhead: false, lang: 'en' })).rejects.toThrow(/verification/);
    const printed = await Promise.all(printMock().mock.results.map((r) => r.value as Promise<{ uri: string }>));
    for (const p of printed) expect(new File(p.uri).exists).toBe(false);
    expect(Array.from(stale.bytesSync())).toEqual([9, 9, 9]); // the older file is untouched
    expect(new Directory(Paths.cache).list().filter((f) => f.name.endsWith('.tmp'))).toHaveLength(0);
  });

  it('builds from the base64 expo-print returns, without reading the printed file (Expo Go cannot read it)', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 2; i++) doc.addPage([595, 842]).drawText(`base64 page ${i + 1}`, { x: 60, y: 780, size: 12, font });
    const bytes = await doc.save();
    // the uri points at nothing: only the base64 can supply the pages
    printMock().mockResolvedValueOnce({ uri: new File(Paths.cache, 'Print', 'never-written.pdf').uri, numberOfPages: 2, base64: Buffer.from(bytes).toString('base64') });
    const out = await read(await exportEstimatePdf('e1', { letterhead: false, lang: 'en' }));
    expect(out.getPageCount()).toBe(2);
    expect(drawsText(out, 1, '2 / 2')).toBe(true);
  });

  it('falls back to reading the printed file when expo-print returns no base64', async () => {
    printMock().mockImplementationOnce(async () => {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (let i = 0; i < 2; i++) doc.addPage([595, 842]).drawText(`file page ${i + 1}`, { x: 60, y: 780, size: 12, font });
      const dir = new Directory(Paths.cache, 'Print');
      if (!dir.exists) dir.create({ intermediates: true });
      const file = new File(dir, `no-base64-${Math.random().toString(36).slice(2)}.pdf`);
      file.create();
      file.writeSync(await doc.save());
      return { uri: file.uri, numberOfPages: 2 };
    });
    const out = await read(await exportEstimatePdf('e1', { letterhead: false, lang: 'en' }));
    expect(out.getPageCount()).toBe(2);
    expect(drawsText(out, 0, '1 / 2')).toBe(true);
  });

  it('passes a printing failure on, with nothing left in the cache', async () => {
    printMock().mockRejectedValueOnce(new Error('print failed'));
    await expect(exportEstimatePdf('e1', { letterhead: false, lang: 'en' })).rejects.toThrow('print failed');
    expect(new Directory(Paths.cache).list().filter((f) => f.name.startsWith('Estimate'))).toHaveLength(0);
  });

  it('a one-page quotation has no page numbers; a long one has "n / N" and its number on every page', async () => {
    const one = await read(await exportEstimatePdf('e1', { letterhead: false, lang: 'en' }));
    expect(one.getPageCount()).toBe(1);
    expect(drawsText(one, 0, '1 / 1')).toBe(false);

    printOnce(3);
    const three = await read(await exportEstimatePdf('e1', { letterhead: false, lang: 'en' }));
    expect(three.getPageCount()).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(drawsText(three, i, `${i + 1} / 3`)).toBe(true);
      expect(drawsText(three, i, 'EST-2026-014')).toBe(true);
    }
    expect(drawsText(three, 0, '2 / 3')).toBe(false);
  });

  it('a number that is not plain ASCII is left out of the page footer (page numbers stay)', async () => {
    give(loaded({ number: 'ඇස්-014' }));
    printOnce(2);
    const doc = await read(await exportEstimatePdf('e1', { letterhead: false, lang: 'en' }));
    expect(drawsText(doc, 0, '1 / 2')).toBe(true);
    expect(drawsText(doc, 1, '2 / 2')).toBe(true);
    expect(pageContent(doc, 0)).not.toMatch(/ඇස්/);
  });
});

describe('the embedded letterhead picture', () => {
  it('is exactly assets/brand/letterhead.jpeg (regenerate with scripts/embed-letterhead.py)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('node:path') as typeof import('node:path');
    const file = readFileSync(join(__dirname, '../../../assets/brand/letterhead.jpeg')).toString('base64');
    expect(jest.requireActual<typeof import('@/lib/letterheadData')>('@/lib/letterheadData').LETTERHEAD_JPEG_BASE64).toBe(file);
  });
});

describe('exportEstimatePdf on the letterhead', () => {
  // The letterhead picture is cached after the first successful load, so the "cannot be read" case runs first.
  it('falls back to the plain quotation and says so when the letterhead picture cannot be read', async () => {
    const quiet = silenceConsoleError();
    mockLetterhead.data = '!!not base64!!';
    const notices: string[] = [];
    const out = await exportEstimatePdf('e1', { letterhead: true, lang: 'en', onNotice: (n) => notices.push(n) });
    mockLetterhead.data = null;
    quiet.mockRestore();

    expect(notices).toEqual(['letterhead-unavailable']);
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), 'estimatePdf.letterhead.load');
    // plain layout: own logo and company details, 16 mm margins, nothing multiplied over a letterhead
    expect(printMock()).toHaveBeenCalledTimes(1);
    expect(htmlOf(0)).toContain('<img');
    expect(htmlOf(0)).toContain('.spacer-top { height: 16mm; }');
    expect(applyLetterhead).not.toHaveBeenCalled();
    const doc = await read(out);
    expect(doc.getPageCount()).toBe(1);
    expect((await readProjectPdf(out.bytesSync())).status).toBe('ok');
  });

  it('also falls back when the embedded picture is empty', async () => {
    const notices: string[] = [];
    mockLetterhead.data = '';
    await exportEstimatePdf('e1', { letterhead: true, lang: 'en', onNotice: (n) => notices.push(n) });
    mockLetterhead.data = null;
    expect(notices).toEqual(['letterhead-unavailable']);
    expect(htmlOf(0)).toContain('.spacer-top { height: 16mm; }');
  });

  it('puts every page on the letterhead: A4 pages, one picture, 64 / 20 / 16 mm layout, no notice', async () => {
    const notices: string[] = [];
    printOnce(3);
    const out = await exportEstimatePdf('e1', { letterhead: true, lang: 'en', onNotice: (n) => notices.push(n) });
    expect(notices).toEqual([]);
    expect(applyLetterhead).toHaveBeenCalledTimes(1);

    const html = htmlOf(0);
    expect(html).toContain('.spacer-top { height: 64mm; }');
    expect(html).toContain('.spacer-bottom { height: 20mm; }');
    expect(html).not.toContain('<img'); // the letterhead supplies the logo

    const doc = await read(out);
    expect(doc.getPageCount()).toBe(3);
    for (const page of doc.getPages()) {
      expect(page.getSize().width).toBeCloseTo(A4_W, 2);
      expect(page.getSize().height).toBeCloseTo(A4_H, 2);
    }
    const widths: number[] = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      const dict = obj instanceof PDFDict ? obj : (obj as { dict?: PDFDict }).dict;
      if (dict?.get(PDFName.of('Subtype'))?.toString() === '/Image') widths.push(Number(dict.get(PDFName.of('Width'))?.toString()));
    }
    expect(widths).toEqual([1653]);

    // page numbers sit in the bottom margin of the letterhead pages
    for (let i = 0; i < 3; i++) expect(drawsText(doc, i, `${i + 1} / 3`)).toBe(true);
  });

  it('keeps the estimate data readable on the letterhead version', async () => {
    const out = await exportEstimatePdf('e1', { letterhead: true, lang: 'si' });
    const res = await readProjectPdf(out.bytesSync());
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.bundle.kind).toBe('estimate');
    expect(htmlOf(0)).toContain('<html lang="si">');
  });

  it('prints the plain quotation again, with logo and company details, when the letterhead cannot be applied', async () => {
    const quiet = silenceConsoleError();
    jest.mocked(applyLetterhead).mockRejectedValueOnce(new Error('cannot decode the JPEG'));
    const notices: string[] = [];
    const out = await exportEstimatePdf('e1', { letterhead: true, lang: 'en', onNotice: (n) => notices.push(n) });
    quiet.mockRestore();

    expect(notices).toEqual(['letterhead-unavailable']);
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), 'estimatePdf.letterhead.apply');
    expect(printMock()).toHaveBeenCalledTimes(2);
    expect(htmlOf(0)).toContain('.spacer-top { height: 64mm; }'); // first try: letterhead layout
    expect(htmlOf(1)).toContain('.spacer-top { height: 16mm; }'); // second: plain, with its own logo
    expect(htmlOf(1)).toContain('<img');
    expect(htmlOf(1)).toContain('Reg. No. PV 00232701');
    // both printed files are gone and the result is the readable plain version
    const printed = await Promise.all(printMock().mock.results.map((r) => r.value as Promise<{ uri: string }>));
    for (const p of printed) expect(new File(p.uri).exists).toBe(false);
    expect((await readProjectPdf(out.bytesSync())).status).toBe('ok');
  });
});

describe('estimatePdfName', () => {
  it('is Estimate-<number>-<client>.pdf', () => {
    expect(estimatePdfName({ number: 'EST-2026-001', client_name: 'Perera & Sons' })).toBe('Estimate-EST-2026-001-Perera-Sons.pdf');
  });

  it('removes characters that are unsafe in file names', () => {
    expect(estimatePdfName({ number: 'EST/2026\\001:?', client_name: 'A*B"C<D>E|F' })).toBe('Estimate-EST-2026-001-A-B-C-D-E-F.pdf');
    expect(estimatePdfName({ number: '../../etc', client_name: 'x' })).not.toMatch(/[/\\:*?"<>|]/);
    expect(estimatePdfName({ number: '../../etc', client_name: '..' })).toBe('Estimate-etc.pdf');
  });

  it('limits the length (number 30, client 40) without leaving a dangling dash', () => {
    const name = estimatePdfName({ number: 'N'.repeat(100), client_name: `${'abcd efgh '.repeat(20)}` });
    expect(name.length).toBeLessThanOrEqual('Estimate-'.length + 30 + 1 + 40 + '.pdf'.length);
    expect(name).not.toMatch(/-\.pdf$/);
    expect(name).toMatch(/^Estimate-N{30}-abcd-efgh/);
  });

  it('keeps letters of every script (Sinhala and Tamil, with their vowel signs and joiners)', () => {
    expect(estimatePdfName({ number: 'EST-1', client_name: 'ශ්‍රී ලංකා' })).toBe('Estimate-EST-1-ශ්‍රී-ලංකා.pdf');
    expect(estimatePdfName({ number: 'EST-1', client_name: 'வேலுப்பிள்ளை' })).toBe('Estimate-EST-1-வேலுப்பிள்ளை.pdf');
  });

  it('copes with empty parts', () => {
    expect(estimatePdfName({ number: '???', client_name: '***' })).toBe('Estimate.pdf');
    expect(estimatePdfName({ number: 'EST-1', client_name: '' })).toBe('Estimate-EST-1.pdf');
  });
});
