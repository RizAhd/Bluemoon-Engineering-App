/**
 * The estimate (quotation) screens driven like a person would, against the real data layer: the whole
 * flow from a new estimate to a project, the messages of every form, the locked state, the discount
 * notice, the confirmations, double taps, and the entries in More, the quick-add sheet, the project hub
 * and the backup screen. The PDF itself is the other engineer's work: exportEstimatePdf is a double here
 * (the import of a real estimate PDF is in estimateImport.test.tsx).
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';

import AddSheet from '@/app/add';
import BackupScreen from '@/app/backup';
import CompanyScreen from '@/app/company';
import EstimateForm from '@/app/estimate/form';
import EstimateHub from '@/app/estimate/[id]';
import EstimatesScreen from '@/app/estimate/index';
import EstimateItemScreen from '@/app/estimate/item';
import EstimatePaymentScreen from '@/app/estimate/payment';
import MoreScreen from '@/app/more';
import ProjectDetail from '@/app/project/[id]';
import { ToastHost } from '@/components/ui/feedback';
import { getDb, getSetting, setSetting } from '@/db';
import {
  applyStandardSchedule,
  createProjectFromEstimate,
  loadEstimate,
  saveEstimate,
  saveEstimateItem,
  saveEstimatePayment,
  setEstimateStatus,
} from '@/db/estimates';
import { saveProject } from '@/db/repo';
import type { Estimate, EstimateTotal } from '@/db/types';
import { getCompanyProfile } from '@/lib/company';
import { today } from '@/lib/dates';
import { allocatePayments } from '@/lib/estimate';
import { exportEstimatePdf } from '@/lib/estimatePdf';
import { formatLKR } from '@/lib/money';
import { mockAlert, resetDb } from '@/test-utils';
import { rows } from '@/test-utils/screenData';
import {
  act,
  expectClean,
  fireEvent,
  hasLabel,
  inputValue,
  lastAlert,
  makeTr,
  pressAlertButton,
  pressLabel,
  pressText,
  renderScreen,
  screen,
  setRouteParams,
  settle,
  takeConsole,
  typeInto,
  visibleText,
} from '@/test-utils/screenKit';

jest.mock('@/lib/estimatePdf', () => ({ __esModule: true, exportEstimatePdf: jest.fn(), estimatePdfName: jest.fn() }));

const E = makeTr('en');
const shown = (node: React.ReactElement) => (
  <>
    {node}
    <ToastHost />
  </>
);

beforeEach(() => {
  resetDb();
  setSetting('lang', 'en');
  setSetting('theme', 'light');
  jest.mocked(exportEstimatePdf).mockResolvedValue({ uri: 'file:///cache/Estimate-EST-001-Perera.pdf' } as never);
});

// ---------------------------------------------------------------- data helpers

const estimates = () => rows<Estimate>('SELECT * FROM estimates WHERE deleted_at IS NULL ORDER BY created_at, rowid');
const view = (id: string) => rows<EstimateTotal>('SELECT * FROM v_estimate_total WHERE estimate_id = ?', [id])[0];
const line = (estimate_id: string, description: string, qty_milli: number, rate_cents: number, unit = 'nos') =>
  saveEstimateItem({ estimate_id, description, unit, qty_milli, rate_cents });

/** A draft with two lines (Rs 1,000 and Rs 2,000 = Rs 3,000) and a discount of Rs 2,500. */
function draftWithDiscount() {
  const id = saveEstimate({ client_name: 'Mr. Perera', title: 'Boundary wall', issue_day: today() });
  const first = line(id, 'Excavation', 1000, 100_000);
  const second = line(id, 'Masonry', 1000, 200_000);
  saveEstimate({ id, discount_cents: 250_000 });
  return { id, first, second };
}

/** A draft worth exactly Rs 1,000 (no discount, no tax), for the stage amounts. */
function plainEstimate() {
  const id = saveEstimate({ client_name: 'Mr. Perera', title: 'Gate', issue_day: today() });
  line(id, 'Gate', 1000, 100_000);
  return id;
}

// ---------------------------------------------------------------- the whole flow

