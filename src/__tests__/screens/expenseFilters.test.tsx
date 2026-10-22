/**
 * The Expenses tab's control bar: period chips and the month picker, the Filter & sort sheet (category, payment
 * method, amount range, sort), the tiles that total what is shown, the remembered choices and Clear. Every total and
 * every order is checked against a query written here, on the demo data plus expenses in fixed past months.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import ExpensesScreen from '@/app/(tabs)/expenses';
import { monthLabel, shiftMonth } from '@/components/ListControls';
import { getSetting, setSetting } from '@/db';
import { saveExpense } from '@/db/repo';
import { expenseWhere } from '@/hooks/data';
import { today } from '@/lib/dates';
import { formatLKR } from '@/lib/money';
import { resetDb, seedDemo } from '@/test-utils';
import { CULVERT, projectId, rows, SCHOOL, setCurrent } from '@/test-utils/screenData';
import {
  expectClean,
  has,
  hasLabel,
  makeTr,
  pressLabel,
  pressText,
  renderScreen,
  screen,
  typeInto,
  visibleText,
  visibleTexts,
} from '@/test-utils/screenKit';

const E = makeTr('en');
const KEYS = ['period', 'sort', 'cats', 'methods', 'min', 'max'].map((f) => `list_expenses_${f}`);

/** Sum and number of live expenses matching a WHERE clause written by the test (alias e). */
function sql(where = '1 = 1', params: (string | number)[] = []) {
  return rows<{ total: number; count: number }>(
    `SELECT COALESCE(SUM(e.amount_cents), 0) AS total, COUNT(*) AS count FROM expenses e WHERE e.deleted_at IS NULL AND ${where}`,
    params,
  )[0];
}

/** The payees in the order the list shows them (each row's title is its "paid to"). */
function shownPayees(): string[] {
  const payees = new Set(rows<{ paid_to: string }>('SELECT paid_to FROM expenses WHERE deleted_at IS NULL').map((r) => r.paid_to));
  return visibleTexts().filter((s) => payees.has(s));
}

function payeesBy(order: string, where = '1 = 1', params: (string | number)[] = []): string[] {
  return rows<{ paid_to: string }>(`SELECT e.paid_to FROM expenses e WHERE e.deleted_at IS NULL AND ${where} ORDER BY ${order}`, params).map((r) => r.paid_to);
}

const thisMonth = () => today().slice(0, 7);
const range = (month: string) => [`${month}-01`, `${shiftMonth(month, 1)}-01`];

beforeAll(() => {
  resetDb();
  seedDemo();
  const school = projectId(SCHOOL);
  const culvert = projectId(CULVERT);
  // two older months with a mix of categories, methods and a cents amount; February 2025 has nothing
  saveExpense({ project_id: school, day: '2025-03-05', category: 'materials', amount_cents: 5_000_000, paid_to: 'March Cement', method: 'cash', note: null });
  saveExpense({ project_id: culvert, day: '2025-03-20', category: 'fuel', amount_cents: 1_234_550, paid_to: 'March Diesel', method: 'bank', note: null });
  saveExpense({ project_id: school, day: '2025-03-20', category: 'materials', amount_cents: 2_000_000, paid_to: 'March Sand', method: 'cheque', note: null });
  saveExpense({ project_id: culvert, day: '2025-01-10', category: 'materials', amount_cents: 8_000_000, paid_to: 'January Steel', method: 'cheque', note: null });
});

beforeEach(() => {
  setSetting('lang', 'en');
  setSetting('theme', 'light');
  setCurrent(null);
  for (const k of KEYS) setSetting(k, null);
});

describe('Expenses: defaults', () => {
  it('nothing applied: no caption, no badge, This month and Total cost tiles, day groups', async () => {
    await renderScreen(<ExpensesScreen />);
    expectClean('expenses default');
    expect(hasLabel(E('filterSort'))).toBe(true);
    expect(hasLabel(E('clear'))).toBe(false);
    expect(screen.queryByTestId('list-applied')).toBeNull();
    const month = sql('e.day >= ? AND e.day < ?', range(thisMonth()));
    expect(hasLabel(`${E('thisMonth')} ${formatLKR(month.total)}`)).toBe(true);
    expect(hasLabel(`${E('totalCost')} ${formatLKR(sql().total)} ${E('allProjects')}`)).toBe(true);
    expect(has(E('today'))).toBe(true); // a day group header
    // every expense, newest first
    expect(shownPayees()).toEqual(payeesBy('e.day DESC, e.created_at DESC, e.id'));
  });
});

