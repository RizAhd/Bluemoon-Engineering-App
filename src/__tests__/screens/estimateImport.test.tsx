/**
 * Import PDF with an estimate (quotation) PDF: a real one, made by another phone with exportEstimatePdf,
 * read back by the Import screen. The preview shows the estimate where a project PDF shows its name,
 * importing adds (or updates) it with its lines and stages, and Done opens the estimate, not a project.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import ImportScreen from '@/app/import';
import { getSetting, setSetting } from '@/db';
import { loadEstimate } from '@/db/estimates';
import { formatDay, today } from '@/lib/dates';
import { formatLKR } from '@/lib/money';
import { File, openSecondPhone, Paths, queueFilePick, resetDb, type Phone } from '@/test-utils';
import { rows } from '@/test-utils/screenData';
import { expectClean, hasLabel, makeTr, pressLabel, renderScreen, screen, visibleText } from '@/test-utils/screenKit';

jest.setTimeout(120_000);

const E = makeTr('en');

let sender: Phone;
beforeAll(() => {
  sender = openSecondPhone({ name: 'sender', pdf: true });
});
afterAll(() => sender.dispose());

beforeEach(() => {
  resetDb();
  sender.resetDb();
  setSetting('lang', 'en');
  setSetting('theme', 'light');
});

/** An estimate made on the other phone, with three lines and the standard schedule. */
function senderEstimate() {
  const id = sender.estimates.saveEstimate({
    client_name: 'Mr. K. A. Perera',
    client_phone: '071 234 5678',
    title: 'Boundary wall and gate',
    location: 'Welimada',
    issue_day: today(),
    tax_bp: 1800,
  });
  sender.estimates.saveEstimateItem({ estimate_id: id, description: 'Excavation', unit: 'm³', qty_milli: 12_500, rate_cents: 180_000 });
  sender.estimates.saveEstimateItem({ estimate_id: id, description: 'Brick masonry wall', unit: 'm²', qty_milli: 48_250, rate_cents: 480_000 });
  sender.estimates.saveEstimateItem({ estimate_id: id, description: 'Steel gate', unit: 'nos', qty_milli: 1000, rate_cents: 18_500_000 });
  sender.estimates.applyStandardSchedule(id);
  sender.estimates.setEstimateStatus(id, 'sent');
  return id;
}

/** The PDF the other phone would share, picked on this phone. */
async function pickPdfOf(id: string, name = 'estimate.pdf'): Promise<void> {
  const out = await sender.estimatePdf.exportEstimatePdf(id, { letterhead: false, lang: 'en' });
  const bytes = sender.run(() => out.bytesSync());
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  f.writeSync(bytes);
  queueFilePick(f.uri);
}

const onSender = (id: string) => sender.run(() => sender.estimates.loadEstimate(id));

