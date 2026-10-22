/**
 * The control bar on the Projects and Workers tabs: sorts, the status / balance chips, the filters in the sheet,
 * what is remembered and what Clear does, each order checked against a query written here. Also the two empty-phone
 * fixes: Projects has one blue "New project" (the floating button; the empty state's own is secondary), and Workers
 * without any project shows one empty state that says to add a project first.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import ProjectsScreen from '@/app/(tabs)/projects';
import WorkersScreen from '@/app/(tabs)/workers';
import { getDb, getSetting, setSetting } from '@/db';
import { saveExpense, saveProject, saveWorker } from '@/db/repo';
import { today } from '@/lib/dates';
import { formatLKR } from '@/lib/money';
import { palette } from '@/theme';
import { resetDb, seedDemo } from '@/test-utils';
import { CULVERT, DRAIN, projectId, rows, SCHOOL, setCurrent } from '@/test-utils/screenData';
import {
  expectClean,
  hasLabel,
  makeTr,
  pressLabel,
  renderScreen,
  screen,
  setTheme,
  smokeScreen,
  visibleText,
  visibleTexts,
} from '@/test-utils/screenKit';

const E = makeTr('en');

/** These names in the order the screen shows them. */
function shown(names: string[]): string[] {
  const wanted = new Set(names);
  return visibleTexts().filter((s) => wanted.has(s));
}

// ---------------------------------------------------------------- Projects

describe('Projects: sort and status', () => {
  const ALPHA = 'Alpha Big Job';
  const ZETA = 'Zeta Small Job';
  const ACTIVE = [ALPHA, CULVERT, SCHOOL, ZETA];

  beforeAll(() => {
    resetDb();
    seedDemo();
    const alpha = saveProject({ name: ALPHA, status: 'active' }); // no contract value
    const zeta = saveProject({ name: ZETA, status: 'active', contract_cents: 10_000_000 });
    saveExpense({ project_id: alpha, day: today(), category: 'materials', amount_cents: 90_000_000, paid_to: 'Alpha shop', method: 'cash', note: null });
    saveExpense({ project_id: zeta, day: today(), category: 'materials', amount_cents: 9_000_000, paid_to: 'Zeta shop', method: 'cash', note: null });
    // a known order of creation: the culvert newest, then Zeta, the school, Alpha
    const at: [string, string][] = [
      [CULVERT, '2026-05-04T08:00:00.000Z'],
      [ZETA, '2026-05-03T08:00:00.000Z'],
      [SCHOOL, '2026-05-02T08:00:00.000Z'],
      [ALPHA, '2026-05-01T08:00:00.000Z'],
      [DRAIN, '2026-04-01T08:00:00.000Z'],
    ];
    for (const [name, iso] of at) getDb().runSync('UPDATE projects SET created_at = ? WHERE name = ?', [iso, name]);
  });

  beforeEach(() => {
    setSetting('lang', 'en');
    setSetting('theme', 'light');
    setSetting('list_projects_sort', null);
    setSetting('list_projects_status', null);
  });

  /** The active group's order straight from the database for one ORDER BY. */
  const activeBy = (order: string) =>
    rows<{ name: string }>(
      `SELECT v.name FROM v_project_cost v JOIN projects p ON p.id = v.project_id WHERE v.status = 'active' ORDER BY ${order}`,
    ).map((r) => r.name);

  it('by name by default, inside the status groups, with no caption', async () => {
    await renderScreen(<ProjectsScreen />);
    expect(shown(ACTIVE)).toEqual([ALPHA, CULVERT, SCHOOL, ZETA]);
    expect(visibleText()).toContain(`${E('status_active')} (4)`);
    expect(screen.queryByTestId('list-applied')).toBeNull();
    expectClean('projects default');
  });

  it.each([
    ['sort_cost', [ALPHA, SCHOOL, ZETA, CULVERT], '(v.expense_cents + v.labour_cents) DESC'],
    ['sort_used', [ZETA, SCHOOL, CULVERT, ALPHA], 'CASE WHEN v.contract_cents > 0 THEN (v.expense_cents + v.labour_cents) * 1.0 / v.contract_cents ELSE -1 END DESC'],
    ['sort_newest', [CULVERT, ZETA, SCHOOL, ALPHA], 'p.created_at DESC'],
    ['sort_name', [ALPHA, CULVERT, SCHOOL, ZETA], 'v.name COLLATE NOCASE'],
  ] as const)('%s orders the projects in the database', async (key, expected, order) => {
    await renderScreen(<ProjectsScreen />);
    await pressLabel(E('filterSort'));
    await pressLabel(E(key));
    await pressLabel(E('done'));
    expect(activeBy(order)).toEqual(expected);
    expect(shown(ACTIVE)).toEqual(expected);
    if (key === 'sort_name') expect(screen.queryByTestId('list-applied')).toBeNull();
    else {
      expect(screen.getByTestId('list-applied').props.children).toBe(E(key));
      expect(getSetting('list_projects_sort')).toBe(key.slice(5));
      expect(hasLabel(E('filterSortActive', { n: 1 }))).toBe(true);
    }
  });

  it('the status chip and the sort are remembered, shown in the caption, and Clear resets both', async () => {
    await renderScreen(<ProjectsScreen />);
    await pressLabel(`${E('status_active')} 4`);
    await pressLabel(E('filterSort'));
    await pressLabel(E('sort_cost'));
    await pressLabel(E('done'));
    await screen.unmount();

    expect([getSetting('list_projects_status'), getSetting('list_projects_sort')]).toEqual(['active', 'cost']);
    await renderScreen(<ProjectsScreen />);
    expect(screen.getByTestId('list-applied').props.children).toBe(`${E('status_active')} · ${E('sort_cost')}`);
    expect(visibleText()).not.toContain(DRAIN);
    expect(shown(ACTIVE)).toEqual([ALPHA, SCHOOL, ZETA, CULVERT]);
    await pressLabel(E('clear'));
    expect([getSetting('list_projects_status'), getSetting('list_projects_sort')]).toEqual([null, null]);
    expect(visibleText()).toContain(DRAIN);
    expect(shown(ACTIVE)).toEqual([ALPHA, CULVERT, SCHOOL, ZETA]);
  });
});

