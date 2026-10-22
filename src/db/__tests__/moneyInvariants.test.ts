/**
 * Money invariants. Whatever the owner does, the numbers on every screen must add up:
 * a project's total cost is the sum of its parts, every stored amount is a whole number of
 * cents, nothing stored is negative, and the views agree with the raw rows.
 */
import { all, closeDb, first } from '@/db';
import {
  assignWorker,
  deleteRecord,
  payWages,
  recordWorkDay,
  removeWorkDay,
  saveExpense,
  saveProject,
  saveWageEntry,
  saveWorker,
} from '@/db/repo';
import type { ExpenseCategory } from '@/db/types';
import { EXPENSE_CATEGORIES } from '@/db/types';
import { resetDb, seedDemo } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(120_000);

let clock: ReturnType<typeof useClock>;
beforeEach(() => {
  resetDb();
  clock = useClock(new Date(2026, 9, 22, 12, 0, 0));
});
afterEach(() => clock.restore());

// ---------------------------------------------------------------- independent arithmetic from the raw rows

interface Raw {
  expenses: { project_id: string; category: string; amount_cents: number }[];
  wages: { project_id: string | null; worker_id: string; kind: string; amount_cents: number; days: number | null }[];
  projects: string[];
  workers: string[];
}

function raw(): Raw {
  return {
    expenses: all('SELECT project_id, category, amount_cents FROM expenses WHERE deleted_at IS NULL'),
    wages: all('SELECT project_id, worker_id, kind, amount_cents, days FROM wage_entries WHERE deleted_at IS NULL'),
    projects: all<{ id: string }>('SELECT id FROM projects WHERE deleted_at IS NULL').map((r) => r.id),
    workers: all<{ id: string }>('SELECT id FROM workers WHERE deleted_at IS NULL').map((r) => r.id),
  };
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Every number the screens show, recomputed from the base rows with plain JavaScript. */
function reconcile() {
  const r = raw();
  // per project: the project card, the dashboard, the PDF header
  const cost = all<{ project_id: string; expense_cents: number; labour_cents: number; labour_paid_cents: number }>('SELECT * FROM v_project_cost');
  expect(cost.map((c) => c.project_id).sort()).toEqual([...r.projects].sort());
  for (const c of cost) {
    const exp = sum(r.expenses.filter((e) => e.project_id === c.project_id).map((e) => e.amount_cents));
    const labour = sum(r.wages.filter((w) => w.project_id === c.project_id && w.kind === 'work').map((w) => w.amount_cents));
    const given = sum(r.wages.filter((w) => w.project_id === c.project_id && w.kind !== 'work').map((w) => w.amount_cents));
    expect({ project: c.project_id, expense: c.expense_cents, labour: c.labour_cents, given: c.labour_paid_cents }).toEqual({ project: c.project_id, expense: exp, labour, given });
  }

  // per worker: the workers tab
  const balances = all<{ worker_id: string; earned_cents: number; advance_cents: number; paid_cents: number; balance_cents: number }>('SELECT * FROM v_worker_balance');
  expect(balances.map((b) => b.worker_id).sort()).toEqual([...r.workers].sort());
  for (const b of balances) {
    const mine = r.wages.filter((w) => w.worker_id === b.worker_id);
    const earned = sum(mine.filter((w) => w.kind === 'work').map((w) => w.amount_cents));
    const advance = sum(mine.filter((w) => w.kind === 'advance').map((w) => w.amount_cents));
    const paid = sum(mine.filter((w) => w.kind === 'payment').map((w) => w.amount_cents));
    expect({ worker: b.worker_id, earned: b.earned_cents, advance: b.advance_cents, paid: b.paid_cents, balance: b.balance_cents }).toEqual({
      worker: b.worker_id,
      earned,
      advance,
      paid,
      balance: earned - advance - paid,
    });
  }

  // per worker per project: the project's worker list. Must equal the raw rows of that pair.
  for (const line of all<{ project_id: string; worker_id: string; earned_cents: number; advance_cents: number; paid_cents: number; balance_cents: number; days_total: number }>(
    'SELECT * FROM v_project_worker_balance',
  )) {
    const mine = r.wages.filter((w) => w.project_id === line.project_id && w.worker_id === line.worker_id);
    const earned = sum(mine.filter((w) => w.kind === 'work').map((w) => w.amount_cents));
    const given = sum(mine.filter((w) => w.kind !== 'work').map((w) => w.amount_cents));
    expect({ earned: line.earned_cents, given: line.advance_cents + line.paid_cents, balance: line.balance_cents }).toEqual({ earned, given, balance: earned - given });
    expect(line.days_total).toBeCloseTo(sum(mine.filter((w) => w.kind === 'work').map((w) => w.days ?? 0)), 9);
  }

  // per day: the daily sheet adds up to the project labour
  for (const c of cost) {
    expect(first('SELECT COALESCE(SUM(work_cents), 0) AS w, COALESCE(SUM(paid_cents + advance_cents), 0) AS g FROM v_wage_day WHERE project_id = ?', [c.project_id])).toEqual({
      w: c.labour_cents,
      g: c.labour_paid_cents,
    });
  }

  // grand totals from the other direction
  const expensesByCategory = all<{ category: string; s: number }>('SELECT category, SUM(amount_cents) AS s FROM expenses WHERE deleted_at IS NULL AND project_id IN (SELECT id FROM projects WHERE deleted_at IS NULL) GROUP BY category');
  expect(sum(expensesByCategory.map((c) => c.s))).toBe(sum(cost.map((c) => c.expense_cents)));
  return { cost, balances };
}

// ---------------------------------------------------------------- stored values

const MONEY_COLUMNS: Record<string, string[]> = {
  projects: ['contract_cents'],
  expenses: ['amount_cents'],
  workers: ['daily_rate_cents'],
  wage_entries: ['amount_cents'],
  project_workers: ['rate_cents'],
};

function checkStoredMoney() {
  for (const [table, cols] of Object.entries(MONEY_COLUMNS)) {
    for (const col of cols) {
      const types = all<{ t: string }>(`SELECT DISTINCT typeof(${col}) AS t FROM ${table}`).map((r) => r.t);
      for (const t of types) expect({ table, col, type: t === 'null' ? 'integer' : t }).toEqual({ table, col, type: 'integer' }); // NULL is only allowed for a missing contract value
      if (col !== 'contract_cents') expect(types).not.toContain('null');
      expect({ table, col, negatives: first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} < 0`)?.n }).toEqual({ table, col, negatives: 0 });
    }
  }
  // paid and earned amounts are strictly positive
  expect(first('SELECT COUNT(*) AS n FROM expenses WHERE amount_cents <= 0')).toEqual({ n: 0 });
  expect(first('SELECT COUNT(*) AS n FROM wage_entries WHERE amount_cents <= 0')).toEqual({ n: 0 });
  // days of work are positive and at most a month
  expect(first('SELECT COUNT(*) AS n FROM wage_entries WHERE kind = \'work\' AND (days IS NULL OR days <= 0 OR days > 31)')).toEqual({ n: 0 });
  expect(first('SELECT COUNT(*) AS n FROM wage_entries WHERE kind != \'work\' AND days IS NOT NULL')).toEqual({ n: 0 });
}

const VIEW_MONEY: Record<string, string[]> = {
  v_project_cost: ['expense_cents', 'labour_cents', 'labour_paid_cents'],
  v_worker_balance: ['earned_cents', 'advance_cents', 'paid_cents', 'balance_cents', 'daily_rate_cents'],
  v_project_worker_balance: ['rate_cents', 'earned_cents', 'advance_cents', 'paid_cents', 'balance_cents'],
  v_wage_day: ['work_cents', 'paid_cents', 'advance_cents'],
};

function checkViewMoney() {
  for (const [view, cols] of Object.entries(VIEW_MONEY)) {
    for (const col of cols) {
      const types = all<{ t: string }>(`SELECT DISTINCT typeof(${col}) AS t FROM ${view}`).map((r) => r.t);
      expect({ view, col, types: types.filter((t) => t !== 'integer') }).toEqual({ view, col, types: [] });
    }
  }
  // costs and amounts handed over are never negative; only a balance may be (an advance not yet worked off)
  for (const [view, col] of [
    ['v_project_cost', 'expense_cents'],
    ['v_project_cost', 'labour_cents'],
    ['v_project_cost', 'labour_paid_cents'],
    ['v_worker_balance', 'earned_cents'],
    ['v_worker_balance', 'advance_cents'],
    ['v_worker_balance', 'paid_cents'],
    ['v_project_worker_balance', 'earned_cents'],
    ['v_wage_day', 'work_cents'],
  ]) {
    expect({ view, col, negatives: first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${view} WHERE ${col} < 0`)?.n }).toEqual({ view, col, negatives: 0 });
  }
}

