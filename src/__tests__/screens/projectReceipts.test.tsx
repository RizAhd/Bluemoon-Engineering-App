/**
 * Money from the client on the project page: a project worth 1 crore (Rs 10,000,000), the client pays Rs 10 lakh,
 * later Rs 20 lakh. The card shows the value, what was received and what is still to receive; "Record payment"
 * asks once with the project and the amount; a payment can be changed or deleted; the project list and the PDF agree.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { router } from 'expo-router';

import ProjectsTab from '@/app/(tabs)/projects';
import ProjectDetail from '@/app/project/[id]';
import ReceiptForm from '@/app/project/receipt';
import { ToastHost } from '@/components/ui/feedback';
import { setSetting } from '@/db';
import { saveExpense, saveProject, saveReceipt } from '@/db/repo';
import type { Project, ProjectCost } from '@/db/types';
import { buildReportHtml } from '@/lib/reportHtml';
import { mockAlert, resetDb } from '@/test-utils';
import { rows, setCurrent } from '@/test-utils/screenData';
import { hasLabel, inputValue, lastAlert, makeTr, pressAlertButton, pressLabel, pressText, renderScreen, setRouteParams, typeInto, visibleText } from '@/test-utils/screenKit';

jest.setTimeout(180_000); // the PC that runs these is often busy

const E = makeTr('en');
const lakh = (n: number) => n * 100_000 * 100;

beforeEach(() => {
  resetDb();
  setSetting('lang', 'en');
  setSetting('theme', 'light');
  setCurrent(null);
});

const receipts = () => rows('SELECT amount_cents, method, note, day FROM project_receipts WHERE deleted_at IS NULL ORDER BY day, created_at');

function bigJob() {
  return saveProject({ name: 'Big Job', client: 'Mr Silva', contract_cents: lakh(100) });
}

describe('project page', () => {
  it('shows 10 lakh received of 1 crore: still to receive 90 lakh', async () => {
    const p = bigJob();
    saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: lakh(10), method: 'bank', note: 'Advance' });
    setRouteParams({ id: p });
    await renderScreen(<ProjectDetail />);
    const text = visibleText();
    expect(text).toContain(E('moneyFromClient'));
    expect(text).toContain('Rs 10,000,000'); // project value
    expect(text).toContain('Rs 1,000,000'); // received
    expect(text).toContain('Rs 9,000,000'); // still to receive
    expect(text).toContain('Advance');
  });

  it('after the second payment (10 lakh + 20 lakh): 30 lakh received, 70 lakh still to receive', async () => {
    const p = bigJob();
    saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: lakh(10), method: 'bank', note: 'Advance' });
    saveReceipt({ project_id: p, day: '2026-11-05', amount_cents: lakh(20), method: 'cheque' });
    setRouteParams({ id: p });
    await renderScreen(<ProjectDetail />);
    const text = visibleText();
    expect(text).toContain('Rs 3,000,000'); // received
    expect(text).toContain('Rs 7,000,000'); // still to receive
    expect(text).toContain(E('stillToReceive'));
  });

  it('with no payments: received Rs 0, the whole value still to receive, and a line saying none yet', async () => {
    const p = bigJob();
    setRouteParams({ id: p });
    await renderScreen(<ProjectDetail />);
    const text = visibleText();
    expect(text).toContain(E('noPaymentsYet'));
    expect(text).toContain('Rs 10,000,000'); // value = still to receive
  });

  it('without a project value it shows only what was received and says where to add the value', async () => {
    const p = saveProject({ name: 'No Value Job' });
    saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: lakh(5), method: 'cash' });
    setRouteParams({ id: p });
    await renderScreen(<ProjectDetail />);
    const text = visibleText();
    expect(text).toContain(E('addValueHint'));
    expect(text).not.toContain(E('stillToReceive'));
    expect(text).toContain('Rs 500,000');
  });

  it('past the value it says "over", not a negative amount', async () => {
    const p = saveProject({ name: 'Extra Work', contract_cents: lakh(10) });
    saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: lakh(12), method: 'bank' });
    setRouteParams({ id: p });
    await renderScreen(<ProjectDetail />);
    const text = visibleText();
    expect(text).toContain(E('overValueBy'));
    expect(text).not.toContain(E('stillToReceive'));
  });

  it('shows received minus spent once something was received', async () => {
    const p = bigJob();
    saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: lakh(10), method: 'bank' });
    saveExpense({ project_id: p, day: '2026-10-02', category: 'materials', amount_cents: lakh(3), method: 'cash' });
    setRouteParams({ id: p });
    await renderScreen(<ProjectDetail />);
    expect(visibleText()).toContain(E('receivedMinusSpent'));
    expect(visibleText()).toContain('Rs 700,000'); // 10 lakh - 3 lakh
  });

  it('Record payment opens the form for this project; a payment row opens it for editing', async () => {
    const p = bigJob();
    saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: lakh(10), method: 'bank' });
    const id = saveReceipt({ project_id: p, day: '2026-10-02', amount_cents: lakh(2), method: 'cash' });
    setRouteParams({ id: p });
    await renderScreen(<ProjectDetail />);
    await pressLabel(E('recordPayment'));
    expect(router.push).toHaveBeenCalledWith(`/project/receipt?projectId=${p}`);
    await pressText('Rs 200,000'); // the row of the 2 lakh payment
    expect(router.push).toHaveBeenCalledWith(`/project/receipt?id=${id}`);
  });
});

describe('payment form', () => {
  it('Save asks once with the project and amount, then records it', async () => {
    const p = bigJob();
    setRouteParams({ projectId: p });
    const alert = mockAlert();
    await renderScreen(
      <>
        <ReceiptForm />
        <ToastHost />
      </>,
    );
    await typeInto(E('amountReceived'), '1,000,000');
    await pressLabel(E('save'));
    expect(alert).toHaveBeenCalledTimes(1);
    const { title, message, buttons } = lastAlert(alert);
    expect(title).toBe(E('receiptConfirmTitle'));
    expect(message).toBe('Big Job — Rs 1,000,000');
    expect(receipts()).toHaveLength(0); // nothing saved before the confirm
    await pressAlertButton(alert, `${E('receiptConfirmTitle')} · Rs 1,000,000`);
    expect(buttons).toHaveLength(2);
    expect(receipts()).toEqual([expect.objectContaining({ amount_cents: lakh(10), method: 'bank' })]);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('a total past the project value is said in the question, and still allowed', async () => {
    const p = saveProject({ name: 'Small Job', contract_cents: lakh(10) });
    saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: lakh(9), method: 'bank' });
    setRouteParams({ projectId: p });
    const alert = mockAlert();
    await renderScreen(<ReceiptForm />);
    await typeInto(E('amountReceived'), '200,000');
    await pressLabel(E('save'));
    expect(lastAlert(alert).message).toContain(E('receiptConfirmOver'));
    await pressAlertButton(alert, `${E('receiptConfirmTitle')} · Rs 200,000`);
    expect(receipts()).toHaveLength(2);
  });

  it('an empty or zero amount shows the error under the box and asks nothing', async () => {
    const p = bigJob();
    setRouteParams({ projectId: p });
    const alert = mockAlert();
    await renderScreen(<ReceiptForm />);
    await pressLabel(E('save'));
    expect(alert).not.toHaveBeenCalled();
    expect(visibleText()).toContain(E('errAmount'));
    expect(receipts()).toHaveLength(0);
  });

  it('opening a payment shows its values; changing the amount replaces it (still one payment)', async () => {
    const p = bigJob();
    const id = saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: lakh(10), method: 'cheque', note: 'Advance' });
    setRouteParams({ id });
    const alert = mockAlert();
    await renderScreen(<ReceiptForm />);
    expect(inputValue(E('amountReceived'))).toBe('1,000,000');
    expect(hasLabel(E('delete'))).toBe(true);
    await typeInto(E('amountReceived'), '1,500,000');
    await pressLabel(E('save'));
    await pressAlertButton(alert, `${E('receiptConfirmTitle')} · Rs 1,500,000`);
    expect(receipts()).toEqual([expect.objectContaining({ amount_cents: lakh(15), method: 'cheque', note: 'Advance' })]);
  });

  it('Delete asks, then takes the payment out', async () => {
    const p = bigJob();
    const id = saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: lakh(10), method: 'bank' });
    setRouteParams({ id });
    const alert = mockAlert();
    await renderScreen(<ReceiptForm />);
    await pressLabel(E('delete'));
    await pressAlertButton(alert, E('delete'));
    expect(receipts()).toHaveLength(0);
  });
});

describe('project list and PDF agree', () => {
  it('the list row says "Received Rs 3,000,000 of Rs 10,000,000" once a payment exists', async () => {
    const p = bigJob();
    saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: lakh(30), method: 'bank' });
    await renderScreen(<ProjectsTab />);
    expect(visibleText()).toContain('Received Rs 3,000,000 of Rs 10,000,000');
  });

  it('the list row says nothing about payments before the first one', async () => {
    bigJob();
    await renderScreen(<ProjectsTab />);
    expect(visibleText()).toContain('Big Job');
    expect(visibleText()).not.toContain('Received Rs');
  });

  const base = { id: 'x', created_at: '', updated_at: '', deleted_at: null, version: 1, device_id: 'd' };
  const project = { ...base, name: 'Big Job', client: null, location: null, contract_cents: lakh(100), start_date: null, end_date: null, status: 'active', notes: null } as unknown as Project;
  const cost: ProjectCost = { project_id: 'x', name: 'Big Job', status: 'active', contract_cents: lakh(100), expense_cents: 0, labour_cents: 0, labour_paid_cents: 0 };
  const report = (receiptRows: unknown[]) =>
    buildReportHtml({ project, cost, photoCount: 0, skippedPhotos: 0, letterhead: false, day: '2026-11-12', t: (k) => k, tables: { project_receipts: receiptRows } as never });

  it('the PDF has a Money received block with each payment, the total and what is left', () => {
    const html = report([
      { ...base, id: 'r1', project_id: 'x', day: '2026-10-01', amount_cents: lakh(10), method: 'bank', note: 'Advance' },
      { ...base, id: 'r2', project_id: 'x', day: '2026-11-05', amount_cents: lakh(20), method: 'cheque', note: null },
      { ...base, id: 'r3', project_id: 'x', day: '2026-11-06', amount_cents: lakh(50), method: 'cash', note: null, deleted_at: '2026-11-07T00:00:00Z' },
    ]);
    expect(html).toContain('moneyFromClient');
    expect(html).toContain('Rs 1,000,000');
    expect(html).toContain('Rs 3,000,000'); // received (the deleted one is not counted)
    expect(html).toContain('Rs 7,000,000'); // still to receive
    expect(html).not.toContain('Rs 5,000,000');
  });

  it('without payments the PDF has no such block', () => {
    expect(report([])).not.toContain('moneyFromClient');
    expect(report([])).not.toContain('receivedSoFar');
  });
});
