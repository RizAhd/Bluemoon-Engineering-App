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
  fireEvent,
  has,
  hasLabel,
  inputValue,
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
    expect(hasLabel(`${E('allExpenses')} ${formatLKR(sql().total)} ${E('allProjects')}`)).toBe(true);
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
    expect(hasLabel(`${E('allExpenses')} ${formatLKR(sql().total)} ${E('allProjects')}`)).toBe(true);
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
    expect(hasLabel(`${E('allExpenses')} ${formatLKR(sql().total)} ${E('allProjects')}`)).toBe(true);
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

describe('Expenses: search (in the database, so the totals and the paging follow)', () => {
  const ORDER = 'e.day DESC, e.created_at DESC, e.id';
  const NONE = { projectId: null, range: null, categories: [], methods: [], minCents: null, maxCents: null };

  it('"Lanka" finds the shop; the caption says n of m; the tiles total what is found; Clear restores', async () => {
    await renderScreen(<ExpensesScreen />);
    expect(hasLabel(E('search'))).toBe(true);
    await typeInto(E('search'), 'Lanka');
    const want = sql("(e.paid_to LIKE '%lanka%' OR e.note LIKE '%lanka%')");
    expect(want.count).toBeGreaterThan(0);
    expect(shownPayees()).toEqual(payeesBy(ORDER, "(e.paid_to LIKE '%lanka%' OR e.note LIKE '%lanka%')"));
    expect(visibleText()).toContain('Lanka Cement Depot, Welimada');
    expect(visibleText()).not.toContain('March Diesel');
    expect(screen.getByTestId('list-applied').props.children).toBe(E('nOfM', { n: want.count, m: sql().count }));
    expect(hasLabel(`${E('total')} · ${E('allTime')} ${formatLKR(want.total)} ${E('allProjects')}`)).toBe(true);
    expect(hasLabel(`${E('entries')} ${want.count}`)).toBe(true);
    expectClean('expenses search');

    await pressLabel(E('clear'));
    expect(inputValue(E('search'))).toBe('');
    expect(screen.queryByTestId('list-applied')).toBeNull();
    expect(shownPayees()).toEqual(payeesBy(ORDER));
    // the search is plain state, nothing was stored
    for (const k of KEYS) expect([k, getSetting(k)]).toEqual([k, null]);
  });

  it('a number finds the exact amount, with or without commas', async () => {
    await renderScreen(<ExpensesScreen />);
    await typeInto(E('search'), '50000');
    expect(shownPayees()).toEqual(payeesBy(ORDER, 'e.amount_cents = 5000000'));
    expect(visibleText()).toContain('March Cement');
    await typeInto(E('search'), '12,345.50');
    expect(shownPayees()).toEqual(['March Diesel']);
    expect(hasLabel(`${E('total')} · ${E('allTime')} Rs 12,345.50 ${E('allProjects')}`)).toBe(true);
  });

  it('a category is found by its name in the UI language, and two words must both match', async () => {
    await renderScreen(<ExpensesScreen />);
    await typeInto(E('search'), E('cat_fuel'));
    expect(shownPayees()).toEqual(payeesBy(ORDER, "(e.category = 'fuel' OR e.paid_to LIKE '%fuel%' OR e.note LIKE '%fuel%')"));
    expect(visibleText()).toContain('March Diesel');
    await typeInto(E('search'), 'diesel march');
    expect(shownPayees()).toEqual(['March Diesel']);
    await typeInto(E('search'), 'diesel cement');
    expect(visibleText()).toContain(E('noResultsFor', { q: 'diesel cement' }));
    expect(visibleText()).not.toContain(E('noMatches'));
  });

  it('nothing found says so with the text typed, and Clear search brings everything back', async () => {
    await renderScreen(<ExpensesScreen />);
    await typeInto(E('search'), 'zzz-nothing');
    expect(visibleText()).toContain(E('noResultsFor', { q: 'zzz-nothing' }));
    expect(shownPayees()).toEqual([]);
    expectClean('expenses no results');
    // the last "Clear search" is the link under the message (the first is the box's own X); either empties the box
    const links = screen.getAllByLabelText(E('clearSearch'));
    await fireEvent.press(links[links.length - 1]);
    expect(visibleText()).not.toContain(E('noResultsFor', { q: 'zzz-nothing' }));
    expect(shownPayees()).toEqual(payeesBy(ORDER));
  });

  it('narrows together with the project and the other filters', async () => {
    setCurrent(projectId(SCHOOL));
    setSetting('list_expenses_cats', 'materials');
    await renderScreen(<ExpensesScreen />);
    await typeInto(E('search'), 'march');
    expect(shownPayees().sort()).toEqual(['March Cement', 'March Sand']);
    // "m" is what the project and the category leave before the search: the school's four materials expenses
    const m = sql("e.project_id = ? AND e.category = 'materials'", [projectId(SCHOOL)]).count;
    expect(m).toBe(4);
    expect(screen.getByTestId('list-applied').props.children).toBe(`${E('nOfM', { n: 2, m })} · ${E('cat_materials')}`);
  });

  it('expenseWhere: one group per word over payee, note, category, project name, the categories named and the amount', () => {
    const w = expenseWhere({ ...NONE, q: 'Lanka 1,250', categoryNames: { materials: 'Materials', fuel: 'Fuel', other: 'Other' } }, { withPeriod: false });
    const like = "LIKE ? ESCAPE '\\'";
    const group = `(e.paid_to ${like} OR e.note ${like} OR e.category ${like} OR (SELECT pn.name FROM projects pn WHERE pn.id = e.project_id) ${like})`;
    expect(w.sql).toBe(`${expenseWhere(NONE).sql} AND (${group}) AND (${group} OR e.amount_cents = ?)`);
    expect(w.args).toEqual(['%lanka%', '%lanka%', '%lanka%', '%lanka%', '%1,250%', '%1,250%', '%1,250%', '%1,250%', 125000]);
    // a word inside a category's name adds that category; % and _ are bound as literals
    const c = expenseWhere({ ...NONE, q: 'ria 100%_', categoryNames: { materials: 'Materials', fuel: 'Fuel' } });
    expect(c.sql).toContain('OR e.category IN (?))');
    expect(c.args).toEqual(['%ria%', '%ria%', '%ria%', '%ria%', 'materials', '%100\\%\\_%', '%100\\%\\_%', '%100\\%\\_%', '%100\\%\\_%']);
  });
});

