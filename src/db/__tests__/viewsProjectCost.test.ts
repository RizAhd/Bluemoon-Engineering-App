/**
 * v_project_cost: what each project has cost. Checked against numbers worked out by hand from
 * the demo data (see src/lib/demoData.ts) and against small scenarios.
 *
 * Money is whole cents: Rs 185,000 = 18,500,000.
 */
import { all, first } from '@/db';
import { assignWorker, deleteRecord, payWages, recordWorkDay, saveExpense, saveProject, saveWageEntry, saveWorker } from '@/db/repo';
import type { ProjectCost } from '@/db/types';
import { resetDb, seedDemo } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

let clock: ReturnType<typeof useClock>;
beforeEach(() => {
  resetDb();
  clock = useClock(new Date(2026, 9, 22, 12, 0, 0)); // local noon: the demo's "today" is 2026-10-22 everywhere
});
afterEach(() => clock.restore());

const cost = (name: string) => first<ProjectCost>('SELECT * FROM v_project_cost WHERE name = ?', [name]);

describe('the demo data, worked out by hand', () => {
  // Welimada school, expenses (Rs): 185,000 + 4,200 + 18,500 + 12,000 + 96,400 + 42,000 + 120,000 + 7,800 + 9,650 = 495,550
  // labour, earned (Rs): Nimal 5 x 3,500 + Sunil (4 x 3,800 + 1,900) + Kamal 4 x 2,200 + Ruwan 3 x 5,400 + Anura 2,200 = 61,800
  // labour, given (Rs): Nimal 14,000 + Sunil 10,000 pay + Kamal 5,000 advance = 29,000
  it('Welimada Primary School Building', () => {
    seedDemo();
    expect(cost('Welimada Primary School Building')).toMatchObject({
      status: 'active',
      contract_cents: 1_850_000_000,
      expense_cents: 49_555_000,
      labour_cents: 6_180_000,
      labour_paid_cents: 2_900_000,
    });
  });

  // Badulla culvert, expenses (Rs): 64,300 + 8,500 + 3,100 = 75,900; labour: Saman 3 x 3,500 = 10,500, paid 3,500
  it('Badulla Culvert Repair', () => {
    seedDemo();
    expect(cost('Badulla Culvert Repair')).toMatchObject({
      status: 'active',
      contract_cents: 420_000_000,
      expense_cents: 7_590_000,
      labour_cents: 1_050_000,
      labour_paid_cents: 350_000,
    });
  });

  it('the finished drain job has no spending recorded', () => {
    seedDemo();
    expect(cost('Bandarawela Drain Renovation')).toMatchObject({
      status: 'completed',
      contract_cents: 275_000_000,
      expense_cents: 0,
      labour_cents: 0,
      labour_paid_cents: 0,
    });
  });

  it('total cost (expenses + labour) per project and overall', () => {
    seedDemo();
    const rows = all<ProjectCost>('SELECT * FROM v_project_cost');
    expect(rows).toHaveLength(3);
    const totals = Object.fromEntries(rows.map((r) => [r.name, r.expense_cents + r.labour_cents]));
    expect(totals).toEqual({
      'Welimada Primary School Building': 49_555_000 + 6_180_000,
      'Badulla Culvert Repair': 7_590_000 + 1_050_000,
      'Bandarawela Drain Renovation': 0,
    });
    expect(Object.values(totals).reduce((a, b) => a + b, 0)).toBe(55_735_000 + 8_640_000);
  });

  it('money still owed to workers = labour earned - labour given, per project', () => {
    seedDemo();
    expect(all<{ name: string; owed: number }>('SELECT name, labour_cents - labour_paid_cents AS owed FROM v_project_cost ORDER BY name')).toEqual([
      { name: 'Badulla Culvert Repair', owed: 700_000 },
      { name: 'Bandarawela Drain Renovation', owed: 0 },
      { name: 'Welimada Primary School Building', owed: 3_280_000 },
    ]);
  });
});

