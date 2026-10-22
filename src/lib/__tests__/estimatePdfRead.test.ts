/**
 * readProjectPdf with PDFs that carry an estimate (bundle kind 'estimate'): they come back the same
 * way a project PDF does ({ status: 'ok', bundle, files }); one that does not carry the estimate it
 * names is damaged; project and backup PDFs behave exactly as before.
 */
import { PDFDocument } from 'pdf-lib';

import { BUNDLE_FORMAT, BUNDLE_VERSION, sha256Hex, type Bundle } from '@/lib/bundle';
import { estimateRowOf, isEstimateBundle, readProjectPdf } from '@/lib/pdf';
import { decodeUtf8, encodeUtf8 } from '@/lib/utf8';

const ESTIMATE_ROW = {
  id: 'e1',
  created_at: '2026-10-22T00:00:00.000Z',
  updated_at: '2026-10-22T00:00:00.000Z',
  deleted_at: null,
  version: 1,
  device_id: 'phone-a',
  number: 'EST-2026-014',
  client_name: 'කමල් පෙරේරා',
  title: 'வேலி கட்டுதல்',
  issue_day: '2026-10-22',
  valid_days: 30,
  discount_cents: 0,
  tax_bp: 0,
  status: 'draft',
};

function estimateBundle(over: Partial<Bundle> = {}): Bundle {
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    kind: 'estimate',
    exported_at: '2026-10-22T10:00:00.000Z',
    device_id: 'phone-a',
    estimate_id: 'e1',
    estimate_number: 'EST-2026-014',
    tables: {
      estimates: [ESTIMATE_ROW],
      estimate_items: [{ id: 'i1', estimate_id: 'e1', position: 1, description: 'Wall', unit: 'm²', qty_milli: 12_500, rate_cents: 1_250_050 }],
      estimate_payments: [{ id: 'p1', estimate_id: 'e1', position: 1, label: 'Advance', percent_bp: 10_000 }],
    },
    ...over,
  };
}

interface PdfOpts {
  /** Replace the stored hash (default: the real one). `null` leaves the hash file out. */
  hash?: string | null;
  /** Store this text instead of the JSON of the bundle. */
  raw?: string;
  extra?: Record<string, Uint8Array>;
}

/** A PDF with the data attached the way exportEstimatePdf / exportProjectPdf do it. */
async function pdfWith(bundle: Bundle | object, opts: PdfOpts = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const json = encodeUtf8(opts.raw ?? JSON.stringify(bundle));
  await doc.attach(json, 'bluemoon-data.json', { mimeType: 'application/json' });
  if (opts.hash !== null) await doc.attach(encodeUtf8(opts.hash ?? (await sha256Hex(json))), 'bluemoon-data.sha256', { mimeType: 'text/plain' });
  for (const [name, bytes] of Object.entries(opts.extra ?? {})) await doc.attach(bytes, name, { mimeType: 'application/octet-stream' });
  return doc.save({ useObjectStreams: true });
}