describe('from a new estimate to a project and back to a draft', () => {
  it('create, three items, the standard schedule, share, sent, accepted (locked), project, reopen', async () => {
    const alert = mockAlert();

    // 1. a new estimate: two fields and Save, then the hub takes the place of the form
    await renderScreen(shown(<EstimateForm />));
    await typeInto(E('clientName'), 'Mr. Perera');
    await typeInto(E('estimateTitle'), 'Boundary wall');
    await pressLabel(E('save'));
    const [created] = estimates();
    expect(created).toMatchObject({ client_name: 'Mr. Perera', title: 'Boundary wall', status: 'draft', valid_days: 30, issue_day: today(), project_id: null });
    expect(created.number).toMatch(/^EST-\d{4}-001$/);
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(`/estimate/${created.id}`);
    expect(router.back).not.toHaveBeenCalled();
    const id = created.id;
    await screen.unmount();

    // 2. three items: the first two with "Save and add another" (the unit stays, the rest is cleared), the last with Save
    setRouteParams({ estimateId: id });
    await renderScreen(shown(<EstimateItemScreen />));
    await typeInto(E('description'), 'Excavation');
    await pressLabel('cu.m');
    await typeInto(E('quantity'), '12.5');
    await typeInto(E('rate'), '1,800');
    expect(visibleText()).toContain('Rs 22,500'); // the live amount
    await pressLabel(E('saveAndAddAnother'));
    expect(visibleText()).toContain(E('itemAdded'));
    expect(inputValue(E('description'))).toBe('');
    expect(inputValue(E('quantity'))).toBe('');
    expect(inputValue(E('rate'))).toBe('');
    expect(inputValue(E('otherUnit'))).toBe('cu.m');
    expect(router.back).not.toHaveBeenCalled();

    await typeInto(E('description'), 'Brick masonry wall');
    await pressLabel('sq.m');
    await typeInto(E('quantity'), '48,25'); // a comma is a decimal point too
    await typeInto(E('rate'), '4800');
    await pressLabel(E('saveAndAddAnother'));
    await typeInto(E('description'), 'Steel gate');
    await pressLabel('nos');
    await typeInto(E('quantity'), '1');
    await typeInto(E('rate'), '185000');
    await pressLabel(E('save'));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(loadEstimate(id)?.items.map((i) => [i.position, i.description, i.unit, i.qty_milli, i.rate_cents])).toEqual([
      [1, 'Excavation', 'cu.m', 12_500, 180_000],
      [2, 'Brick masonry wall', 'sq.m', 48_250, 480_000],
      [3, 'Steel gate', 'nos', 1000, 18_500_000],
    ]);
    await screen.unmount();

    // 3. the hub: totals, then the standard schedule in one tap
    setRouteParams({ id });
    await renderScreen(shown(<EstimateHub />));
    const total = view(id);
    expect(total.subtotal_cents).toBe(2_250_000 + 23_160_000 + 18_500_000);
    expect(total.total_cents).toBe(total.subtotal_cents);
    expect(visibleText()).toContain(formatLKR(total.total_cents));
    expect(visibleText()).toContain(E('noStages'));
    await pressLabel(E('useStandardSchedule'));
    expect(alert).not.toHaveBeenCalled(); // nothing to replace, so no question
    const stages = loadEstimate(id)?.payments ?? [];
    expect(stages.map((p) => [p.label, p.percent_bp])).toEqual([
      ['Advance', 3000],
      ['Progress payment', 4000],
      ['On completion', 3000],
    ]);
    const amounts = allocatePayments(view(id).total_cents, stages.map((p) => p.percent_bp));
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(view(id).total_cents);
    for (const cents of amounts) expect(visibleText()).toContain(formatLKR(cents));
    for (const p of ['30 %', '40 %']) expect(visibleText()).toContain(p);
    expect(visibleText()).not.toContain(E('unscheduledPercent', { pct: '0' }));

    // 4. share: letterhead and Sinhala, remembered; the PDF is made with those choices and handed to the share sheet
    expect(hasLabel(E('estimateLetterheadHint'))).toBe(false);
    await pressLabel(E('shareEstimatePdf'));
    expect(visibleText()).toContain(E('shareEstimate'));
    expect(visibleText()).toContain(E('pdfLanguage'));
    await pressLabel(`${E('letterheadOption')}. ${E('estimateLetterheadHint')}`);
    await pressLabel('සිංහල');
    expect(getSetting('estimate_letterhead')).toBe('1');
    expect(getSetting('estimate_lang')).toBe('si');
    await pressLabel(E('shareNow'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(exportEstimatePdf).toHaveBeenCalledTimes(1);
    expect(exportEstimatePdf).toHaveBeenCalledWith(id, expect.objectContaining({ letterhead: true, lang: 'si' }));
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/Estimate-EST-001-Perera.pdf', expect.objectContaining({ mimeType: 'application/pdf' }));
    expect(visibleText()).not.toContain(E('pdfLanguage')); // the sheet is gone

    // 5. after sharing a draft the app offers "Mark as sent": one tap
    await waitFor(() => expect(alert.mock.calls.at(-1)?.[0]).toBe(E('markSentTitle')));
    await pressAlertButton(alert, E('markAsSent'));
    expect(estimates()[0].status).toBe('sent');
    expect(visibleText()).toContain(E('statusSetTo', { status: E('estStatus_sent') }));

    // 6. accepted: the lines and stages are locked, and the screen does not offer to touch them
    await pressLabel(E('markAsAccepted'));
    expect(estimates()[0].status).toBe('accepted');
    for (const gone of [E('addItem'), E('addStage'), E('useStandardSchedule'), E('discountAndTax')]) expect(hasLabel(gone)).toBe(false);
    expect(visibleText()).toContain(E('estimateLockedCaption'));
    await fireEvent.press(screen.getByText('Steel gate'));
    await fireEvent.press(screen.getByText('Advance'));
    expect(router.push).not.toHaveBeenCalled(); // rows are not buttons any more

    // 7. create the project: a question first, then the project with the estimate's total as its contract value
    await pressLabel(E('createProjectFromEstimate'));
    expect(lastAlert(alert).title).toBe(E('createProjectTitle'));
    expect(lastAlert(alert).message).toContain('Boundary wall');
    expect(lastAlert(alert).message).toContain(formatLKR(total.total_cents));
    expect(rows('SELECT 1 FROM projects')).toHaveLength(0);
    await pressAlertButton(alert, E('createProject'));
    await pressAlertButton(alert, E('createProject')); // a second tap changes nothing
    const projects = rows<{ id: string; name: string; client: string; contract_cents: number; status: string }>('SELECT * FROM projects WHERE deleted_at IS NULL');
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ name: 'Boundary wall', client: 'Mr. Perera', contract_cents: total.total_cents, status: 'active' });
    expect(estimates()[0].project_id).toBe(projects[0].id);
    expect(router.push).toHaveBeenCalledWith(`/project/${projects[0].id}`);
    expect(router.push).toHaveBeenCalledTimes(1);
    // the hub now links to it instead of offering to create it again
    expect(hasLabel(E('createProjectFromEstimate'))).toBe(false);
    await pressLabel(E('openProject'));
    expect(router.push).toHaveBeenLastCalledWith(`/project/${projects[0].id}`);

    // 8. reopen as a draft: editable again, and still linked to its project
    await pressLabel(E('reopenAsDraft'));
    expect(estimates()[0].status).toBe('draft');
    expect(hasLabel(E('addItem'))).toBe(true);
    expect(hasLabel(E('addStage'))).toBe(false); // the standard schedule already makes 100 %: nothing left to add
    expect(hasLabel(E('openProject'))).toBe(true);
    expect(visibleText()).not.toContain(E('estimateLockedCaption'));
    expectClean('estimate hub after the whole flow');
  });

  it('the share sheet remembers its last choices and starts on English without a letterhead', async () => {
    const { id } = draftWithDiscount();
    setRouteParams({ id });
    await renderScreen(<EstimateHub />);
    await pressLabel(E('shareEstimatePdf')); // the header's Share opens the message sheet now; this button opens the PDF sheet
    const letterhead = () => screen.getByLabelText(`${E('letterheadOption')}. ${E('estimateLetterheadHint')}`).props.accessibilityState.checked;
    const chosen = (name: string) => screen.getByLabelText(name).props.accessibilityState.checked;
    expect(letterhead()).toBe(false);
    expect(chosen('English')).toBe(true);
    await pressLabel('தமிழ்');
    await pressLabel(`${E('letterheadOption')}. ${E('estimateLetterheadHint')}`);
    await screen.unmount();

    await renderScreen(<EstimateHub />); // the next time the sheet opens on the same choices
    await pressLabel(E('shareEstimatePdf'));
    expect(letterhead()).toBe(true);
    expect(chosen('தமிழ்')).toBe(true);
    expect(chosen('English')).toBe(false);
    await pressLabel(E('shareNow'));
    await waitFor(() => expect(exportEstimatePdf).toHaveBeenCalledWith(id, expect.objectContaining({ letterhead: true, lang: 'ta' })));
  });

  it('a share that fails says so and leaves the estimate a draft; a letterhead that could not load is told in a message', async () => {
    const alert = mockAlert();
    const { id } = draftWithDiscount();
    setRouteParams({ id });
    await renderScreen(shown(<EstimateHub />));

    jest.mocked(exportEstimatePdf).mockRejectedValueOnce(new Error('disk full'));
    await pressLabel(E('shareEstimatePdf'));
    await pressLabel(E('shareNow'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(E('errorTitle'), expect.stringContaining(E('somethingWrong'))));
    takeConsole(); // the failure is logged in development
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(estimates()[0].status).toBe('draft');
    expect(visibleText()).toContain(E('pdfLanguage')); // the sheet stays open for another try

    jest.mocked(exportEstimatePdf).mockImplementationOnce(async (_id, opts) => {
      opts.onNotice?.('letterhead-unavailable');
      return { uri: 'file:///cache/plain.pdf' } as never;
    });
    await pressLabel(E('shareNow'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(visibleText()).toContain(E('letterheadUnavailable'));
  });

  it('a double tap on Share makes one PDF', async () => {
    const { id } = draftWithDiscount();
    mockAlert();
    let release!: () => void;
    jest.mocked(exportEstimatePdf).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ uri: 'file:///cache/x.pdf' } as never);
        }),
    );
    setRouteParams({ id });
    await renderScreen(<EstimateHub />);
    await pressLabel(E('shareEstimatePdf'));
    const share = screen.getAllByLabelText(E('shareNow'), { exact: true })[0];
    await fireEvent.press(share);
    await fireEvent.press(share); // the PDF is still being made
    expect(exportEstimatePdf).toHaveBeenCalledTimes(1);
    expect(hasLabel(E('exporting'))).toBe(true); // the busy button is labelled with its work
    await act(async () => release());
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(exportEstimatePdf).toHaveBeenCalledTimes(1);
    expect(id).toBe(estimates()[0].id);
  });

  it('sharing an estimate that is already sent does not ask to mark it as sent again', async () => {
    const alert = mockAlert();
    const { id } = draftWithDiscount();
    setEstimateStatus(id, 'sent');
    setRouteParams({ id });
    await renderScreen(<EstimateHub />);
    await pressLabel(E('shareEstimatePdf'));
    await pressLabel(E('shareNow'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    await settle();
    expect(alert).not.toHaveBeenCalled();
    expect(estimates()[0].status).toBe('sent');
  });

  it('a declined or sent estimate offers the right status actions', async () => {
    const { id } = draftWithDiscount();
    setRouteParams({ id });
    await renderScreen(shown(<EstimateHub />));
    const labels = [E('markAsSent'), E('markAsAccepted'), E('markAsDeclined'), E('backToDraft'), E('reopenAsDraft')];
    const offered = () => labels.filter((l) => hasLabel(l));
    expect(offered()).toEqual([E('markAsSent'), E('markAsAccepted')]); // draft
    await pressLabel(E('markAsSent'));
    expect(offered()).toEqual([E('markAsAccepted'), E('markAsDeclined'), E('backToDraft')]); // sent
    await pressLabel(E('markAsDeclined'));
    expect(estimates()[0].status).toBe('declined');
    expect(offered()).toEqual([E('reopenAsDraft')]); // declined: lines stay editable
    expect(hasLabel(E('addItem'))).toBe(true);
    expect(hasLabel(E('createProjectFromEstimate'))).toBe(false); // only an accepted estimate becomes a project
    await pressLabel(E('reopenAsDraft'));
    expect(estimates()[0].status).toBe('draft');
  });
});

