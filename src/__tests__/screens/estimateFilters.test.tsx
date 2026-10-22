/**
 * The estimate list's control bar: the status chips stay in the bar (from 6 estimates), the period by issue date
 * (This month, Last month, All time, Choose month) and the order (newest, oldest, highest or lowest total) are in
 * the sheet. Also the hub's payment schedule: one stage with cents gives every stage two decimals.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import EstimateHub from '@/app/estimate/[id]';
import EstimatesScreen from '@/app/estimate/index';
import { monthLabel, shiftMonth } from '@/components/ListControls';
import { getSetting, setSetting } from '@/db';
import { saveEstimate, saveEstimateItem, saveEstimatePayment, setEstimateStatus } from '@/db/estimates';
import type { EstimateStatus } from '@/db/types';
import { today } from '@/lib/dates';
import { allocatePayments } from '@/lib/estimate';
import { formatLKR } from '@/lib/money';
import { resetDb } from '@/test-utils';
import { rows } from '@/test-utils/screenData';
import { expectClean, hasLabel, makeTr, pressLabel, pressText, renderScreen, screen, setRouteParams, visibleText, visibleTexts } from '@/test-utils/screenKit';

const E = makeTr('en');
const KEYS = ['status', 'period', 'sort'].map((f) => `list_estimates_${f}`);

function make(client: string, issueDay: string, rateRs: number, status: EstimateStatus = 'draft') {
  const id = saveEstimate({ client_name: client, title: `Job for ${client}`, issue_day: issueDay });
  saveEstimateItem({ estimate_id: id, description: 'Work', unit: 'ls', qty_milli: 1000, rate_cents: rateRs * 100 });
  if (status === 'accepted') setEstimateStatus(id, 'sent');
  if (status !== 'draft') setEstimateStatus(id, status);
  return id;
}

/** Client names in the order the list shows them. */
function shownClients(): string[] {
  const names = new Set(rows<{ client_name: string }>('SELECT client_name FROM estimates WHERE deleted_at IS NULL').map((r) => r.client_name));
  return visibleTexts().filter((s) => names.has(s));
}

function clientsBy(order: string, where = '1 = 1', params: string[] = []): string[] {
  return rows<{ client_name: string }>(
    `SELECT e.client_name FROM estimates e JOIN v_estimate_total t ON t.estimate_id = e.id WHERE e.deleted_at IS NULL AND ${where} ORDER BY ${order}`,
    params,
  ).map((r) => r.client_name);
}