describe('readProjectPdf with an estimate PDF', () => {
  it('returns it the way a project PDF is returned: { status: "ok", bundle, files }', async () => {
    const res = await readProjectPdf(await pdfWith(estimateBundle()));
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(Object.keys(res).sort()).toEqual(['bundle', 'files', 'status']);
    expect(res.bundle).toEqual(estimateBundle());
    expect(res.bundle.kind).toBe('estimate');
    expect(res.bundle.estimate_id).toBe('e1');
    expect(res.bundle.estimate_number).toBe('EST-2026-014');
    expect(res.bundle.project_name).toBeUndefined();
    expect(res.files).toBeInstanceOf(Map);
    expect(res.files.size).toBe(0);
  });

  it('hands over the rows to merge: the estimate, its items and its stages', async () => {
    const res = await readProjectPdf(await pdfWith(estimateBundle()));
    if (res.status !== 'ok') throw new Error('not readable');
    expect(res.bundle.tables.estimates).toHaveLength(1);
    expect(res.bundle.tables.estimate_items).toHaveLength(1);
    expect(res.bundle.tables.estimate_payments).toHaveLength(1);
    expect(estimateRowOf(res.bundle)).toMatchObject({ id: 'e1', number: 'EST-2026-014', client_name: 'කමල් පෙරේරා', title: 'வேலி கட்டுதல்' });
    expect(isEstimateBundle(res.bundle)).toBe(true);
  });

  it('does not list the data and hash files among the files', async () => {
    const res = await readProjectPdf(await pdfWith(estimateBundle(), { extra: { 'note.txt': new Uint8Array([1, 2, 3]) } }));
    if (res.status !== 'ok') throw new Error('not readable');
    expect([...res.files.keys()]).toEqual(['note.txt']);
  });

  it('is damaged when the PDF does not carry the estimate it names', async () => {
    const cases: Partial<Bundle>[] = [
      { tables: {} },
      { tables: { estimates: [] } },
      { tables: { estimates: [{ ...ESTIMATE_ROW, id: 'someone-else' }] } },
      { tables: { estimate_items: [{ id: 'i1' }] } },
      { estimate_id: undefined },
      { estimate_id: '' },
      { estimate_id: 'other' },
    ];
    for (const over of cases) {
      const bundle = { ...estimateBundle(), ...over };
      expect((await readProjectPdf(await pdfWith(bundle))).status).toBe('damaged');
    }
  });

  it('is damaged when the estimate rows are not a list', async () => {
    const bundle = { ...estimateBundle(), tables: { estimates: 'nope' } };
    expect((await readProjectPdf(await pdfWith(bundle))).status).toBe('damaged');
  });

  it('is damaged when the data was changed after the hash was made, or the hash is missing', async () => {
    const good = estimateBundle();
    const changed = { ...good, tables: { ...good.tables, estimates: [{ ...ESTIMATE_ROW, client_name: 'Someone else' }] } };
    const hashOfGood = await sha256Hex(encodeUtf8(JSON.stringify(good)));
    expect((await readProjectPdf(await pdfWith(changed, { hash: hashOfGood }))).status).toBe('damaged');
    expect((await readProjectPdf(await pdfWith(good, { hash: null }))).status).toBe('damaged');
    expect((await readProjectPdf(await pdfWith(good, { hash: 'abc' }))).status).toBe('damaged');
  });

  it('is damaged when the data is not JSON', async () => {
    expect((await readProjectPdf(await pdfWith({}, { raw: '{ not json' }))).status).toBe('damaged');
  });

  it('is "newer" for a version this app does not know, and "not-ours" for another format', async () => {
    expect((await readProjectPdf(await pdfWith(estimateBundle({ version: BUNDLE_VERSION + 1 })))).status).toBe('newer');
    expect((await readProjectPdf(await pdfWith({ ...estimateBundle(), format: 'something-else' }))).status).toBe('not-ours');
  });

  it('is "not-ours" for a PDF without Bluemoon data and for something that is not a PDF', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect((await readProjectPdf(await doc.save())).status).toBe('not-ours');
    expect((await readProjectPdf(encodeUtf8('not a pdf at all'))).status).toBe('not-ours');
  });

  it('reads the estimate back as typed (Sinhala and Tamil), through the data file itself', async () => {
    const bytes = await pdfWith(estimateBundle());
    const res = await readProjectPdf(bytes);
    if (res.status !== 'ok') throw new Error('not readable');
    expect(decodeUtf8(encodeUtf8(JSON.stringify(res.bundle)))).toContain('කමල් පෙරේරා');
    expect(estimateRowOf(res.bundle)?.title).toBe('வேலி கட்டுதல்');
  });
});

describe('project and backup PDFs are read exactly as before', () => {
  const project: Bundle = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    kind: 'project',
    exported_at: '2026-10-22T10:00:00.000Z',
    device_id: 'phone-a',
    project_id: 'p1',
    project_name: 'Welimada school',
    tables: { projects: [{ id: 'p1', name: 'Welimada school' }] },
  };

  it('a project PDF comes back with its bundle and files', async () => {
    const res = await readProjectPdf(await pdfWith(project, { extra: { 'a.jpg': new Uint8Array([7, 7]) } }));
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.bundle).toEqual(project);
    expect([...res.files.keys()]).toEqual(['a.jpg']);
    expect(isEstimateBundle(res.bundle)).toBe(false);
  });

  it('a project PDF needs no estimate rows, and a backup PDF is read too', async () => {
    expect((await readProjectPdf(await pdfWith(project))).status).toBe('ok');
    expect((await readProjectPdf(await pdfWith({ ...project, kind: 'backup', project_id: undefined, tables: {} }))).status).toBe('ok');
  });

  it('a project PDF that also carries an estimate (a linked one) is still a project PDF', async () => {
    const withEstimate: Bundle = { ...project, tables: { ...project.tables, estimates: [ESTIMATE_ROW] } };
    const res = await readProjectPdf(await pdfWith(withEstimate));
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(isEstimateBundle(res.bundle)).toBe(false);
  });
});

describe('isEstimateBundle / estimateRowOf', () => {
  it('recognise an estimate bundle and find its row', () => {
    expect(isEstimateBundle(estimateBundle())).toBe(true);
    expect(isEstimateBundle(estimateBundle({ kind: 'project' }))).toBe(false);
    expect(isEstimateBundle(estimateBundle({ estimate_id: undefined }))).toBe(false);
    expect(estimateRowOf(estimateBundle())).toBe(ESTIMATE_ROW);
    expect(estimateRowOf(estimateBundle({ estimate_id: 'zzz' }))).toBeNull();
    expect(estimateRowOf(estimateBundle({ tables: {} }))).toBeNull();
  });
});