describe('Expenses: period', () => {
  it('This month: the rows, the tile total and the caption are this month only, and the choice is stored', async () => {
    await renderScreen(<ExpensesScreen />);
    await pressLabel(E('thisMonth'));
    const m = thisMonth();
    const want = sql('e.day >= ? AND e.day < ?', range(m));
    expect(hasLabel(`${E('total')} · ${monthLabel(m, E)} ${formatLKR(want.total)} ${E('allProjects')}`)).toBe(true);
    expect(hasLabel(`${E('entries')} ${want.count}`)).toBe(true);
    expect(screen.getByTestId('list-applied').props.children).toBe(monthLabel(m, E));
    expect(visibleText()).not.toContain('March Cement');
    expect(shownPayees()).toEqual(payeesBy('e.day DESC, e.created_at DESC, e.id', 'e.day >= ? AND e.day < ?', range(m)));
    expect(getSetting('list_expenses_period')).toBe('this');
    expectClean('expenses this month');
  });

  it('Last month totals what the database holds for last month', async () => {
    await renderScreen(<ExpensesScreen />);
    await pressLabel(E('lastMonth'));
    const m = shiftMonth(thisMonth(), -1);
    const want = sql('e.day >= ? AND e.day < ?', range(m));
    expect(hasLabel(`${E('total')} · ${monthLabel(m, E)} ${formatLKR(want.total)} ${E('allProjects')}`)).toBe(true);
    if (want.count === 0) expect(visibleText()).toContain(E('noMatches'));
    expect(getSetting('list_expenses_period')).toBe('last');
  });

  it('Choose month lists only the months that have expenses, newest first, each with its total', async () => {
    await renderScreen(<ExpensesScreen />);
    await pressLabel(E('chooseMonth'));
    const months = rows<{ month: string; total: number; count: number }>(
      "SELECT substr(day, 1, 7) AS month, SUM(amount_cents) AS total, COUNT(*) AS count FROM expenses WHERE deleted_at IS NULL GROUP BY month ORDER BY month DESC",
    );
    expect(months.map((m) => m.month)).toEqual(expect.arrayContaining(['2025-03', '2025-01']));
    const titles = visibleTexts().filter((s) => /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/.test(s));
    expect(titles).toEqual(months.map((m) => monthLabel(m.month, E)));
    expect(titles).not.toContain('February 2025');
    for (const m of months) expect(visibleText()).toContain(`${formatLKR(m.total)} · ${E('recordsCount', { n: m.count })}`);

    await pressText('March 2025');
    const want = sql("e.day >= '2025-03-01' AND e.day < '2025-04-01'");
    expect(want.total).toBe(8_234_550);
    expect(hasLabel(`${E('total')} · March 2025 ${formatLKR(want.total)} ${E('allProjects')}`)).toBe(true);
    expect(shownPayees().sort()).toEqual(['March Cement', 'March Diesel', 'March Sand']);
    expect(hasLabel(`${E('chooseMonth')}: March 2025`)).toBe(true);
    expect(getSetting('list_expenses_period')).toBe('2025-03');
    expectClean('expenses march');
  });

  it('a chosen month narrows with the project: the culvert in March 2025 is the diesel only', async () => {
    setCurrent(projectId(CULVERT));
    setSetting('list_expenses_period', '2025-03');
    await renderScreen(<ExpensesScreen />);
    expect(shownPayees()).toEqual(['March Diesel']);
    expect(hasLabel(`${E('total')} · March 2025 Rs 12,345.50`)).toBe(true);
  });
});