describe('expenseWhere: filters become bound values, never SQL text', () => {
  const LIVE_PROJECT = 'EXISTS (SELECT 1 FROM projects px WHERE px.id = e.project_id AND px.deleted_at IS NULL)';

  it('builds placeholders for every value', () => {
    const w = expenseWhere({ projectId: "x' OR 1=1 --", range: { from: '2025-03-01', to: '2025-04-01' }, categories: ['materials', 'fuel'], methods: ['cash'], minCents: 100, maxCents: 900 });
    expect(w.sql).toBe(`e.deleted_at IS NULL AND ${LIVE_PROJECT} AND e.project_id = ? AND e.day >= ? AND e.day < ? AND e.category IN (?, ?) AND e.method IN (?) AND e.amount_cents >= ? AND e.amount_cents <= ?`);
    expect(w.args).toEqual(["x' OR 1=1 --", '2025-03-01', '2025-04-01', 'materials', 'fuel', 'cash', 100, 900]);
    expect(expenseWhere({ projectId: null, range: { from: 'a', to: 'b' }, categories: [], methods: [], minCents: null, maxCents: null, q: '  ' }, { withPeriod: false })).toEqual({
      sql: `e.deleted_at IS NULL AND ${LIVE_PROJECT}`,
      args: [],
    });
  });

  it('the screen shows only the rows the query returns (a capped list is still filtered first)', async () => {
    setSetting('list_expenses_cats', 'fuel');
    await renderScreen(<ExpensesScreen />);
    expect(shownPayees().sort()).toEqual(payeesBy('e.paid_to', "e.category = 'fuel'").sort());
    expectClean('expenses fuel');
  });
});

describe('Expenses: the search reaches past the first page', () => {
  // the list loads 500 rows at first; 501 new ones push every older row behind "Show all"
  beforeAll(() => {
    const culvert = projectId(CULVERT);
    for (let i = 1; i <= 501; i++) saveExpense({ project_id: culvert, day: today(), category: 'food', amount_cents: 100 * i, paid_to: `Bulk ${i}`, method: 'cash', note: null });
  });

  it('an old row behind the cap is found by the search, because the database does the searching', async () => {
    await renderScreen(<ExpensesScreen />);
    expect(hasLabel(E('showAll'))).toBe(true);
    expect(visibleText()).not.toContain('January Steel');
    await typeInto(E('search'), 'steel');
    expect(shownPayees()).toEqual(['January Steel']);
    expect(hasLabel(E('showAll'))).toBe(false);
    expect(screen.getByTestId('list-applied').props.children).toBe(E('nOfM', { n: 1, m: sql().count }));
  });
});