// ---------------------------------------------------------------- a project that is not on this phone

describe('an estimate linked to a project that is not on this phone', () => {
  it('shows the caption instead of the Create project button, and Open project only when the project is here', async () => {
    const { id } = draftWithDiscount();
    setEstimateStatus(id, 'accepted');
    // the link points at a project that never reached this phone (the estimate came in a PDF from another phone)
    getDb().execSync('PRAGMA foreign_keys = OFF');
    getDb().runSync("UPDATE estimates SET project_id = 'project-on-another-phone' WHERE id = ?", [id]);
    getDb().execSync('PRAGMA foreign_keys = ON');
    setRouteParams({ id });
    await renderScreen(<EstimateHub />);
    expect(visibleText()).toContain(E('projectOnOtherPhone'));
    expect(hasLabel(E('createProjectFromEstimate'))).toBe(false);
    expect(hasLabel(E('openProject'))).toBe(false);
  });
});

// ---------------------------------------------------------------- the estimate form

describe('estimate form', () => {
  it('says what is missing, one message at a time, under the field and in a toast; More details opens itself for a message inside it', async () => {
    await renderScreen(shown(<EstimateForm />));

    await pressLabel(E('save'));
    expect(screen.getAllByText(E('errEstimateClient'))).toHaveLength(2); // under the field and in the toast
    expect(estimates()).toHaveLength(0);
    expect(router.replace).not.toHaveBeenCalled();

    await typeInto(E('clientName'), 'Mr. Perera');
    expect(screen.getAllByText(E('errEstimateClient'))).toHaveLength(1); // typing clears the message under the field
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errEstimateTitle'));

    await typeInto(E('estimateTitle'), 'Boundary wall');
    await typeInto(E('numberOfDays'), '400');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errValidDays'));
    await typeInto(E('numberOfDays'), 'abc');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errValidDays'));
    await pressLabel(E('daysCount', { n: 15 })); // a chip fills the days field
    expect(inputValue(E('numberOfDays'))).toBe('15');
    expect(estimates()).toHaveLength(0);

    // the messages that belong to the group open it, even when it was folded away again
    expect(hasLabel(E('taxPercent'))).toBe(false);
    await pressText(E('moreDetails'));
    await typeInto(E('taxPercent'), '120');
    await pressText(E('moreDetails'));
    expect(hasLabel(E('taxPercent'))).toBe(false);
    await pressLabel(E('save'));
    expect(hasLabel(E('taxPercent'))).toBe(true);
    expect(visibleText()).toContain(E('errTax'));
    await typeInto(E('taxPercent'), '18,5');
    // no lines yet, so no discount field: it says where the discount is added instead
    expect(hasLabel(E('discount'))).toBe(false);
    expect(visibleText()).toContain(E('discountAfterItems'));
    await pressLabel(E('save'));
    expect(estimates()).toHaveLength(1);
    expect(estimates()[0]).toMatchObject({ valid_days: 15, tax_bp: 1850, discount_cents: 0 });
  });

  it('an estimate cannot lose its number', async () => {
    const { id } = draftWithDiscount();
    setRouteParams({ id, more: '1' });
    await renderScreen(shown(<EstimateForm />));
    expect(inputValue(E('estimateNumber'))).toBe(estimates()[0].number);
    await typeInto(E('estimateNumber'), '   ');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errEstimateNumber')); // an estimate cannot lose its number
    expect(router.back).not.toHaveBeenCalled();
  });

  it('a double tap on Save makes one estimate and opens its hub once', async () => {
    await renderScreen(<EstimateForm />);
    await typeInto(E('clientName'), 'Mr. Perera');
    await typeInto(E('estimateTitle'), 'Boundary wall');
    const save = screen.getAllByLabelText(E('save'), { exact: true })[0];
    await fireEvent.press(save);
    await fireEvent.press(save);
    expect(estimates()).toHaveLength(1);
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(rows("SELECT 1 FROM audit_log WHERE table_name = 'estimates'")).toHaveLength(1);
  });

  it('a new estimate starts with the next number, the standard terms and the standard validity from Company and bank details', async () => {
    setSetting('company_default_terms', 'Prices exclude VAT.');
    setSetting('company_default_valid_days', '45');
    saveEstimate({ client_name: 'First', title: 'One', issue_day: today() });
    await renderScreen(<EstimateForm />);
    expect(inputValue(E('numberOfDays'))).toBe('45');
    await pressText(E('moreDetails'));
    expect(inputValue(E('estimateNumber'))).toMatch(/^EST-\d{4}-002$/);
    expect(inputValue(E('terms'))).toBe('Prices exclude VAT.');
    await typeInto(E('clientName'), 'Second');
    await typeInto(E('estimateTitle'), 'Two');
    await pressLabel(E('save'));
    expect(estimates()[1]).toMatchObject({ valid_days: 45, terms: 'Prices exclude VAT.' });
    expect(estimates()[1].number).toMatch(/^EST-\d{4}-002$/);
  });

  it('editing saves and goes back (it does not open another hub); an accepted estimate cannot change discount or tax', async () => {
    const { id } = draftWithDiscount();
    setEstimateStatus(id, 'accepted');
    setRouteParams({ id, more: '1' });
    await renderScreen(<EstimateForm />);
    expect(screen.getByLabelText(E('discount')).props.editable).toBe(false);
    expect(screen.getByLabelText(E('taxPercent')).props.editable).toBe(false);
    expect(visibleText()).toContain(E('fieldLockedAccepted'));
    await typeInto(E('clientName'), 'Mr. A. Perera');
    await pressLabel(E('save'));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(estimates()[0]).toMatchObject({ client_name: 'Mr. A. Perera', discount_cents: 250_000 });
  });
});

