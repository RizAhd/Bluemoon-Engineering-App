/**
 * The estimate PDF with the real data layer: an estimate made through the repo is exported on one
 * phone (real loadEstimate, company profile and collectEstimate; expo-print is the harness double)
 * and imported on a second phone from the PDF alone, the way the Import PDF screen does it.
 */
import * as Print from 'expo-print';

import { applyStandardSchedule, deleteEstimate, loadEstimate, saveEstimate, saveEstimateItem } from '@/db/estimates';
import type { Estimate, EstimateTotal } from '@/db/types';
import { saveCompanyProfile } from '@/lib/company';
import { allocatePayments } from '@/lib/estimate';
import { exportEstimatePdf } from '@/lib/estimatePdf';
import { formatLKR } from '@/lib/money';
import { estimateRowOf, isEstimateBundle, readProjectPdf } from '@/lib/pdf';
import { mainPhone, openSecondPhone, resetDb, type Phone } from '@/test-utils';

jest.setTimeout(120_000);

let b: Phone;

beforeAll(() => {
  b = openSecondPhone();
});
afterAll(() => b.dispose());
beforeEach(() => {
  resetDb();
  b.resetDb();
  jest.mocked(Print.printToFileAsync).mockClear();
  saveCompanyProfile({ bank_name: 'Sampath Bank', account_name: 'Bluemoon Engineering (Pvt) Ltd', account_no: '0012-3456-7890', branch: 'Welimada' });
});

const printedHtml = () => (jest.mocked(Print.printToFileAsync).mock.calls[0][0] as { html: string }).html;

function makeEstimate(over: Parameters<typeof saveEstimate>[0] = {}) {
  // a discount can only be set once there are lines to take it off
  const { discount_cents, ...header } = over;
  const id = saveEstimate({
    client_name: 'Mr. K. A. Perera',
    client_phone: '071 234 5678',
    client_address: '45/2, Temple Road, Badulla',
    title: 'Boundary wall and gate',
    location: 'Welimada',
    issue_day: '2026-10-22',
    valid_days: 30,
    ...header,
  });
  saveEstimateItem({ estimate_id: id, description: 'Excavation', unit: 'm³', qty_milli: 12_500, rate_cents: 1_250_050 });
  saveEstimateItem({ estimate_id: id, description: 'Brick masonry wall', unit: 'm²', qty_milli: 48_250, rate_cents: 2_345_675 });
  saveEstimateItem({ estimate_id: id, description: 'Steel gate', unit: 'nos', qty_milli: 1000, rate_cents: 18_500_000 });
  if (discount_cents) saveEstimate({ id, discount_cents });
  return id;
}