describe('small scenarios', () => {
  let a: string;
  let b: string;
  let w: string;
  beforeEach(() => {
    a = saveProject({ name: 'A', status: 'on_hold' });
    b = saveProject({ name: 'B', contract_cents: 5_000_000 });
    w = saveWorker({ name: 'Worker', daily_rate_cents: 100_000 });
    assignWorker({ project_id: a, worker_id: w, rate_cents: 100_000 });
    assignWorker({ project_id: b, worker_id: w, rate_cents: 120_000 });
  });

  it('a project with nothing recorded costs 0, not NULL', () => {
    expect(cost('A')).toMatchObject({ expense_cents: 0, labour_cents: 0, labour_paid_cents: 0 });
    expect(cost('A')?.expense_cents).toBe(0);
  });

  it('passes the status and the contract value through (NULL stays NULL)', () => {
    expect(cost('A')).toMatchObject({ status: 'on_hold', contract_cents: null });
    expect(cost('B')).toMatchObject({ status: 'active', contract_cents: 5_000_000 });
  });

  it('labour counts only work; advances and payments are money given, not cost', () => {
    recordWorkDay({ project_id: a, worker_id: w, day: '2026-10-20', days: 2 });
    saveWageEntry({ worker_id: w, project_id: a, day: '2026-10-20', kind: 'advance', amount_cents: 30_000 });
    payWages({ project_id: a, worker_id: w, day: '2026-10-21', amount_cents: 70_000 });
    expect(cost('A')).toMatchObject({ expense_cents: 0, labour_cents: 200_000, labour_paid_cents: 100_000 });
  });

  it('projects do not leak into each other, even through the same worker', () => {
    recordWorkDay({ project_id: a, worker_id: w, day: '2026-10-20', days: 1 });
    recordWorkDay({ project_id: b, worker_id: w, day: '2026-10-20', days: 1 });
    saveExpense({ project_id: a, day: '2026-10-20', category: 'fuel', amount_cents: 12_345, method: 'cash' });
    expect(cost('A')).toMatchObject({ expense_cents: 12_345, labour_cents: 100_000 });
    expect(cost('B')).toMatchObject({ expense_cents: 0, labour_cents: 120_000 });
  });

  it('a deleted expense or wage entry stops counting; a deleted project disappears', () => {
    const e1 = saveExpense({ project_id: a, day: '2026-10-20', category: 'fuel', amount_cents: 1_000, method: 'cash' });
    saveExpense({ project_id: a, day: '2026-10-20', category: 'fuel', amount_cents: 2_000, method: 'cash' });
    const work = recordWorkDay({ project_id: a, worker_id: w, day: '2026-10-20', days: 1 });
    expect(cost('A')).toMatchObject({ expense_cents: 3_000, labour_cents: 100_000 });
    deleteRecord('expenses', e1);
    deleteRecord('wage_entries', work);
    expect(cost('A')).toMatchObject({ expense_cents: 2_000, labour_cents: 0 });
    deleteRecord('projects', a);
    expect(cost('A')).toBeNull();
    expect(all('SELECT name FROM v_project_cost')).toEqual([{ name: 'B' }]);
  });

  it('an edit to an expense changes the total by the difference only', () => {
    const e = saveExpense({ project_id: a, day: '2026-10-20', category: 'fuel', amount_cents: 1_000, method: 'cash' });
    saveExpense({ id: e, project_id: a, day: '2026-10-20', category: 'fuel', amount_cents: 1_750, method: 'cash' });
    expect(cost('A')?.expense_cents).toBe(1_750);
  });

  it('adds many small amounts exactly (no floating point drift)', () => {
    for (let i = 0; i < 300; i++) saveExpense({ project_id: a, day: '2026-10-20', category: 'other', amount_cents: 10, method: 'cash' });
    for (let i = 0; i < 100; i++) saveExpense({ project_id: a, day: '2026-10-20', category: 'other', amount_cents: 1, method: 'cash' });
    expect(cost('A')?.expense_cents).toBe(3_100);
    expect(first('SELECT typeof(expense_cents) AS t FROM v_project_cost WHERE name = ?', ['A'])).toEqual({ t: 'integer' });
  });

  it('holds amounts above 32-bit range (Rs 21 million is 2.1 billion cents)', () => {
    saveExpense({ project_id: a, day: '2026-10-20', category: 'subcontract', amount_cents: 2_100_000_000, method: 'bank' });
    saveExpense({ project_id: a, day: '2026-10-21', category: 'subcontract', amount_cents: 2_100_000_000, method: 'bank' });
    expect(cost('A')?.expense_cents).toBe(4_200_000_000);
  });
});