// ---------------------------------------------------------------- one line

describe('estimate item form', () => {
  it('asks for the description, the quantity and the rate in that order, and refuses an amount that is too large', async () => {
    const { id } = draftWithDiscount();
    const before = loadEstimate(id)?.items.length;
    setRouteParams({ estimateId: id });
    await renderScreen(shown(<EstimateItemScreen />));

    await pressLabel(E('save'));
    expect(screen.getAllByText(E('errItemDescription'))).toHaveLength(2);
    await typeInto(E('description'), 'Steel gate');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errQty'));
    await typeInto(E('quantity'), '1.2345'); // a fourth decimal is refused
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errQty'));
    await typeInto(E('quantity'), '2');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errAmount')); // no rate yet
    await typeInto(E('quantity'), '1000000');
    await typeInto(E('rate'), '20,000,000');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errAmountTooLarge'));
    expect(loadEstimate(id)?.items).toHaveLength(before ?? -1);
    expect(router.back).not.toHaveBeenCalled();
  });

  it('a double tap on Save adds one line and goes back once', async () => {
    const { id } = draftWithDiscount();
    setRouteParams({ estimateId: id });
    await renderScreen(<EstimateItemScreen />);
    await typeInto(E('description'), 'Steel gate');
    await typeInto(E('quantity'), '1');
    await typeInto(E('rate'), '1000');
    const save = screen.getAllByLabelText(E('save'), { exact: true })[0];
    await fireEvent.press(save);
    await fireEvent.press(save);
    expect(loadEstimate(id)?.items).toHaveLength(3);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('lines that no longer add up to the discount lower it, and the screen says so (save, edit and delete)', async () => {
    const { id, first, second } = draftWithDiscount();
    expect(view(id).discount_cents).toBe(250_000);

    // cheapen the second line from Rs 2,000 to Rs 1,000: the lines add up to Rs 2,000, the discount comes down to that
    setRouteParams({ id: second, estimateId: id });
    await renderScreen(shown(<EstimateItemScreen />));
    await typeInto(E('rate'), '1000');
    await pressLabel(E('save'));
    expect(view(id).subtotal_cents).toBe(200_000);
    expect(view(id).discount_cents).toBe(200_000);
    expect(visibleText()).toContain(E('discountLowered', { amount: 'Rs 2,000' }));
    expect(visibleText()).not.toContain(E('savedOnPhone')); // the notice replaced it
    await screen.unmount();

    // an edit that leaves the discount alone says nothing about it
    setRouteParams({ id: first, estimateId: id });
    await renderScreen(shown(<EstimateItemScreen />));
    await typeInto(E('description'), 'Excavation, rock');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('savedOnPhone'));
    expect(visibleText()).not.toContain('Discount lowered');
    await screen.unmount();

    // removing a line is confirmed first, and brings the discount down to what is left
    jest.mocked(router.back).mockClear();
    const alert = mockAlert();
    setRouteParams({ id: second, estimateId: id });
    await renderScreen(shown(<EstimateItemScreen />));
    await pressLabel(E('delete'));
    expect(lastAlert(alert).title).toBe(E('confirmDelete'));
    expect(loadEstimate(id)?.items).toHaveLength(2);
    await pressAlertButton(alert, E('delete'));
    expect(loadEstimate(id)?.items).toHaveLength(1);
    expect(view(id).discount_cents).toBe(100_000);
    expect(visibleText()).toContain(E('discountLowered', { amount: 'Rs 1,000' }));
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------- one stage

describe('estimate payment stage form', () => {
  it('asks for a name and a share, refuses more than 100 %, and shows the amount and what is still free while typing', async () => {
    const id = plainEstimate(); // total Rs 1,000
    saveEstimatePayment({ estimate_id: id, label: 'Advance', percent_bp: 3000 });
    setRouteParams({ estimateId: id });
    await renderScreen(shown(<EstimatePaymentScreen />));
    expect(visibleText()).toContain(E('percentAvailable', { pct: '70' }));

    await pressLabel(E('save'));
    expect(screen.getAllByText(E('errStageLabel'))).toHaveLength(2);
    await pressLabel('Retention'); // a chip fills the name
    expect(inputValue(E('stageName'))).toBe('Retention');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errPercent'));
    await typeInto(E('stagePercent'), '80');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errScheduleOver'));
    expect(loadEstimate(id)?.payments).toHaveLength(1);

    await typeInto(E('stagePercent'), '12,5');
    expect(visibleText()).toContain('Rs 125'); // 12.5 % of Rs 1,000
    await pressLabel(E('save'));
    expect(loadEstimate(id)?.payments.map((p) => [p.label, p.percent_bp])).toEqual([
      ['Advance', 3000],
      ['Retention', 1250],
    ]);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('the last stage of a complete schedule shows the remainder, so the stage amounts add up to the total to the cent', async () => {
    const id = saveEstimate({ client_name: 'Mr. Perera', title: 'Gate', issue_day: today() });
    line(id, 'Gate', 1000, 100_001); // Rs 1,000.01: 30 % and 40 % round down, the last stage takes the rest
    applyStandardSchedule(id);
    const [advance, progress, last] = loadEstimate(id)!.payments;
    setRouteParams({ id: last.id, estimateId: id });
    await renderScreen(<EstimatePaymentScreen />);
    expect(visibleText()).toContain('Rs 300.01');
    await screen.unmount();

    setRouteParams({ id: advance.id, estimateId: id });
    await renderScreen(<EstimatePaymentScreen />);
    expect(visibleText()).toContain('Rs 300'); // the first stage is its plain share
    expect(visibleText()).not.toContain('Rs 300.01');
    expect(progress.percent_bp).toBe(4000);
  });

  it('editing a stage keeps its place, and its delete is confirmed', async () => {
    const id = plainEstimate();
    applyStandardSchedule(id);
    const middle = loadEstimate(id)!.payments[1];
    const alert = mockAlert();
    setRouteParams({ id: middle.id, estimateId: id });
    await renderScreen(shown(<EstimatePaymentScreen />));
    expect(inputValue(E('stagePercent'))).toBe('40');
    expect(visibleText()).toContain(E('percentAvailable', { pct: '0' }));
    await typeInto(E('stagePercent'), '30');
    expect(visibleText()).toContain('Rs 300'); // 30 % of Rs 1,000
    await pressLabel(E('save'));
    expect(loadEstimate(id)?.payments.map((p) => [p.label, p.percent_bp])).toEqual([
      ['Advance', 3000],
      ['Progress payment', 3000],
      ['On completion', 3000],
    ]);
    await screen.unmount();

    setRouteParams({ id: middle.id, estimateId: id });
    await renderScreen(shown(<EstimatePaymentScreen />));
    await pressLabel(E('delete'));
    expect(lastAlert(alert).title).toBe(E('confirmDelete'));
    expect(loadEstimate(id)?.payments).toHaveLength(3);
    await pressAlertButton(alert, E('delete'));
    expect(loadEstimate(id)?.payments.map((p) => p.label)).toEqual(['Advance', 'On completion']);
  });
});

// ---------------------------------------------------------------- the hub's own questions

describe('estimate hub: confirmations', () => {
  it('Use standard schedule asks before it replaces stages that are there, and replaces them only when told to', async () => {
    const alert = mockAlert();
    const { id } = draftWithDiscount();
    saveEstimatePayment({ estimate_id: id, label: 'Deposit', percent_bp: 2000 });
    setRouteParams({ id });
    await renderScreen(shown(<EstimateHub />));
    expect(visibleText()).toContain(E('unscheduledPercent', { pct: '80' }));

    await pressLabel(E('useStandardSchedule'));
    expect(lastAlert(alert).title).toBe(E('replaceScheduleTitle'));
    expect(lastAlert(alert).buttons.map((b) => b.text)).toEqual([E('cancel'), E('replace')]);
    expect(loadEstimate(id)?.payments.map((p) => p.label)).toEqual(['Deposit']); // nothing changed yet

    await pressAlertButton(alert, E('replace'));
    expect(loadEstimate(id)?.payments.map((p) => [p.label, p.percent_bp])).toEqual([
      ['Advance', 3000],
      ['Progress payment', 4000],
      ['On completion', 3000],
    ]);
    expect(visibleText()).not.toContain('Deposit');
    expect(visibleText()).not.toContain(E('unscheduledPercent', { pct: '80' }));
  });

  it('Delete asks first, then hides the estimate with its lines and stages and leaves the screen once', async () => {
    const alert = mockAlert();
    const { id } = draftWithDiscount();
    applyStandardSchedule(id);
    setRouteParams({ id });
    await renderScreen(shown(<EstimateHub />));
    await pressLabel(E('deleteEstimate'));
    expect(lastAlert(alert).title).toBe(E('confirmDelete'));
    expect(lastAlert(alert).buttons.at(-1)).toMatchObject({ text: E('delete'), style: 'destructive' }); // the destructive button is last
    expect(estimates()).toHaveLength(1);
    expect(router.back).not.toHaveBeenCalled();

    await pressAlertButton(alert, E('delete'));
    await pressAlertButton(alert, E('delete')); // a second tap changes nothing
    expect(estimates()).toHaveLength(0);
    expect(rows('SELECT 1 FROM estimates WHERE id = ? AND deleted_at IS NOT NULL', [id])).toHaveLength(1); // kept, soft deleted
    expect(rows('SELECT 1 FROM estimate_items WHERE estimate_id = ? AND deleted_at IS NULL', [id])).toHaveLength(0);
    expect(rows('SELECT 1 FROM estimate_payments WHERE estimate_id = ? AND deleted_at IS NULL', [id])).toHaveLength(0);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(visibleText()).toContain(E('deleted'));
  });

  it('Duplicate makes one new draft with the same lines and opens it; a double tap does not make two', async () => {
    const { id } = draftWithDiscount();
    applyStandardSchedule(id);
    setEstimateStatus(id, 'sent');
    setRouteParams({ id });
    await renderScreen(shown(<EstimateHub />));
    await pressLabel(E('duplicateEstimate'));
    await pressLabel(E('duplicateEstimate'));
    const all = estimates();
    expect(all).toHaveLength(2);
    const copy = all[1];
    expect(copy).toMatchObject({ status: 'draft', client_name: 'Mr. Perera', project_id: null });
    expect(copy.id).not.toBe(id);
    expect(loadEstimate(copy.id)?.items).toHaveLength(2);
    expect(loadEstimate(copy.id)?.payments).toHaveLength(3);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(`/estimate/${copy.id}`);
  });

  it('the shortcuts open the right screens with the right ids', async () => {
    const { id, first } = draftWithDiscount();
    setRouteParams({ id });
    await renderScreen(<EstimateHub />);
    await pressLabel(E('addItem'));
    expect(router.push).toHaveBeenLastCalledWith(`/estimate/item?estimateId=${id}`);
    await pressText('Excavation');
    expect(router.push).toHaveBeenLastCalledWith(`/estimate/item?estimateId=${id}&id=${first}`);
    await pressLabel(E('addStage'));
    expect(router.push).toHaveBeenLastCalledWith(`/estimate/payment?estimateId=${id}`);
    await pressLabel(E('discountAndTax'));
    expect(router.push).toHaveBeenLastCalledWith(`/estimate/form?id=${id}&more=1`);
    await pressLabel(E('editDetails'), 0);
    expect(router.push).toHaveBeenLastCalledWith(`/estimate/form?id=${id}`);
    await pressLabel(E('addBankDetails'));
    expect(router.push).toHaveBeenLastCalledWith('/company');
  });
});

// ---------------------------------------------------------------- the list

describe('estimate list', () => {
  /** Estimates number `from` to `to`: Client 1 / Job 1 ..., with every status in turn (a multiple of 4 stays a draft). */
  const make = (to: number, from = 1) => {
    const statuses = ['draft', 'sent', 'accepted', 'declined'] as const;
    for (let i = from; i <= to; i++) {
      const id = saveEstimate({ client_name: `Client ${i}`, title: `Job ${i}`, issue_day: today() });
      line(id, 'Work', 1000, i * 100_000);
      if (i % 4) setEstimateStatus(id, statuses[i % 4]);
    }
  };

  it('a status nobody has is a disabled chip', async () => {
    for (let i = 1; i <= 6; i++) saveEstimate({ client_name: `Draft ${i}`, title: `Job ${i}`, issue_day: today() });
    await renderScreen(<EstimatesScreen />);
    expect(hasLabel(E('all'))).toBe(true); // six estimates: the chips are there
    expect(screen.getByLabelText(`${E('estStatus_declined')} 0`).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText(`${E('estStatus_draft')} 6`).props.accessibilityState.disabled).toBe(false);
  });

  it('opens an estimate, and New estimate opens the form', async () => {
    make(2);
    await renderScreen(<EstimatesScreen />);
    await pressText('Client 2');
    expect(router.push).toHaveBeenLastCalledWith(`/estimate/${estimates().find((e) => e.client_name === 'Client 2')?.id}`);
    await pressLabel(E('newEstimate'));
    expect(router.push).toHaveBeenLastCalledWith('/estimate/form');
  });

  it('the empty state button does the same, and there is only one New estimate button on the screen', async () => {
    await renderScreen(<EstimatesScreen />);
    expect(screen.getAllByLabelText(E('newEstimate'))).toHaveLength(1);
    await pressLabel(E('newEstimate'));
    expect(router.push).toHaveBeenLastCalledWith('/estimate/form');
  });

  it('from 6 estimates there are status chips with counts; the search box is always there', async () => {
    make(5);
    await renderScreen(<EstimatesScreen />);
    expect(hasLabel(E('all'))).toBe(false); // five estimates: no chips yet
    expect(hasLabel(E('search'))).toBe(true);
    // every word must match somewhere (the number EST-2026-00n holds the year), so "4" is the only digit that is unique to Job 4
    await typeInto(E('search'), 'job 4');
    expect(visibleText()).toContain('Client 4');
    expect(visibleText()).not.toContain('Client 3');
    expect(visibleText()).not.toContain('Client 5');
    await screen.unmount();

    make(9, 6); // nine in all
    await renderScreen(<EstimatesScreen />);
    expect(hasLabel(E('all'))).toBe(true);
    expect(hasLabel(E('search'))).toBe(true);
    expect(visibleText()).toContain('Client 1');
    expect(visibleText()).toContain('Client 4');
    const counts = Object.fromEntries(['draft', 'sent', 'accepted', 'declined'].map((s) => [s, estimates().filter((e) => e.status === s).length]));
    for (const [status, n] of Object.entries(counts)) expect(hasLabel(`${E(`estStatus_${status}` as 'estStatus_draft')} ${n}`)).toBe(true);

    await pressLabel(`${E('estStatus_accepted')} ${counts.accepted}`);
    const accepted = estimates().filter((e) => e.status === 'accepted').map((e) => e.client_name);
    for (const e of estimates()) expect(visibleText().includes(e.client_name)).toBe(accepted.includes(e.client_name));

    await pressLabel(E('all'));
    await typeInto(E('search'), 'job 7');
    expect(visibleText()).toContain('Client 7');
    expect(visibleText()).not.toContain('Client 6');
    await typeInto(E('search'), 'nothing like this');
    expect(visibleText()).toContain(E('noResultsFor', { q: 'nothing like this' }));
    expect(visibleText()).not.toContain(`0 ${E('estimates')}`);
    expectClean('estimate list with a search');
    await pressLabel(E('clearSearch'));
    expect(visibleText()).toContain('Client 6');
  });
});

// ---------------------------------------------------------------- entries

describe('where the estimates are reached from', () => {
  it('More has Estimates and Company and bank details at the top', async () => {
    await renderScreen(<MoreScreen />);
    const text = visibleText();
    expect(text.indexOf(E('estimates'))).toBeGreaterThan(-1);
    expect(text.indexOf(E('estimates'))).toBeLessThan(text.indexOf(E('backup')));
    expect(text.indexOf(E('companyAndBank'))).toBeLessThan(text.indexOf(E('backup')));
    await pressText(E('estimates'));
    expect(router.push).toHaveBeenLastCalledWith('/estimate');
    await pressText(E('companyAndBank'));
    expect(router.push).toHaveBeenLastCalledWith('/company');
  });

  it('the quick-add sheet has New estimate', async () => {
    await renderScreen(<AddSheet />);
    await pressText(E('newEstimate'));
    expect(router.replace).toHaveBeenLastCalledWith('/estimate/form');
  });

  it('the project made from an estimate links back to it, with its total', async () => {
    const { id } = draftWithDiscount();
    setEstimateStatus(id, 'accepted');
    const project = createProjectFromEstimate(id);
    setRouteParams({ id: project });
    await renderScreen(<ProjectDetail />);
    const number = estimates()[0].number;
    expect(visibleText()).toContain(`${E('estimate')} ${number}`);
    expect(visibleText()).toContain(formatLKR(view(id).total_cents));
    await pressText(`${E('estimate')} ${number}`);
    expect(router.push).toHaveBeenLastCalledWith(`/estimate/${id}`);
  });

  it('a project without an estimate shows no such row', async () => {
    const project = saveProject({ name: 'Plain Site' });
    setRouteParams({ id: project });
    await renderScreen(<ProjectDetail />);
    expect(visibleText()).not.toContain(E('estimate'));
  });

  it('the backup screen counts estimates, lines and stages as records', async () => {
    const { id } = draftWithDiscount(); // 1 estimate + 2 lines
    applyStandardSchedule(id); // + 3 stages
    await renderScreen(<BackupScreen />);
    expect(visibleText()).toContain(`6 ${E('records')}`);
  });
});

// ---------------------------------------------------------------- company and bank details

describe('company and bank details', () => {
  it('saves every field on this phone, shows the saved message and goes back', async () => {
    await renderScreen(shown(<CompanyScreen />));
    await typeInto(E('companyName'), 'Bluemoon Engineering (Pvt) Ltd');
    await typeInto(E('bankName'), 'Sampath Bank');
    await typeInto(E('accountName'), 'Bluemoon Engineering (Pvt) Ltd');
    await typeInto(E('accountNo'), '0012-3456-7890');
    await typeInto(E('branch'), 'Welimada');
    await typeInto(E('defaultValidDays'), '45');
    await typeInto(E('defaultTerms'), '50 % advance before work starts.');
    await pressLabel(E('save'));
    expect(getCompanyProfile()).toMatchObject({
      bank_name: 'Sampath Bank',
      account_no: '0012-3456-7890',
      branch: 'Welimada',
      default_valid_days: 45,
      default_terms: '50 % advance before work starts.',
    });
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(visibleText()).toContain(E('savedOnPhone'));
  });

  it('refuses a validity that is not 1 to 365 days and saves nothing until it is right', async () => {
    await renderScreen(shown(<CompanyScreen />));
    await typeInto(E('bankName'), 'Sampath Bank');
    for (const bad of ['0', '366', 'abc', '']) {
      await typeInto(E('defaultValidDays'), bad);
      await pressLabel(E('save'));
      expect(screen.getAllByText(E('errValidDays'))).toHaveLength(2); // under the field and in the toast
      expect(getCompanyProfile().bank_name).toBe(''); // nothing was written
    }
    expect(router.back).not.toHaveBeenCalled();
    await typeInto(E('defaultValidDays'), '60');
    expect(screen.queryAllByText(E('errValidDays'))).toHaveLength(1); // only the toast is left
    await pressLabel(E('save'));
    expect(getCompanyProfile()).toMatchObject({ bank_name: 'Sampath Bank', default_valid_days: 60 });
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('a double tap on Save saves once', async () => {
    await renderScreen(<CompanyScreen />);
    await typeInto(E('bankName'), 'Sampath Bank');
    const save = screen.getAllByLabelText(E('save'), { exact: true })[0];
    await fireEvent.press(save);
    await fireEvent.press(save);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('the hub shows the saved bank block', async () => {
    const { id } = draftWithDiscount();
    setSetting('company_bank_name', 'Sampath Bank');
    setSetting('company_account_no', '0012-3456-7890');
    setRouteParams({ id });
    await renderScreen(<EstimateHub />);
    expect(visibleText()).toContain('Sampath Bank');
    expect(visibleText()).toContain('0012-3456-7890');
    expect(hasLabel(E('addBankDetails'))).toBe(false);
    await pressLabel(E('edit'), 0);
    expect(router.push).toHaveBeenLastCalledWith('/company');
  });
});
