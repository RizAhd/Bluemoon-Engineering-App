/**
 * exportHtmlPdf: the print, letterhead and write half of every printable list, end to end on Node. expo-print,
 * expo-asset and the file system are the harness doubles from src/test-utils (setup.ts), so the real
 * letterhead picture and real pdf-lib run. Mirrors the estimate's tests (estimatePdf.test.ts): the same
 * fallbacks, the same promise that a failure leaves no half-written or temporary file behind.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';

import { reportError } from '@/lib/errors';
import { A4_H, A4_W, applyLetterhead } from '@/lib/letterhead';
import { exportHtmlPdf, pageHtml } from '@/lib/pdfShell';
import { silenceConsoleError } from '@/test-utils';

// The embedded letterhead picture, swappable per test (an unreadable picture is the "cannot be read" case).
const mockLetterhead = { data: null as string | null };
jest.mock('@/lib/letterheadData', () => ({
  get LETTERHEAD_JPEG_BASE64() {
    return mockLetterhead.data ?? jest.requireActual('@/lib/letterheadData').LETTERHEAD_JPEG_BASE64;
  },
}));
jest.mock('@/lib/errors', () => ({ ...jest.requireActual('@/lib/errors'), reportError: jest.fn() }));
jest.mock('@/lib/letterhead', () => {
  const actual = jest.requireActual('@/lib/letterhead');
  return { ...actual, applyLetterhead: jest.fn(actual.applyLetterhead) };
});

jest.setTimeout(60_000);

const NAME = 'Bluemoon-Test-2026-10-22.pdf';
const printMock = () => jest.mocked(Print.printToFileAsync);
const htmlOf = (call: number) => (printMock().mock.calls[call][0] as { html: string }).html;
const cacheFile = (name: string) => new File(Paths.cache, name);
const cacheNames = () => new Directory(Paths.cache).list().map((f) => f.name);

/** The page builder a screen passes: the layout asked for is what gets printed. */
const builder = () => jest.fn((letterhead: boolean) => pageHtml({ title: 'Test list', kicker: 'Test · 22 Oct 2026', letterhead, body: '<p>body</p>', footer: 'footer' }));

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

async function read(file: File) {
  return PDFDocument.load(file.bytesSync(), { updateMetadata: false });
}

/** The widths of the pictures embedded in a PDF. */
function imageWidths(doc: PDFDocument): number[] {
  const widths: number[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : (obj as { dict?: PDFDict }).dict;
    if (dict?.get(PDFName.of('Subtype'))?.toString() === '/Image') widths.push(Number(dict.get(PDFName.of('Width'))?.toString()));
  }
  return widths;
}

/** Every file expo-print made, which the export must have deleted. */
async function printedFiles(): Promise<File[]> {
  const printed = await Promise.all(printMock().mock.results.map((r) => r.value as Promise<{ uri: string }>));
  return printed.map((p) => new File(p.uri));
}

beforeEach(() => {
  jest.clearAllMocks();
  // the cache folder starts empty for every test
  for (const f of new Directory(Paths.cache).list()) {
    try {
      f.delete();
    } catch {
      // a folder: leave it
    }
  }
});