describe('Projects on an empty phone: one blue New project', () => {
  beforeAll(() => resetDb());

  it.each(['light', 'dark'] as const)('the empty state button is the secondary style (%s); the floating button is the primary one', async (scheme) => {
    setSetting('lang', 'en');
    setSetting('theme', 'light');
    await renderScreen(<ProjectsScreen />);
    if (scheme === 'dark') await setTheme('dark');
    const buttons = screen.getAllByLabelText(E('newProject'));
    expect(buttons).toHaveLength(1);
    const style = StyleSheet.flatten(buttons[0].props.style);
    expect(style.backgroundColor).toBe(palette[scheme].card);
    expect(style.backgroundColor).not.toBe(palette[scheme].primary);
    expect(style.borderColor).toBe(palette[scheme].borderStrong);
    await pressLabel(E('newProject'));
    expect(router.push).toHaveBeenCalledWith('/project/form');
  });
});

// ---------------------------------------------------------------- Workers

describe('Workers: balance chips, status, sort', () => {
  beforeAll(() => {
    resetDb();
    seedDemo();
    saveWorker({ name: 'Old Hand', trade: 'Painter', daily_rate_cents: 300_000, active: false });
  });

  beforeEach(() => {
    setSetting('lang', 'en');
    setSetting('theme', 'light');
    setCurrent(null);
    for (const f of ['balance', 'status', 'sort']) setSetting(`list_workers_${f}`, null);
  });

  const ALL = () => rows<{ name: string }>('SELECT name FROM workers WHERE deleted_at IS NULL').map((r) => r.name);
  /** Every worker overall (All projects), active first, in one ORDER BY over v_worker_balance plus days. */
  const overall = (where: string, order: string) =>
    rows<{ name: string }>(
      `SELECT name FROM (SELECT v.*, COALESCE((SELECT SUM(we.days) FROM wage_entries we WHERE we.worker_id = v.worker_id AND we.kind = 'work' AND we.deleted_at IS NULL), 0) AS days
                         FROM v_worker_balance v) WHERE ${where} ORDER BY active DESC, ${order}`,
    ).map((r) => r.name);

  it('the chips count the workers to pay, with advance over and settled, from the database', async () => {
    await renderScreen(<WorkersScreen />);
    const n = (where: string) => rows<{ n: number }>(`SELECT COUNT(*) AS n FROM v_worker_balance WHERE ${where}`)[0].n;
    expect(hasLabel(`${E('weOwe')} ${n('balance_cents > 0')}`)).toBe(true);
    expect(hasLabel(`${E('workerOwes')} ${n('balance_cents < 0')}`)).toBe(true);
    expect(hasLabel(`${E('settled')} ${n('balance_cents = 0')}`)).toBe(true);
    expect(shown(ALL())).toEqual(overall('1 = 1', 'name COLLATE NOCASE'));
    expectClean('workers default');
  });

  it('To pay shows only the workers with money owed, and the tiles add up those', async () => {
    await renderScreen(<WorkersScreen />);
    const pay = rows<{ n: number }>('SELECT COUNT(*) AS n FROM v_worker_balance WHERE balance_cents > 0')[0].n;
    await pressLabel(`${E('weOwe')} ${pay}`);
    expect(shown(ALL())).toEqual(overall('balance_cents > 0', 'name COLLATE NOCASE'));
    expect(visibleText()).not.toContain('Old Hand');
    const owed = rows<{ s: number }>('SELECT SUM(balance_cents) AS s FROM v_worker_balance WHERE balance_cents > 0')[0].s;
    expect(hasLabel(`${E('weOwe')} ${formatLKR(owed)}`)).toBe(true);
    expect(getSetting('list_workers_balance')).toBe('pay');
    expect(screen.getByTestId('list-applied').props.children).toBe(E('weOwe'));
  });

  it.each([
    ['sort_toPay', 'balance_cents DESC, name COLLATE NOCASE'],
    ['sort_days', 'days DESC, name COLLATE NOCASE'],
    ['sort_rate', 'daily_rate_cents DESC, name COLLATE NOCASE'],
  ] as const)('All projects, %s', async (key, order) => {
    await renderScreen(<WorkersScreen />);
    await pressLabel(E('filterSort'));
    await pressLabel(E(key));
    await pressLabel(E('done'));
    expect(shown(ALL())).toEqual(overall('1 = 1', order));
    expect(screen.getByTestId('list-applied').props.children).toBe(E(key));
  });

  it('sorted by days, each row says how many days the worker did', async () => {
    setSetting('list_workers_sort', 'days');
    await renderScreen(<WorkersScreen />);
    const nimal = rows<{ d: number }>("SELECT SUM(days) AS d FROM wage_entries w JOIN workers k ON k.id = w.worker_id WHERE k.name = 'Nimal Perera' AND w.kind = 'work' AND w.deleted_at IS NULL")[0].d;
    expect(visibleText()).toContain(`Mason · Rs 3,500 / ${E('day')} · ${E('daysCount', { n: nimal })}`);
  });

  it('on the school, sorting by days uses the days on that project', async () => {
    setCurrent(projectId(SCHOOL));
    setSetting('list_workers_sort', 'days');
    await renderScreen(<WorkersScreen />);
    const want = rows<{ name: string }>(
      'SELECT name FROM v_project_worker_balance WHERE project_id = ? ORDER BY active DESC, days_total DESC, name COLLATE NOCASE',
      [projectId(SCHOOL)],
    ).map((r) => r.name);
    expect(shown(ALL())).toEqual(want);
    expect(visibleText()).not.toContain('Saman Kumara');
  });

  it('Left (in the sheet) shows only the workers who left; Working only the others', async () => {
    await renderScreen(<WorkersScreen />);
    await pressLabel(E('filterSort'));
    await pressLabel(E('workerLeft'));
    await pressLabel(E('done'));
    expect(shown(ALL())).toEqual(['Old Hand']);
    expect(visibleText()).toContain(`${E('inactive')} (1)`);
    expect(hasLabel(E('filterSortActive', { n: 1 }))).toBe(true);
    await pressLabel(E('filterSortActive', { n: 1 }));
    await pressLabel(E('workerActive'));
    await pressLabel(E('done'));
    expect(shown(ALL())).toEqual(overall('active = 1', 'name COLLATE NOCASE'));
    expect(getSetting('list_workers_status')).toBe('active');
  });

  it('on a project: Settled shows the culvert worker who is paid up; the choice and the sort are remembered; Clear resets', async () => {
    setCurrent(projectId(CULVERT));
    await renderScreen(<WorkersScreen />);
    const settled = rows<{ name: string }>('SELECT name FROM v_project_worker_balance WHERE project_id = ? AND balance_cents = 0 ORDER BY name', [projectId(CULVERT)]).map((r) => r.name);
    await pressLabel(`${E('settled')} ${settled.length}`);
    await pressLabel(E('filterSort'));
    await pressLabel(E('sort_rate'));
    await pressLabel(E('done'));
    expect(shown(ALL())).toEqual(settled);
    await screen.unmount();

    await renderScreen(<WorkersScreen />);
    expect(screen.getByTestId('list-applied').props.children).toBe(`${E('settled')} · ${E('sort_rate')}`);
    expect(shown(ALL())).toEqual(settled);
    await pressLabel(E('clear'));
    expect(['balance', 'status', 'sort'].map((f) => getSetting(`list_workers_${f}`))).toEqual([null, null, null]);
    expect(visibleText()).toContain(`${E('projectWorkers')} (2)`);
  });

  it('a balance with no workers is a disabled chip', async () => {
    setCurrent(projectId(CULVERT));
    await renderScreen(<WorkersScreen />);
    const adv = rows<{ n: number }>('SELECT COUNT(*) AS n FROM v_project_worker_balance WHERE project_id = ? AND balance_cents < 0', [projectId(CULVERT)])[0].n;
    expect(adv).toBe(0);
    expect(screen.getByLabelText(`${E('workerOwes')} 0`).props.accessibilityState.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------- Workers with no project

smokeScreen('Workers tab with no project at all', () => <WorkersScreen />, {
  db: 'empty',
  variants: [
    {
      name: 'one empty state: add a project first, with its button; no banner and no daily-pay row',
      expect: (tr) => [tr('workers'), tr('addProjectFirst'), tr('addProjectFirstHint'), tr('newProject')],
      absent: (tr) => [tr('noProjectSelected'), tr('chooseProjectFirstHint'), tr('todaysWork'), tr('noWorkers'), tr('chooseProject')],
      check: async () => {
        // one New project button (the floating one is hidden without projects), and it opens the project form
        expect(screen.getAllByLabelText(E('newProject'))).toHaveLength(1);
        await pressLabel(E('newProject'));
        expect(router.push).toHaveBeenCalledWith('/project/form');
      },
      langs: ['en'],
    },
    {
      name: 'the same in Sinhala and Tamil',
      expect: (tr) => [tr('addProjectFirst'), tr('addProjectFirstHint'), tr('newProject')],
      absent: (tr) => [tr('noProjectSelected'), tr('todaysWork'), tr('noWorkers')],
      langs: ['si', 'ta'],
    },
  ],
});

describe('Workers with workers but no project', () => {
  beforeAll(() => {
    resetDb();
    saveWorker({ name: 'Lone Mason', trade: 'Mason', daily_rate_cents: 350_000 });
  });

  it('lists the worker without the "choose a project" banner or the daily-pay row', async () => {
    setSetting('lang', 'en');
    await renderScreen(<WorkersScreen />);
    expect(visibleText()).toContain('Lone Mason');
    expect(visibleText()).not.toContain(E('noProjectSelected'));
    expect(visibleText()).not.toContain(E('todaysWork'));
    expect(visibleText()).not.toContain(E('addProjectFirst'));
    expectClean('workers without projects');
  });
});