describe('Expenses: the Filter & sort sheet', () => {
  it('category, payment method and amount range filter in the database; the tiles and badge follow', async () => {
    await renderScreen(<ExpensesScreen />);
    await pressLabel(E('filterSort'));
    for (const label of [E('sortBy'), E('category'), E('method'), E('minAmount'), E('maxAmount'), E('reset'), E('done')]) expect(visibleText()).toContain(label);

    await pressLabel(E('cat_materials'));
    let want = sql("e.category = 'materials'");
    expect(hasLabel(`${E('total')} · ${E('allTime')} ${formatLKR(want.total)} ${E('allProjects')}`)).toBe(true);
    expect(hasLabel(E('filterSortActive', { n: 1 }))).toBe(true);
    expect(getSetting('list_expenses_cats')).toBe('materials');

    await pressLabel(E('method_cheque'));
    want = sql("e.category = 'materials' AND e.method = 'cheque'");
    expect(hasLabel(`${E('entries')} ${want.count}`)).toBe(true);
    expect(hasLabel(`${E('total')} · ${E('allTime')} ${formatLKR(want.total)} ${E('allProjects')}`)).toBe(true);

    await typeInto(E('minAmount'), '50000');
    want = sql("e.category = 'materials' AND e.method = 'cheque' AND e.amount_cents >= 5000000");
    expect(hasLabel(`${E('total')} · ${E('allTime')} ${formatLKR(want.total)} ${E('allProjects')}`)).toBe(true);
    expect(getSetting('list_expenses_min')).toBe('5000000');
    expect(hasLabel(E('filterSortActive', { n: 3 }))).toBe(true);

    await typeInto(E('maxAmount'), '90,000');
    want = sql("e.category = 'materials' AND e.method = 'cheque' AND e.amount_cents BETWEEN 5000000 AND 9000000");
    expect(want.count).toBeGreaterThan(0);
    expect(hasLabel(`${E('total')} · ${E('allTime')} ${formatLKR(want.total)} ${E('allProjects')}`)).toBe(true);
    await pressLabel(E('done'));
    expect(screen.getByTestId('list-applied').props.children).toBe(`${E('cat_materials')} · ${E('method_cheque')} · Rs 50,000 – Rs 90,000`);
    expect(shownPayees().sort()).toEqual(payeesBy('e.paid_to', "e.category = 'materials' AND e.method = 'cheque' AND e.amount_cents BETWEEN 5000000 AND 9000000").sort());
    expectClean('expenses sheet filters');
  });

  it('a minimum above the maximum says so, and the list is empty with a way out', async () => {
    setSetting('list_expenses_min', '9000000');
    setSetting('list_expenses_max', '100');
    await renderScreen(<ExpensesScreen />);
    expect(visibleText()).toContain(E('noMatches'));
    await pressLabel(E('filterSortActive', { n: 1 }));
    expect(visibleText()).toContain(E('errRange'));
    await pressLabel(E('done'));
    await pressLabel(E('clearFilters'));
    expect(getSetting('list_expenses_min')).toBeNull();
    expect(visibleText()).not.toContain(E('noMatches'));
  });

  it.each([
    ['sort_highest', 'e.amount_cents DESC, e.day DESC, e.created_at DESC, e.id'],
    ['sort_lowest', 'e.amount_cents ASC, e.day DESC, e.created_at DESC, e.id'],
  ] as const)('%s is one flat list in amount order, each row with its date', async (key, order) => {
    await renderScreen(<ExpensesScreen />);
    await pressLabel(E('filterSort'));
    await pressLabel(E(key));
    await pressLabel(E('done'));
    expect(shownPayees()).toEqual(payeesBy(order));
    // no day group headers, the date is on the row instead
    expect(has(E('today'))).toBe(false);
    expect(visibleText()).toContain('5 Mar 2025 · ');
    expect(screen.getByTestId('list-applied').props.children).toBe(E(key));
    // sorting alone changes no total
    expect(hasLabel(`${E('totalCost')} ${formatLKR(sql().total)} ${E('allProjects')}`)).toBe(true);
  });

  it('Oldest first keeps the day groups, oldest day at the top', async () => {
    setSetting('list_expenses_sort', 'oldest');
    await renderScreen(<ExpensesScreen />);
    expect(shownPayees()).toEqual(payeesBy('e.day ASC, e.created_at ASC, e.id'));
    expect(has('10 Jan 2025')).toBe(true); // the group header of the oldest day
    expect(has(E('today'))).toBe(true);
  });
});