// ---------------------------------------------------------------- tests

describe('demo data', () => {
  beforeEach(() => {
    seedDemo();
  });

  it('every view agrees with the raw rows', () => {
    const { cost, balances } = reconcile();
    expect(cost).toHaveLength(3);
    expect(balances).toHaveLength(6);
  });

  it('total cost on the dashboard is the sum of the cards, the cards the sum of their parts', () => {
    const active = all<{ name: string; expense_cents: number; labour_cents: number }>("SELECT * FROM v_project_cost WHERE status != 'completed'");
    expect(active).toHaveLength(2);
    const dashboard = sum(active.map((p) => p.expense_cents + p.labour_cents));
    expect(dashboard).toBe(49_555_000 + 6_180_000 + 7_590_000 + 1_050_000);
    // the parts, listed by category and by worker
    const categories = sum(all<{ s: number }>("SELECT SUM(amount_cents) AS s FROM expenses WHERE deleted_at IS NULL GROUP BY category").map((r) => r.s));
    const workers = sum(all<{ earned_cents: number }>('SELECT earned_cents FROM v_worker_balance').map((r) => r.earned_cents));
    expect(categories + workers).toBe(dashboard);
  });

  it('what is owed to workers on the dashboard equals the sum of the project figures', () => {
    const owedByWorker = first<{ s: number }>('SELECT COALESCE(SUM(CASE WHEN balance_cents > 0 THEN balance_cents END), 0) AS s FROM v_worker_balance')?.s;
    const owedByProject = first<{ s: number }>('SELECT SUM(labour_cents - labour_paid_cents) AS s FROM v_project_cost')?.s;
    expect(owedByWorker).toBe(3_980_000);
    expect(owedByProject).toBe(owedByWorker);
  });

  it('all stored amounts are whole positive cents; all view amounts are whole numbers', () => {
    checkStoredMoney();
    checkViewMoney();
  });

  it('expenses by category: nine categories exist, the demo uses eight, the sum is the project total', () => {
    expect(EXPENSE_CATEGORIES).toHaveLength(9);
    const school = first<{ id: string }>("SELECT id FROM projects WHERE name LIKE 'Welimada%'")?.id as string;
    const rows = all<{ category: ExpenseCategory; s: number }>('SELECT category, SUM(amount_cents) AS s FROM expenses WHERE project_id = ? AND deleted_at IS NULL GROUP BY category ORDER BY category', [school]);
    expect(rows.map((r) => [r.category, r.s])).toEqual([
      ['food', 420_000],
      ['fuel', 1_200_000],
      ['machinery', 4_200_000],
      ['materials', 18_500_000 + 9_640_000],
      ['subcontract', 12_000_000],
      ['tools', 780_000],
      ['transport', 1_850_000],
      ['utilities', 965_000],
    ]);
    expect(sum(rows.map((r) => r.s))).toBe(49_555_000);
  });
});