describe('estimate PDF with the real data layer', () => {
  it('prints exactly the totals, schedule and company details the database holds', async () => {
    const id = makeEstimate({ tax_bp: 1800, discount_cents: 500_000 });
    applyStandardSchedule(id);
    const loaded = loadEstimate(id);
    if (!loaded) throw new Error('estimate missing');

    await exportEstimatePdf(id, { letterhead: false, lang: 'en' });
    const html = printedHtml();
    const t = loaded.total;
    for (const cents of [t.subtotal_cents, t.tax_cents, t.total_cents]) expect(html).toContain(formatLKR(cents, { forceDecimals: true }));
    expect(html).toContain('Tax (18%)');
    // schedule amounts add up to the total to the cent
    const parts = allocatePayments(t.total_cents, loaded.payments.map((p) => p.percent_bp));
    expect(parts.reduce((a, c) => a + c, 0)).toBe(t.total_cents);
    for (const cents of parts) expect(html).toContain(`<td class="n">${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>`);
    for (const line of ['Sampath Bank', '0012-3456-7890', 'Welimada']) expect(html).toContain(line);
    expect(html).toContain('Mr. K. A. Perera');
  });

  it('is imported on a second phone from the PDF alone, with the same rows and the same totals', async () => {
    const id = makeEstimate({ tax_bp: 1250, notes: 'Rates exclude VAT.' });
    applyStandardSchedule(id);
    const out = await exportEstimatePdf(id, { letterhead: false, lang: 'en' });

    const res = await readProjectPdf(out.bytesSync());
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(isEstimateBundle(res.bundle)).toBe(true);
    expect(res.bundle.estimate_id).toBe(id);
    expect(estimateRowOf(res.bundle)?.number).toBe(loadEstimate(id)?.estimate.number);

    const plan = await b.bundle.applyBundle(res.bundle.tables, res.files);
    expect(plan.counts.inserted).toBe(1 + 3 + 3); // the estimate, 3 lines, 3 stages
    expect(plan.badFiles).toEqual([]);

    const onA = loadEstimate(id);
    const rowB = b.db.first<Estimate>('SELECT * FROM estimates WHERE id = ?', [id]);
    const totalB = b.db.first<EstimateTotal>('SELECT * FROM v_estimate_total WHERE estimate_id = ?', [id]);
    expect(rowB).toEqual(onA?.estimate);
    expect(totalB).toEqual(onA?.total);
    expect(b.db.all('SELECT id FROM estimate_items WHERE estimate_id = ? ORDER BY position', [id])).toHaveLength(3);
    expect(b.db.all('SELECT id FROM estimate_payments WHERE estimate_id = ? ORDER BY position', [id])).toHaveLength(3);

    // importing the same PDF again changes nothing
    const again = await b.bundle.applyBundle(res.bundle.tables, res.files);
    expect(again.counts).toEqual({ inserted: 0, updated: 0, skipped: 7 });
  });

  it('round-trips Sinhala and Tamil text through the letterhead version too', async () => {
    const id = makeEstimate({ client_name: 'කමල් පෙරේරා', title: 'வேலி கட்டுதல் — ශ්‍රී ලංකා', client_address: 'අංක 45, පන්සල් පාර', notes: 'සටහන් — குறிப்புகள்' });
    const out = await exportEstimatePdf(id, { letterhead: true, lang: 'si' });
    expect(out.name).toBe('Estimate-EST-2026-001-කමල්-පෙරේරා.pdf'); // numbered from the year of the issue day

    const res = await readProjectPdf(out.bytesSync());
    if (res.status !== 'ok') throw new Error('not readable');
    await b.bundle.applyBundle(res.bundle.tables, res.files);
    expect(b.db.first<Estimate>('SELECT * FROM estimates WHERE id = ?', [id])).toMatchObject({
      client_name: 'කමල් පෙරේරා',
      title: 'வேலி கட்டுதல் — ශ්‍රී ලංකා',
      client_address: 'අංක 45, පන්සල් පාර',
      notes: 'සටහන් — குறிப்புகள்',
    });
    expect(printedHtml()).toContain('ඇස්තමේන්තුව');
  });

  it('refuses an estimate that was deleted', async () => {
    const id = makeEstimate();
    deleteEstimate(id);
    await expect(exportEstimatePdf(id, { letterhead: false, lang: 'en' })).rejects.toThrow('Estimate not found');
    await expect(exportEstimatePdf('no-such-id', { letterhead: false, lang: 'en' })).rejects.toThrow('Estimate not found');
  });

  it('exports an estimate without lines or stages (a zero total) and it still imports', async () => {
    const id = saveEstimate({ client_name: 'Empty Co', title: 'Nothing yet', issue_day: '2026-10-22' });
    const out = await exportEstimatePdf(id, { letterhead: false, lang: 'ta' });
    expect(printedHtml()).toContain('Rupees Zero Only');
    const res = await readProjectPdf(out.bytesSync());
    if (res.status !== 'ok') throw new Error('not readable');
    const plan = await b.bundle.applyBundle(res.bundle.tables, res.files);
    expect(plan.counts.inserted).toBe(1);
    expect(mainPhone().db.first('SELECT 1 AS ok FROM estimates WHERE id = ?', [id])).toBeTruthy();
  });

  it('uses the profile as saved when the PDF is made, not the one from an earlier export', async () => {
    const id = makeEstimate();
    await exportEstimatePdf(id, { letterhead: false, lang: 'en' });
    expect(printedHtml()).toContain('Sampath Bank');
    jest.mocked(Print.printToFileAsync).mockClear();
    saveCompanyProfile({ bank_name: 'Commercial Bank', phone: '011 222 3333' });
    await exportEstimatePdf(id, { letterhead: false, lang: 'en' });
    expect(printedHtml()).toContain('Commercial Bank');
    expect(printedHtml()).toContain('011 222 3333');
    expect(printedHtml()).not.toContain('Sampath Bank');
  });
});