describe('exportHtmlPdf on plain paper', () => {
  it('makes the named file in the cache folder: a readable one-page PDF', async () => {
    const html = builder();
    const out = await exportHtmlPdf({ html, fileName: NAME, letterhead: false });
    expect(out.name).toBe(NAME);
    expect(out.exists).toBe(true);
    expect(out.parentDirectory.uri).toBe(Paths.cache.uri);
    expect(out.size).toBeGreaterThan(1000);
    expect(Buffer.from(out.bytesSync().subarray(0, 4)).toString('latin1')).toBe('%PDF');
    expect((await read(out)).getPageCount()).toBe(1);
    expect(html).toHaveBeenCalledTimes(1);
    expect(html).toHaveBeenCalledWith(false);
  });

  it('prints A4 (595 x 842 pt, never US Letter) with the logo and company details, from the base64 expo-print returns', async () => {
    await exportHtmlPdf({ html: builder(), fileName: NAME, letterhead: false });
    expect(printMock()).toHaveBeenCalledTimes(1);
    expect(printMock().mock.calls[0][0]).toMatchObject({ base64: true, width: Math.round(A4_W), height: Math.round(A4_H) });
    expect(Math.round(A4_W)).toBe(595);
    expect(Math.round(A4_H)).toBe(842);
    expect(htmlOf(0)).toContain('@page { size: A4; margin: 0; }');
    expect(htmlOf(0)).toContain('<img');
    expect(htmlOf(0)).toContain('.spacer-top { height: 16mm; }');
    expect(applyLetterhead).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('keeps every page of a long list', async () => {
    printOnce(4);
    const out = await read(await exportHtmlPdf({ html: builder(), fileName: NAME, letterhead: false }));
    expect(out.getPageCount()).toBe(4);
  });

  it('replaces an older file of the same name, and exporting twice gives one file; no temporary file is left', async () => {
    const stale = cacheFile(NAME);
    stale.create();
    stale.writeSync(new Uint8Array([1, 2, 3, 4]));
    const first = await exportHtmlPdf({ html: builder(), fileName: NAME, letterhead: false });
    expect(first.uri).toBe(stale.uri);
    expect(first.size).toBeGreaterThan(1000);
    const second = await exportHtmlPdf({ html: builder(), fileName: NAME, letterhead: false });
    expect(second.uri).toBe(first.uri);
    expect(cacheNames().filter((n) => n.startsWith('Bluemoon-Test'))).toEqual([NAME]);
    expect(cacheNames().filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('deletes the temporary printed file', async () => {
    await exportHtmlPdf({ html: builder(), fileName: NAME, letterhead: false });
    const printed = await printedFiles();
    expect(printed).toHaveLength(1);
    expect(printed[0].exists).toBe(false);
  });

  it('builds from the base64 expo-print returns, without reading the printed file (Expo Go cannot read it)', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 2; i++) doc.addPage([595, 842]).drawText(`base64 page ${i + 1}`, { x: 60, y: 780, size: 12, font });
    const bytes = await doc.save();
    // the uri points at nothing: only the base64 can supply the pages
    printMock().mockResolvedValueOnce({ uri: new File(Paths.cache, 'Print', 'never-written.pdf').uri, numberOfPages: 2, base64: Buffer.from(bytes).toString('base64') });
    expect((await read(await exportHtmlPdf({ html: builder(), fileName: NAME, letterhead: false }))).getPageCount()).toBe(2);
  });

  it('passes a printing failure on, with nothing new in the cache and an older file untouched', async () => {
    const stale = cacheFile(NAME);
    stale.create();
    stale.writeSync(new Uint8Array([9, 9, 9]));
    printMock().mockRejectedValueOnce(new Error('print failed'));
    await expect(exportHtmlPdf({ html: builder(), fileName: NAME, letterhead: false })).rejects.toThrow('print failed');
    expect(Array.from(stale.bytesSync())).toEqual([9, 9, 9]);
    expect(cacheNames().filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses output that is not a PDF: nothing is written and an older file is untouched', async () => {
    const stale = cacheFile(NAME);
    stale.create();
    stale.writeSync(new Uint8Array([7, 7, 7]));
    printMock().mockResolvedValueOnce({ uri: new File(Paths.cache, 'Print', 'x.pdf').uri, numberOfPages: 1, base64: Buffer.from('this is not a pdf file at all').toString('base64') });
    await expect(exportHtmlPdf({ html: builder(), fileName: NAME, letterhead: false })).rejects.toThrow(/did not make a PDF/);
    expect(Array.from(stale.bytesSync())).toEqual([7, 7, 7]);
    expect(cacheNames().filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});

describe('exportHtmlPdf on the letterhead', () => {
  // The letterhead picture is cached after the first successful load, so the "cannot be read" cases run first.
  it('falls back to plain paper and says so when the letterhead picture cannot be read', async () => {
    const quiet = silenceConsoleError();
    mockLetterhead.data = '!!not base64!!';
    const notices: string[] = [];
    const html = builder();
    const out = await exportHtmlPdf({ html, fileName: NAME, letterhead: true, tag: 'lists.test', onNotice: (n) => notices.push(n) });
    mockLetterhead.data = null;
    quiet.mockRestore();

    expect(notices).toEqual(['letterhead-unavailable']);
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), 'lists.test.letterhead.load');
    // plain layout asked for from the start: own logo and company details, 16 mm margins
    expect(html.mock.calls).toEqual([[false]]);
    expect(printMock()).toHaveBeenCalledTimes(1);
    expect(htmlOf(0)).toContain('<img');
    expect(htmlOf(0)).toContain('.spacer-top { height: 16mm; }');
    expect(applyLetterhead).not.toHaveBeenCalled();
    expect((await read(out)).getPageCount()).toBe(1);
  });

  it('also falls back when the embedded picture is empty', async () => {
    const notices: string[] = [];
    mockLetterhead.data = '';
    await exportHtmlPdf({ html: builder(), fileName: NAME, letterhead: true, onNotice: (n) => notices.push(n) });
    mockLetterhead.data = null;
    expect(notices).toEqual(['letterhead-unavailable']);
    expect(htmlOf(0)).toContain('.spacer-top { height: 16mm; }');
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), 'pdfShell.letterhead.load'); // the default tag
  });

  it('puts every page on the letterhead: A4 pages, one picture, 64 / 20 / 16 mm layout, no notice', async () => {
    const notices: string[] = [];
    const html = builder();
    printOnce(3);
    const out = await exportHtmlPdf({ html, fileName: NAME, letterhead: true, onNotice: (n) => notices.push(n) });
    expect(notices).toEqual([]);
    expect(applyLetterhead).toHaveBeenCalledTimes(1);
    expect(html.mock.calls).toEqual([[true]]);

    expect(htmlOf(0)).toContain('.spacer-top { height: 64mm; }');
    expect(htmlOf(0)).toContain('.spacer-bottom { height: 20mm; }');
    expect(htmlOf(0)).not.toContain('<img'); // the letterhead supplies the logo

    const doc = await read(out);
    expect(doc.getPageCount()).toBe(3);
    for (const page of doc.getPages()) {
      expect(page.getSize().width).toBeCloseTo(A4_W, 2);
      expect(page.getSize().height).toBeCloseTo(A4_H, 2);
    }
    expect(imageWidths(doc)).toEqual([1653]);
    for (const f of await printedFiles()) expect(f.exists).toBe(false);
  });

  it('prints the plain page again, with logo and company details, when the letterhead cannot be applied', async () => {
    const quiet = silenceConsoleError();
    jest.mocked(applyLetterhead).mockRejectedValueOnce(new Error('cannot decode the JPEG'));
    const notices: string[] = [];
    const html = builder();
    const out = await exportHtmlPdf({ html, fileName: NAME, letterhead: true, tag: 'lists.test', onNotice: (n) => notices.push(n) });
    quiet.mockRestore();

    expect(notices).toEqual(['letterhead-unavailable']);
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), 'lists.test.letterhead.apply');
    expect(html.mock.calls).toEqual([[true], [false]]);
    expect(printMock()).toHaveBeenCalledTimes(2);
    expect(htmlOf(0)).toContain('.spacer-top { height: 64mm; }'); // first try: letterhead layout
    expect(htmlOf(1)).toContain('.spacer-top { height: 16mm; }'); // second: plain, with its own logo
    expect(htmlOf(1)).toContain('<img');
    expect(htmlOf(1)).toContain('Reg. No. PV 00232701');
    // both printed files are gone and the result is the plain version
    for (const f of await printedFiles()) expect(f.exists).toBe(false);
    expect(imageWidths(await read(out))).toEqual([]);
  });
});