describe('after editing and deleting', () => {
  it('stays consistent through a series of corrections', () => {
    seedDemo();
    const school = first<{ id: string }>("SELECT id FROM projects WHERE name LIKE 'Welimada%'")?.id as string;
    const culvert = first<{ id: string }>("SELECT id FROM projects WHERE name LIKE 'Badulla%'")?.id as string;
    const nimal = first<{ id: string }>("SELECT id FROM workers WHERE name LIKE 'Nimal%'")?.id as string;
    const exp = all<{ id: string }>('SELECT id FROM expenses WHERE project_id = ? ORDER BY day, id', [school]);

    saveExpense({ id: exp[0].id, project_id: school, day: '2026-10-01', category: 'materials', amount_cents: 12_345, method: 'cash' }); // edit
    reconcile();
    deleteRecord('expenses', exp[1].id);
    reconcile();
    removeWorkDay(school, nimal, '2026-10-21');
    reconcile();
    recordWorkDay({ project_id: school, worker_id: nimal, day: '2026-10-21', days: 0.5 });
    payWages({ project_id: school, worker_id: nimal, day: '2026-10-22', amount_cents: 1 });
    reconcile();
    deleteRecord('projects', culvert);
    const { cost } = reconcile();
    expect(cost.map((c) => c.project_id)).not.toContain(culvert);
    checkStoredMoney();
    checkViewMoney();
  });
});