describe('Expenses: remembered and cleared', () => {
  it('choices come back after the screen is opened again (they are in the settings table)', async () => {
    await renderScreen(<ExpensesScreen />);
    await pressLabel(E('chooseMonth'));
    await pressText('March 2025');
    await pressLabel(E('filterSort'));
    await pressLabel(E('cat_materials'));
    await pressLabel(E('sort_highest'));
    await pressLabel(E('done'));
    await screen.unmount();

    expect(KEYS.map((k) => [k, getSetting(k)])).toEqual([
      ['list_expenses_period', '2025-03'],
      ['list_expenses_sort', 'highest'],
      ['list_expenses_cats', 'materials'],
      ['list_expenses_methods', null],
      ['list_expenses_min', null],
      ['list_expenses_max', null],
    ]);
    await renderScreen(<ExpensesScreen />);
    expect(screen.getByTestId('list-applied').props.children).toBe(`March 2025 · ${E('cat_materials')} · ${E('sort_highest')}`);
    expect(shownPayees()).toEqual(['March Cement', 'March Sand']);
    expect(hasLabel(`${E('total')} · March 2025 Rs 70,000 ${E('allProjects')}`)).toBe(true);
  });

  it('Clear puts every choice back to its default in one tap', async () => {
    setSetting('list_expenses_period', 'this');
    setSetting('list_expenses_sort', 'lowest');
    setSetting('list_expenses_methods', 'bank');
    await renderScreen(<ExpensesScreen />);
    expect(hasLabel(E('filterSortActive', { n: 2 }))).toBe(true);
    await pressLabel(E('clear'));
    for (const k of KEYS) expect([k, getSetting(k)]).toEqual([k, null]);
    expect(screen.queryByTestId('list-applied')).toBeNull();
    expect(hasLabel(E('filterSort'))).toBe(true);
    expect(hasLabel(`${E('totalCost')} ${formatLKR(sql().total)} ${E('allProjects')}`)).toBe(true);
  });

  it('Reset in the sheet does the same', async () => {
    setSetting('list_expenses_cats', 'fuel,food');
    await renderScreen(<ExpensesScreen />);
    await pressLabel(E('filterSortActive', { n: 1 }));
    expect(screen.getByLabelText(E('cat_fuel')).props.accessibilityState.checked).toBe(true);
    await pressLabel(E('reset'));
    expect(getSetting('list_expenses_cats')).toBeNull();
    expect(screen.getByLabelText(E('cat_fuel')).props.accessibilityState.checked).toBe(false);
  });

  it('a stored value the app does not know is ignored, not applied', async () => {
    setSetting('list_expenses_sort', 'sideways');
    setSetting('list_expenses_period', '2025-13');
    setSetting('list_expenses_cats', 'gold,materials');
    await renderScreen(<ExpensesScreen />);
    expect(screen.getByTestId('list-applied').props.children).toBe(E('cat_materials'));
    expectClean('expenses junk settings');
  });
});

describe('expenseWhere: filters become bound values, never SQL text', () => {
  it('builds placeholders for every value', () => {
    const w = expenseWhere({ projectId: "x' OR 1=1 --", range: { from: '2025-03-01', to: '2025-04-01' }, categories: ['materials', 'fuel'], methods: ['cash'], minCents: 100, maxCents: 900 });
    expect(w.sql).toBe('e.deleted_at IS NULL AND e.project_id = ? AND e.day >= ? AND e.day < ? AND e.category IN (?, ?) AND e.method IN (?) AND e.amount_cents >= ? AND e.amount_cents <= ?');
    expect(w.args).toEqual(["x' OR 1=1 --", '2025-03-01', '2025-04-01', 'materials', 'fuel', 'cash', 100, 900]);
    expect(expenseWhere({ projectId: null, range: { from: 'a', to: 'b' }, categories: [], methods: [], minCents: null, maxCents: null }, { withPeriod: false })).toEqual({ sql: 'e.deleted_at IS NULL', args: [] });
  });

  it('the screen shows only the rows the query returns (a capped list is still filtered first)', async () => {
    setSetting('list_expenses_cats', 'fuel');
    await renderScreen(<ExpensesScreen />);
    expect(shownPayees().sort()).toEqual(payeesBy('e.paid_to', "e.category = 'fuel'").sort());
    expectClean('expenses fuel');
  });
});