describe('import: an estimate PDF', () => {
  it('previews the estimate (number, client, title, status, total) instead of a project name, then imports it and Done opens it', async () => {
    const id = senderEstimate();
    const sent = onSender(id);
    if (!sent) throw new Error('the sender has no estimate');
    await pickPdfOf(id);

    await renderScreen(<ImportScreen />);
    await pressLabel(E('choosePdf'));
    await waitFor(() => expect(visibleText()).toContain('Mr. K. A. Perera'));
    expectClean('estimate import preview');
    const text = visibleText();
    for (const want of [
      E('estimate'),
      'Boundary wall and gate',
      sent.estimate.number,
      formatDay(sent.estimate.issue_day),
      E('estStatus_sent'),
      formatLKR(sent.total.total_cents), // worked out from the lines in the PDF, with the tax
      E('willChange'),
      E('estimates'),
      E('estimateItems'),
      E('estimateStages'),
      E('importNow'),
    ]) {
      expect(text).toContain(want);
    }
    expect(text).not.toContain('—'); // the dash a project PDF without a name would show
    expect(text).not.toContain(E('estimateOnPhoneUpdate')); // new to this phone
    expect(hasLabel(E('importNow'))).toBe(true);
    expect(rows('SELECT 1 FROM estimates')).toHaveLength(0); // nothing is written before Import now

    await pressLabel(E('importNow'));
    await waitFor(() => expect(visibleText()).toContain(E('importDone')));
    expectClean('estimate import done');
    const here = loadEstimate(id);
    expect(here?.estimate).toMatchObject({ number: sent.estimate.number, client_name: 'Mr. K. A. Perera', status: 'sent', tax_bp: 1800 });
    expect(here?.items).toHaveLength(3);
    expect(here?.payments).toHaveLength(3);
    expect(here?.total).toEqual(sent.total);
    expect(rows('SELECT 1 FROM projects')).toHaveLength(0); // an estimate is not a project

    await pressLabel(E('done'));
    expect(router.replace).toHaveBeenCalledWith(`/estimate/${id}`);
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(getSetting('current_project')).toBeNull(); // no project became the current one
  });

  it('the same PDF again says there is nothing to change', async () => {
    const id = senderEstimate();
    await pickPdfOf(id);
    await renderScreen(<ImportScreen />);
    await pressLabel(E('choosePdf'));
    await waitFor(() => expect(hasLabel(E('importNow'))).toBe(true));
    await pressLabel(E('importNow'));
    await waitFor(() => expect(visibleText()).toContain(E('importDone')));
    await screen.unmount();

    await pickPdfOf(id);
    await renderScreen(<ImportScreen />);
    await pressLabel(E('choosePdf'));
    await waitFor(() => expect(visibleText()).toContain('Mr. K. A. Perera'));
    expect(visibleText()).toContain(E('unchanged'));
    expect(hasLabel(E('importNow'))).toBe(false);
    expect(visibleText()).not.toContain(E('estimateOnPhoneUpdate')); // nothing to update, so no promise of one
  });

  it('a changed copy of an estimate already on this phone says it will be updated, and updates it', async () => {
    const id = senderEstimate();
    await pickPdfOf(id);
    await renderScreen(<ImportScreen />);
    await pressLabel(E('choosePdf'));
    await waitFor(() => expect(hasLabel(E('importNow'))).toBe(true));
    await pressLabel(E('importNow'));
    await waitFor(() => expect(visibleText()).toContain(E('importDone')));
    await screen.unmount();

    // the other phone changes the client and sends the estimate again
    sender.estimates.saveEstimate({ id, client_name: 'Mr. K. A. Perera (Pvt) Ltd', title: 'Boundary wall, gate and paint' });
    await pickPdfOf(id, 'estimate-2.pdf');
    await renderScreen(<ImportScreen />);
    await pressLabel(E('choosePdf'));
    await waitFor(() => expect(visibleText()).toContain('Mr. K. A. Perera (Pvt) Ltd'));
    expect(visibleText()).toContain(E('estimateOnPhoneUpdate'));
    expect(visibleText()).toContain('Boundary wall, gate and paint');

    await pressLabel(E('importNow'));
    await waitFor(() => expect(visibleText()).toContain(E('importDone')));
    expect(loadEstimate(id)?.estimate).toMatchObject({ client_name: 'Mr. K. A. Perera (Pvt) Ltd', title: 'Boundary wall, gate and paint' });
    expect(rows('SELECT 1 FROM estimates')).toHaveLength(1);
  });

  it.each(['si', 'ta'] as const)('every step renders in %s and dark', async (lang) => {
    const id = senderEstimate();
    await pickPdfOf(id);
    setSetting('lang', lang);
    setSetting('theme', 'dark');
    const tr = makeTr(lang);
    await renderScreen(<ImportScreen />);
    await pressLabel(tr('choosePdf'));
    await waitFor(() => expect(visibleText()).toContain('Mr. K. A. Perera'));
    expectClean(`estimate import preview ${lang}`);
    expect(visibleText()).toContain(tr('estimate'));
    expect(visibleText()).toContain(tr('estStatus_sent'));
    expect(visibleText()).toContain(tr('estimateItems'));
    await pressLabel(tr('importNow'));
    await waitFor(() => expect(visibleText()).toContain(tr('importDone')));
    expectClean(`estimate import done ${lang}`);
  });
});