describe('whole cents', () => {
  it.each([
    [350_000, 0.5],
    [333_333, 0.5],
    [333_333, 1.5],
    [100_001, 0.25],
    [99_999, 0.1],
    [123_457, 0.3],
    [1, 0.5],
    [1, 31],
    [199_999_999, 31],
    [250_050, 1 / 3],
    [7, 0.7],
  ])('a day rate of %p cents for %p days is stored as a whole number of cents', (rate, days) => {
    const p = saveProject({ name: 'P' });
    const w = saveWorker({ name: 'W', daily_rate_cents: rate });
    assignWorker({ project_id: p, worker_id: w, rate_cents: rate });
    const id = recordWorkDay({ project_id: p, worker_id: w, day: '2026-10-20', days });
    const row = first<{ amount_cents: number; t: string }>('SELECT amount_cents, typeof(amount_cents) AS t FROM wage_entries WHERE id = ?', [id]);
    expect(row?.t).toBe('integer');
    expect(Number.isInteger(row?.amount_cents)).toBe(true);
    expect(row?.amount_cents).toBe(Math.round(days * rate));
    expect(Math.abs((row?.amount_cents ?? 0) - days * rate)).toBeLessThanOrEqual(0.5 + 1e-6); // never off by more than half a cent
    expect(first('SELECT balance_cents FROM v_worker_balance WHERE worker_id = ?', [w])).toEqual({ balance_cents: row?.amount_cents });
  });

  it('refuses an amount that is not whole cents instead of storing a fraction', () => {
    const p = saveProject({ name: 'P' });
    expect(() => saveExpense({ project_id: p, day: '2026-10-20', category: 'fuel', amount_cents: 1250.5, method: 'cash' })).toThrow();
    expect(first('SELECT COUNT(*) AS n FROM expenses')).toEqual({ n: 0 });
  });
});

describe('a long random working history', () => {
  /** Small deterministic random generator (mulberry32) so a failure can be replayed. */
  function rng(seed: number) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  for (const seed of [1, 7, 2026]) {
    it(`seed ${seed}: 120 random actions, and every figure still adds up after each batch of 20`, () => {
      const rand = rng(seed);
      const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
      const projects = ['North', 'South', 'East'].map((name) => saveProject({ name, contract_cents: 100_000_000 }));
      const workers = ['A', 'B', 'C', 'D'].map((name, i) => saveWorker({ name, daily_rate_cents: 200_000 + i * 12_345 }));
      for (const p of projects) for (const w of workers) assignWorker({ project_id: p, worker_id: w, rate_cents: 150_000 + Math.floor(rand() * 200_000) });
      const days = Array.from({ length: 10 }, (_, i) => `2026-10-${String(10 + i).padStart(2, '0')}`);
      const liveIds = (table: string) => all<{ id: string }>(`SELECT id FROM ${table} WHERE deleted_at IS NULL`).map((r) => r.id);
      const hasLive = (table: string) => liveIds(table).length > 0;

      for (let step = 1; step <= 120; step++) {
        clock.tick(1);
        const action = Math.floor(rand() * 8);
        const day = pick(days);
        const project = pick(projects);
        const worker = pick(workers);
        if (action === 0) recordWorkDay({ project_id: project, worker_id: worker, day, days: pick([0.5, 1, 1.5, 2, 0.25]) });
        else if (action === 1) payWages({ project_id: project, worker_id: worker, day, amount_cents: 1 + Math.floor(rand() * 500_000) });
        else if (action === 2) saveExpense({ project_id: project, day, category: pick([...EXPENSE_CATEGORIES]), amount_cents: 1 + Math.floor(rand() * 9_000_000), method: 'cash' });
        else if (action === 3) saveWageEntry({ worker_id: worker, project_id: project, day, kind: 'advance', amount_cents: 1 + Math.floor(rand() * 100_000) });
        else if (action === 4) removeWorkDay(project, worker, day);
        else if (action === 5 && hasLive('expenses')) deleteRecord('expenses', pick(liveIds('expenses')));
        else if (action === 6 && hasLive('wage_entries')) deleteRecord('wage_entries', pick(liveIds('wage_entries')));
        else if (action === 7) {
          const e = all<{ id: string }>('SELECT id FROM expenses WHERE deleted_at IS NULL LIMIT 1');
          if (e[0]) saveExpense({ id: e[0].id, project_id: project, day, category: 'other', amount_cents: 1 + Math.floor(rand() * 1_000_000), method: 'bank' });
        }
        if (step % 20 === 0) {
          reconcile();
          checkStoredMoney();
          checkViewMoney();
        }
      }
      // and the books are the same after closing and reopening the app
      const before = reconcile();
      closeDb();
      expect(reconcile()).toEqual(before);
      expect(before.cost).toHaveLength(3);
    });
  }
});