describe('estimate list: period, status and sort', () => {
  const thisMonth = today().slice(0, 7);

  beforeAll(() => {
    resetDb();
    make('Client Today', today(), 300_000);
    make('Client Today Two', today(), 50_000, 'sent');
    make('Client March', '2025-03-10', 900_000, 'accepted');
    make('Client March Two', '2025-03-28', 120_000, 'declined');
    make('Client January', '2025-01-15', 40_000);
    make('Client Last Month', `${shiftMonth(thisMonth, -1)}-15`, 75_000, 'sent');
  });

  beforeEach(() => {
    setSetting('lang', 'en');
    setSetting('theme', 'light');
    for (const k of KEYS) setSetting(k, null);
  });

  it('six estimates: the status chips are in the bar beside Filter & sort; period and order are in the sheet', async () => {
    await renderScreen(<EstimatesScreen />);
    expect(hasLabel(E('filterSort'))).toBe(true);
    expect(hasLabel(E('all'))).toBe(true);
    expect(hasLabel(`${E('estStatus_sent')} 2`)).toBe(true);
    expect(hasLabel(E('thisMonth'))).toBe(false); // not in the bar
    expect(shownClients()).toEqual(clientsBy('e.issue_day DESC, e.created_at DESC, e.id'));
    await pressLabel(E('filterSort'));
    for (const label of [E('period'), E('thisMonth'), E('lastMonth'), E('allTime'), E('chooseMonth'), E('sortBy'), E('sort_highest')]) expect(hasLabel(label) || visibleText().includes(label)).toBe(true);
    expectClean('estimates sheet');
  });

  it('This month (by issue date) from the sheet', async () => {
    await renderScreen(<EstimatesScreen />);
    await pressLabel(E('filterSort'));
    await pressLabel(E('thisMonth'));
    await pressLabel(E('done'));
    expect(shownClients()).toEqual(clientsBy('e.issue_day DESC, e.created_at DESC, e.id', 'e.issue_day >= ? AND e.issue_day < ?', [`${thisMonth}-01`, `${shiftMonth(thisMonth, 1)}-01`]));
    expect(screen.getByTestId('list-applied').props.children).toBe(monthLabel(thisMonth, E));
    expect(getSetting('list_estimates_period')).toBe('this');
    expect(hasLabel(E('filterSortActive', { n: 1 }))).toBe(true);
  });

  it('Choose month lists only months with estimates, newest first, with their totals; picking one filters the list', async () => {
    await renderScreen(<EstimatesScreen />);
    await pressLabel(E('filterSort'));
    await pressLabel(E('chooseMonth'));
    const months = rows<{ month: string; total: number; n: number }>(
      `SELECT substr(e.issue_day, 1, 7) AS month, SUM(t.total_cents) AS total, COUNT(*) AS n FROM estimates e
       JOIN v_estimate_total t ON t.estimate_id = e.id WHERE e.deleted_at IS NULL GROUP BY month ORDER BY month DESC`,
    );
    const titles = visibleTexts().filter((s) => /^[A-Z][a-z]+ \d{4}$/.test(s));
    expect(titles).toEqual(months.map((m) => monthLabel(m.month, E)));
    expect(titles).not.toContain('February 2025');
    expect(visibleText()).toContain(`${formatLKR(1_020_000_00)} · ${E('recordsCount', { n: 2 })}`); // March 2025: 900,000 + 120,000

    await pressText('March 2025');
    expect(shownClients()).toEqual(['Client March Two', 'Client March']);
    expect(getSetting('list_estimates_period')).toBe('2025-03');
    expect(screen.getByTestId('list-applied').props.children).toBe('March 2025');
  });

  it.each([
    ['sort_highest', 't.total_cents DESC, e.issue_day DESC, e.created_at DESC, e.id'],
    ['sort_lowest', 't.total_cents ASC, e.issue_day DESC, e.created_at DESC, e.id'],
    ['sort_oldest', 'e.issue_day ASC, e.created_at ASC, e.id'],
  ] as const)('%s', async (key, order) => {
    await renderScreen(<EstimatesScreen />);
    await pressLabel(E('filterSort'));
    await pressLabel(E(key));
    await pressLabel(E('done'));
    expect(shownClients()).toEqual(clientsBy(order));
    expect(screen.getByTestId('list-applied').props.children).toBe(E(key));
  });

  it('status, period and sort together are remembered; the caption names all three; Clear resets them', async () => {
    await renderScreen(<EstimatesScreen />);
    await pressLabel(`${E('estStatus_sent')} 2`);
    await pressLabel(E('filterSort'));
    await pressLabel(E('sort_lowest'));
    await pressLabel(E('done'));
    expect(shownClients()).toEqual(['Client Today Two', 'Client Last Month']);
    await screen.unmount();

    expect(KEYS.map((k) => getSetting(k))).toEqual(['sent', null, 'lowest']);
    await renderScreen(<EstimatesScreen />);
    expect(screen.getByTestId('list-applied').props.children).toBe(`${E('estStatus_sent')} · ${E('sort_lowest')}`);
    await pressLabel(E('clear'));
    expect(KEYS.map((k) => getSetting(k))).toEqual([null, null, null]);
    expect(shownClients()).toEqual(clientsBy('e.issue_day DESC, e.created_at DESC, e.id'));
    expect(screen.queryByTestId('list-applied')).toBeNull();
  });

  it('a period with no estimates leaves a way back: the caption and its Clear', async () => {
    setSetting('list_estimates_period', '2024-06');
    await renderScreen(<EstimatesScreen />);
    expect(visibleText()).toContain(`0 ${E('estimates')}`);
    expect(screen.getByTestId('list-applied').props.children).toBe('June 2024');
    await pressLabel(E('clear'));
    expect(shownClients()).toHaveLength(6);
  });
});

describe('estimate hub: the payment schedule lines up its decimals', () => {
  beforeAll(() => resetDb());

  it('one stage with cents gives every stage two decimals', async () => {
    setSetting('lang', 'en');
    // Rs 1,599,725 in 30 / 40 / 30: Rs 479,917.50, Rs 639,890 and Rs 479,917.50
    const id = saveEstimate({ client_name: 'Owner Phone', title: 'Two storey house', issue_day: today() });
    saveEstimateItem({ estimate_id: id, description: 'Lump sum', unit: 'ls', qty_milli: 1000, rate_cents: 159_972_500 });
    for (const [label, bp] of [['Advance', 3000], ['Progress payment', 4000], ['On completion', 3000]] as const) saveEstimatePayment({ estimate_id: id, label, percent_bp: bp });
    expect(allocatePayments(159_972_500, [3000, 4000, 3000])).toEqual([47_991_750, 63_989_000, 47_991_750]);
    setRouteParams({ id });
    await renderScreen(<EstimateHub />);
    const text = visibleText();
    expect(text).toContain('Rs 479,917.50');
    expect(text).toContain('Rs 639,890.00');
    expect(visibleTexts()).not.toContain('Rs 639,890');
    // the total and the item keep their own format
    expect(visibleTexts()).toContain('Rs 1,599,725');
  });

  it('without cents anywhere, no stage gets decimals', async () => {
    const id = saveEstimate({ client_name: 'Round Sums', title: 'Wall', issue_day: today() });
    saveEstimateItem({ estimate_id: id, description: 'Excavation', unit: 'm³', qty_milli: 12_500, rate_cents: 180_000 });
    saveEstimatePayment({ estimate_id: id, label: 'Advance', percent_bp: 3000 });
    saveEstimatePayment({ estimate_id: id, label: 'On completion', percent_bp: 7000 });
    setRouteParams({ id });
    await renderScreen(<EstimateHub />);
    expect(visibleTexts()).toContain('Rs 6,750');
    expect(visibleTexts()).toContain('Rs 15,750');
    expect(visibleText()).not.toContain('.00');
  });
});
