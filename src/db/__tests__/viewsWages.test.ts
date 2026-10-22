/**
 * The wage views: v_project_worker_balance (a worker's earned / advance / paid / balance on one
 * project), v_wage_day (one line per worker, project and day) and v_worker_balance (a worker
 * across all projects). Hand-computed from the demo data and from small scenarios.
 */
import { all, first, getDb, mergeRow, newId } from '@/db';
import { assignWorker, deleteRecord, payWages, recordWorkDay, saveProject, saveWageEntry, saveWorker, unassignWorker } from '@/db/repo';
import type { ProjectWorkerBalance, WageDay, WorkerBalance } from '@/db/types';
import { addDays } from '@/lib/dates';
import { resetDb, seedDemo } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

const TODAY = '2026-10-22';
const d = (n: number) => addDays(TODAY, -n);

let clock: ReturnType<typeof useClock>;
beforeEach(() => {
  resetDb();
  clock = useClock(new Date(2026, 9, 22, 12, 0, 0));
});
afterEach(() => clock.restore());

const idOf = (table: 'projects' | 'workers', name: string) => first<{ id: string }>(`SELECT id FROM ${table} WHERE name LIKE ?`, [`${name}%`])?.id as string;
const pwb = (project: string, worker: string) =>
  first<ProjectWorkerBalance>('SELECT * FROM v_project_worker_balance WHERE project_id = ? AND worker_id = ?', [project, worker]);
const wb = (worker: string) => first<WorkerBalance>('SELECT * FROM v_worker_balance WHERE worker_id = ?', [worker]);
const day = (project: string, worker: string, dayStr: string) =>
  first<WageDay>('SELECT * FROM v_wage_day WHERE project_id = ? AND worker_id = ? AND day = ?', [project, worker, dayStr]);

describe('the demo data, worked out by hand', () => {
  let school: string;
  let culvert: string;
  const who: Record<string, string> = {};
  beforeEach(() => {
    seedDemo();
    school = idOf('projects', 'Welimada');
    culvert = idOf('projects', 'Badulla');
    for (const n of ['Nimal', 'Sunil', 'Kamal', 'Ruwan', 'Anura', 'Saman']) who[n] = idOf('workers', n);
  });

  it('v_project_worker_balance, Welimada school', () => {
    // Nimal 5 days x 3,500 = 17,500, paid 14,000. Sunil 4.5 days = 17,100, paid 10,000.
    // Kamal 4 days x 2,200 = 8,800, advance 5,000. Ruwan 3 x 1.5 days x 3,600 = 16,200. Anura 1 day = 2,200.
    const expected: Record<string, Partial<ProjectWorkerBalance>> = {
      Nimal: { rate_cents: 350_000, earned_cents: 1_750_000, advance_cents: 0, paid_cents: 1_400_000, balance_cents: 350_000, days_total: 5 },
      Sunil: { rate_cents: 380_000, earned_cents: 1_710_000, advance_cents: 0, paid_cents: 1_000_000, balance_cents: 710_000, days_total: 4.5 },
      Kamal: { rate_cents: 220_000, earned_cents: 880_000, advance_cents: 500_000, paid_cents: 0, balance_cents: 380_000, days_total: 4 },
      Ruwan: { rate_cents: 360_000, earned_cents: 1_620_000, advance_cents: 0, paid_cents: 0, balance_cents: 1_620_000, days_total: 4.5 },
      Anura: { rate_cents: 220_000, earned_cents: 220_000, advance_cents: 0, paid_cents: 0, balance_cents: 220_000, days_total: 1 },
    };
    expect(all('SELECT worker_id FROM v_project_worker_balance WHERE project_id = ?', [school])).toHaveLength(5);
    for (const [name, want] of Object.entries(expected)) expect({ label: name, ...pwb(school, who[name]) }).toMatchObject({ label: name, ...want });
  });

  it('v_project_worker_balance, Badulla culvert (Kamal is assigned but has not worked there)', () => {
    expect(all('SELECT worker_id FROM v_project_worker_balance WHERE project_id = ?', [culvert])).toHaveLength(2);
    expect(pwb(culvert, who.Saman)).toMatchObject({ rate_cents: 350_000, earned_cents: 1_050_000, paid_cents: 350_000, balance_cents: 700_000, days_total: 3 });
    expect(pwb(culvert, who.Kamal)).toMatchObject({ rate_cents: 230_000, earned_cents: 0, advance_cents: 0, paid_cents: 0, balance_cents: 0, days_total: 0 });
  });

  it('the same worker on two projects is independent: Kamal earned on the school, nothing on the culvert, at two rates', () => {
    expect(pwb(school, who.Kamal)?.rate_cents).toBe(220_000);
    expect(pwb(culvert, who.Kamal)?.rate_cents).toBe(230_000);
    expect(pwb(school, who.Kamal)?.balance_cents).toBe(380_000);
    expect(pwb(culvert, who.Kamal)?.balance_cents).toBe(0);
  });

  it('per project, the workers add up to the project cost', () => {
    for (const [project, earned, given] of [
      [school, 6_180_000, 2_900_000],
      [culvert, 1_050_000, 350_000],
    ] as const) {
      const sum = first<{ earned: number; given: number; balance: number }>(
        'SELECT SUM(earned_cents) AS earned, SUM(advance_cents + paid_cents) AS given, SUM(balance_cents) AS balance FROM v_project_worker_balance WHERE project_id = ?',
        [project],
      );
      expect(sum).toEqual({ earned, given, balance: earned - given });
      expect(first('SELECT labour_cents, labour_paid_cents FROM v_project_cost WHERE project_id = ?', [project])).toEqual({ labour_cents: earned, labour_paid_cents: given });
    }
  });

  it('v_worker_balance adds a worker\'s projects together', () => {
    const expected: Record<string, [number, number, number, number]> = {
      // earned, advance, paid, balance
      Nimal: [1_750_000, 0, 1_400_000, 350_000],
      Sunil: [1_710_000, 0, 1_000_000, 710_000],
      Kamal: [880_000, 500_000, 0, 380_000],
      Ruwan: [1_620_000, 0, 0, 1_620_000],
      Anura: [220_000, 0, 0, 220_000],
      Saman: [1_050_000, 0, 350_000, 700_000],
    };
    for (const [name, [earned, advance, paid, balance]] of Object.entries(expected)) {
      expect({ label: name, ...wb(who[name]) }).toMatchObject({ label: name, earned_cents: earned, advance_cents: advance, paid_cents: paid, balance_cents: balance });
    }
    expect(first('SELECT SUM(balance_cents) AS s FROM v_worker_balance')).toEqual({ s: 3_980_000 });
  });

  it('v_wage_day lines for the school', () => {
    expect(day(school, who.Nimal, d(1))).toMatchObject({ days: 1, work_cents: 350_000, paid_cents: 1_400_000, advance_cents: 0 });
    expect(day(school, who.Sunil, d(2))).toMatchObject({ days: 0.5, work_cents: 190_000, paid_cents: 0 });
    expect(day(school, who.Sunil, d(1))).toMatchObject({ days: 1, work_cents: 380_000, paid_cents: 1_000_000 });
    expect(day(school, who.Kamal, d(2))).toMatchObject({ days: 1, work_cents: 220_000, advance_cents: 500_000 });
    expect(day(school, who.Ruwan, d(0))).toMatchObject({ days: 1.5, work_cents: 540_000 });
    expect(day(school, who.Anura, d(0))).toMatchObject({ days: 1, work_cents: 220_000 });
  });

  it('v_wage_day has no line for a day nobody recorded: Kamal missed d(3), Ruwan started d(2), Anura came on d(0) only', () => {
    expect(day(school, who.Kamal, d(3))).toBeNull();
    expect(day(school, who.Ruwan, d(3))).toBeNull();
    expect(day(school, who.Anura, d(1))).toBeNull();
    expect(day(school, who.Nimal, d(5))).toBeNull();
  });

  it('v_wage_day on the last day: five workers on the school, one on the culvert', () => {
    expect(all('SELECT worker_id FROM v_wage_day WHERE project_id = ? AND day = ?', [school, d(0)])).toHaveLength(5);
    expect(first('SELECT SUM(work_cents) AS s FROM v_wage_day WHERE project_id = ? AND day = ?', [school, d(0)])).toEqual({ s: 350_000 + 380_000 + 220_000 + 540_000 + 220_000 });
    expect(day(culvert, who.Saman, d(0))).toMatchObject({ days: 1, work_cents: 350_000, paid_cents: 350_000 });
  });

  it('v_wage_day adds up to the same totals as the other views', () => {
    for (const [project, work, given] of [
      [school, 6_180_000, 2_900_000],
      [culvert, 1_050_000, 350_000],
    ] as const) {
      expect(first('SELECT SUM(work_cents) AS w, SUM(paid_cents + advance_cents) AS g FROM v_wage_day WHERE project_id = ?', [project])).toEqual({ w: work, g: given });
    }
  });
});

describe('v_project_worker_balance, small scenarios', () => {
  let a: string;
  let b: string;
  let w: string;
  beforeEach(() => {
    a = saveProject({ name: 'A' });
    b = saveProject({ name: 'B' });
    w = saveWorker({ name: 'Worker', daily_rate_cents: 100_000, trade: 'Mason', phone: '0771234567' });
  });

  it('lists a worker only on the projects they are assigned to, with name, trade, phone and rate', () => {
    assignWorker({ project_id: a, worker_id: w, rate_cents: 110_000 });
    expect(pwb(a, w)).toMatchObject({ name: 'Worker', trade: 'Mason', phone: '0771234567', rate_cents: 110_000, active: 1, earned_cents: 0, balance_cents: 0, days_total: 0 });
    expect(pwb(b, w)).toBeNull();
  });

  it('earned, advance and paid are kept apart; balance = earned - advance - paid, and may go negative', () => {
    assignWorker({ project_id: a, worker_id: w, rate_cents: 100_000 });
    recordWorkDay({ project_id: a, worker_id: w, day: '2026-10-20', days: 1 });
    saveWageEntry({ worker_id: w, project_id: a, day: '2026-10-20', kind: 'advance', amount_cents: 30_000 });
    payWages({ project_id: a, worker_id: w, day: '2026-10-21', amount_cents: 90_000 });
    expect(pwb(a, w)).toMatchObject({ earned_cents: 100_000, advance_cents: 30_000, paid_cents: 90_000, balance_cents: -20_000 });
  });

  it('days_total adds fractions of a day exactly', () => {
    assignWorker({ project_id: a, worker_id: w, rate_cents: 100_000 });
    for (const [i, days] of [0.5, 0.25, 1.5, 0.25].entries()) recordWorkDay({ project_id: a, worker_id: w, day: `2026-10-0${i + 1}`, days });
    expect(pwb(a, w)?.days_total).toBe(2.5);
  });

  it('wages of a worker on two projects are separate', () => {
    assignWorker({ project_id: a, worker_id: w, rate_cents: 100_000 });
    assignWorker({ project_id: b, worker_id: w, rate_cents: 200_000 });
    recordWorkDay({ project_id: a, worker_id: w, day: '2026-10-20', days: 1 });
    recordWorkDay({ project_id: b, worker_id: w, day: '2026-10-20', days: 1 });
    payWages({ project_id: b, worker_id: w, day: '2026-10-20', amount_cents: 50_000 });
    expect(pwb(a, w)).toMatchObject({ earned_cents: 100_000, paid_cents: 0, balance_cents: 100_000 });
    expect(pwb(b, w)).toMatchObject({ earned_cents: 200_000, paid_cents: 50_000, balance_cents: 150_000 });
    expect(wb(w)).toMatchObject({ earned_cents: 300_000, paid_cents: 50_000, balance_cents: 250_000 });
  });

  it('a deleted wage entry stops counting; a deleted worker or unassigned worker is not listed', () => {
    assignWorker({ project_id: a, worker_id: w, rate_cents: 100_000 });
    const e = recordWorkDay({ project_id: a, worker_id: w, day: '2026-10-20', days: 1 });
    expect(pwb(a, w)?.earned_cents).toBe(100_000);
    deleteRecord('wage_entries', e);
    expect(pwb(a, w)?.earned_cents).toBe(0);
    unassignWorker(a, w);
    expect(pwb(a, w)).toBeNull();
    assignWorker({ project_id: a, worker_id: w, rate_cents: 100_000 });
    deleteRecord('workers', w);
    expect(pwb(a, w)).toBeNull();
  });

  it('wages of a worker who is not assigned do not appear here (but are in the project cost and the worker total)', () => {
    payWages({ project_id: a, worker_id: w, day: '2026-10-20', amount_cents: 25_000 });
    expect(pwb(a, w)).toBeNull();
    expect(first('SELECT labour_paid_cents FROM v_project_cost WHERE project_id = ?', [a])).toEqual({ labour_paid_cents: 25_000 });
    expect(wb(w)?.paid_cents).toBe(25_000);
  });

  it('a worker assigned twice (two phones assigned the same worker before they met) is still one line, counted once', () => {
    assignWorker({ project_id: a, worker_id: w, rate_cents: 100_000 });
    recordWorkDay({ project_id: a, worker_id: w, day: '2026-10-20', days: 2 });
    payWages({ project_id: a, worker_id: w, day: '2026-10-20', amount_cents: 50_000 });
    const clone = (rate: number, updated: string) =>
      mergeRow('project_workers', {
        id: newId(),
        created_at: updated,
        updated_at: updated,
        deleted_at: null,
        version: 1,
        device_id: 'phone-b',
        project_id: a,
        worker_id: w,
        rate_cents: rate,
        active: 1,
      });
    clone(125_000, '2099-01-01T00:00:00.000Z');
    clone(130_000, '2099-02-01T00:00:00.000Z');
    expect(all('SELECT id FROM project_workers WHERE project_id = ? AND worker_id = ? AND deleted_at IS NULL', [a, w])).toHaveLength(3);

    const lines = all<ProjectWorkerBalance>('SELECT * FROM v_project_worker_balance WHERE project_id = ?', [a]);
    expect(lines).toHaveLength(1);
    // not 3 x 200,000: the worker's two days and Rs 500 paid are counted once
    expect(lines[0]).toMatchObject({ earned_cents: 200_000, paid_cents: 50_000, balance_cents: 150_000, days_total: 2 });
    expect(lines[0].rate_cents).toBe(130_000); // the most recently agreed rate
  });

  it('active is off when the assignment is off, even though the worker is still active', () => {
    assignWorker({ project_id: a, worker_id: w, rate_cents: 1 });
    expect(pwb(a, w)?.active).toBe(1);
    getDb().runSync('UPDATE project_workers SET active = 0 WHERE project_id = ?', [a]);
    expect(first('SELECT active FROM workers WHERE id = ?', [w])).toEqual({ active: 1 });
    expect(pwb(a, w)?.active).toBe(0);
  });
});

describe('v_project_worker_balance: a worker who has left', () => {
  let a: string;
  let b: string;
  let w: string;
  let other: string;

  /** What the worker screen does for "mark as left" / "mark as working". */
  const setWorkerActive = (id: string, active: boolean) => saveWorker({ id, name: 'Nimal', daily_rate_cents: 350_000, active });

  beforeEach(() => {
    a = saveProject({ name: 'A' });
    b = saveProject({ name: 'B' });
    w = saveWorker({ name: 'Nimal', daily_rate_cents: 350_000 });
    other = saveWorker({ name: 'Sunil', daily_rate_cents: 380_000 });
    for (const p of [a, b]) {
      assignWorker({ project_id: p, worker_id: w, rate_cents: 350_000 });
      assignWorker({ project_id: p, worker_id: other, rate_cents: 380_000 });
      recordWorkDay({ project_id: p, worker_id: w, day: '2026-10-20', days: 2 });
      payWages({ project_id: p, worker_id: w, day: '2026-10-21', amount_cents: 100_000 });
      saveWageEntry({ worker_id: w, project_id: p, day: '2026-10-21', kind: 'advance', amount_cents: 50_000 });
    }
  });

  it('is inactive on every project roster, and still listed with the same balances', () => {
    const before = [a, b].map((p) => pwb(p, w));
    expect(before.map((r) => r?.active)).toEqual([1, 1]);

    setWorkerActive(w, false);

    const after = [a, b].map((p) => pwb(p, w));
    expect(after.map((r) => r?.active)).toEqual([0, 0]);
    // listed, not filtered out, and not one cent different
    expect(after).toEqual(before.map((r) => ({ ...r, active: 0 })));
    expect(after[0]).toMatchObject({ earned_cents: 700_000, paid_cents: 100_000, advance_cents: 50_000, balance_cents: 550_000, days_total: 2 });
    // the assignment itself is untouched: only the view answers differently
    expect(all('SELECT active FROM project_workers WHERE worker_id = ?', [w])).toEqual([{ active: 1 }, { active: 1 }]);
    // the others on the roster stay active
    expect(pwb(a, other)?.active).toBe(1);
    expect(all<{ worker_id: string }>('SELECT worker_id FROM v_project_worker_balance WHERE project_id = ? AND active = 1', [a]).map((r) => r.worker_id)).toEqual([other]);
  });

  it('is active again once the worker is marked as working', () => {
    setWorkerActive(w, false);
    expect(pwb(a, w)?.active).toBe(0);
    setWorkerActive(w, true);
    expect([a, b].map((p) => pwb(p, w)?.active)).toEqual([1, 1]);
  });

  it('a worker who is active with an inactive assignment stays inactive; both must be on', () => {
    getDb().runSync('UPDATE project_workers SET active = 0 WHERE project_id = ? AND worker_id = ?', [a, w]);
    expect(pwb(a, w)?.active).toBe(0);
    expect(pwb(b, w)?.active).toBe(1);
    setWorkerActive(w, false);
    expect(pwb(a, w)?.active).toBe(0);
    setWorkerActive(w, true);
    expect(pwb(a, w)?.active).toBe(0); // the project's own flag is still off
    expect(pwb(b, w)?.active).toBe(1);
  });

  it('the left worker still counts in the project cost, the worker total and the day line', () => {
    const cost = first('SELECT labour_cents, labour_paid_cents FROM v_project_cost WHERE project_id = ?', [a]);
    const total = first('SELECT earned_cents, balance_cents FROM v_worker_balance WHERE worker_id = ?', [w]);
    setWorkerActive(w, false);
    expect(first('SELECT labour_cents, labour_paid_cents FROM v_project_cost WHERE project_id = ?', [a])).toEqual(cost);
    expect(first('SELECT earned_cents, balance_cents FROM v_worker_balance WHERE worker_id = ?', [w])).toEqual(total);
    expect(day(a, w, '2026-10-20')).toMatchObject({ days: 2, work_cents: 700_000 });
  });

  it('a worker assigned twice (merged phones) is inactive when the worker has left, with one line only', () => {
    mergeRow('project_workers', {
      id: newId(),
      created_at: '2099-01-01T00:00:00.000Z',
      updated_at: '2099-01-01T00:00:00.000Z',
      deleted_at: null,
      version: 1,
      device_id: 'phone-b',
      project_id: a,
      worker_id: w,
      rate_cents: 360_000,
      active: 1,
    });
    setWorkerActive(w, false);
    const lines = all<ProjectWorkerBalance>('SELECT * FROM v_project_worker_balance WHERE project_id = ? AND worker_id = ?', [a, w]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ active: 0, earned_cents: 700_000, balance_cents: 550_000 });
  });
});

describe('v_wage_day, small scenarios', () => {
  let a: string;
  let b: string;
  let w: string;
  beforeEach(() => {
    a = saveProject({ name: 'A' });
    b = saveProject({ name: 'B' });
    w = saveWorker({ name: 'Worker', daily_rate_cents: 100_000 });
  });

  it('days is NULL (not 0) when a day has only a payment or an advance, so the sheet can tell "not worked" from "worked 0"', () => {
    payWages({ project_id: a, worker_id: w, day: '2026-10-20', amount_cents: 40_000 });
    saveWageEntry({ worker_id: w, project_id: a, day: '2026-10-21', kind: 'advance', amount_cents: 10_000 });
    expect(day(a, w, '2026-10-20')).toEqual({ project_id: a, worker_id: w, day: '2026-10-20', days: null, work_cents: 0, paid_cents: 40_000, advance_cents: 0 });
    expect(day(a, w, '2026-10-21')).toMatchObject({ days: null, work_cents: 0, paid_cents: 0, advance_cents: 10_000 });
  });

  it('a worked day has its days and cents; a payment the same day sits on the same line', () => {
    recordWorkDay({ project_id: a, worker_id: w, day: '2026-10-20', days: 1.5 });
    payWages({ project_id: a, worker_id: w, day: '2026-10-20', amount_cents: 60_000 });
    payWages({ project_id: a, worker_id: w, day: '2026-10-20', amount_cents: 15_000 });
    expect(all('SELECT * FROM v_wage_day')).toEqual([{ project_id: a, worker_id: w, day: '2026-10-20', days: 1.5, work_cents: 150_000, paid_cents: 75_000, advance_cents: 0 }]);
  });

  it('two entries on one day (what merging two phones can leave; saveWageEntry no longer makes them) are added up on one line', () => {
    saveWageEntry({ worker_id: w, project_id: a, day: '2026-10-20', kind: 'work', days: 1, amount_cents: 100_000 });
    mergeRow('wage_entries', {
      id: newId(),
      created_at: '2026-10-22T04:00:00.000Z',
      updated_at: '2026-10-22T04:00:00.000Z',
      deleted_at: null,
      version: 1,
      device_id: 'phone-b',
      worker_id: w,
      project_id: a,
      day: '2026-10-20',
      kind: 'work',
      days: 0.5,
      amount_cents: 50_000,
      note: null,
    });
    expect(day(a, w, '2026-10-20')).toMatchObject({ days: 1.5, work_cents: 150_000 });
  });

  it('the same worker and day on two projects are two lines', () => {
    recordWorkDay({ project_id: a, worker_id: w, day: '2026-10-20', days: 1 });
    recordWorkDay({ project_id: b, worker_id: w, day: '2026-10-20', days: 0.5 });
    expect(all<WageDay>('SELECT * FROM v_wage_day ORDER BY work_cents DESC').map((r) => [r.project_id, r.days])).toEqual([
      [a, 1],
      [b, 0.5],
    ]);
  });

  it('deleted entries drop out; a day with only deleted entries has no line', () => {
    const e = recordWorkDay({ project_id: a, worker_id: w, day: '2026-10-20', days: 1 });
    deleteRecord('wage_entries', e);
    expect(all('SELECT * FROM v_wage_day')).toEqual([]);
  });
});

describe('v_worker_balance, small scenarios', () => {
  it('a worker with no entries is listed with zeros, an inactive one too', () => {
    const idle = saveWorker({ name: 'Idle', daily_rate_cents: 100_000 });
    const gone = saveWorker({ name: 'Left the company', daily_rate_cents: 100_000, active: false });
    expect(wb(idle)).toMatchObject({ earned_cents: 0, advance_cents: 0, paid_cents: 0, balance_cents: 0, active: 1, daily_rate_cents: 100_000 });
    expect(wb(gone)).toMatchObject({ balance_cents: 0, active: 0 });
  });

  it('a deleted worker is not listed; deleted entries do not count', () => {
    const p = saveProject({ name: 'P' });
    const keep = saveWorker({ name: 'Keep', daily_rate_cents: 100_000 });
    const drop = saveWorker({ name: 'Drop', daily_rate_cents: 100_000 });
    const e1 = recordWorkDay({ project_id: p, worker_id: keep, day: '2026-10-20', days: 1 });
    recordWorkDay({ project_id: p, worker_id: keep, day: '2026-10-21', days: 1 });
    recordWorkDay({ project_id: p, worker_id: drop, day: '2026-10-20', days: 1 });
    deleteRecord('wage_entries', e1);
    deleteRecord('workers', drop);
    expect(wb(drop)).toBeNull();
    expect(wb(keep)).toMatchObject({ earned_cents: 100_000, balance_cents: 100_000 });
    expect(all('SELECT worker_id FROM v_worker_balance')).toEqual([{ worker_id: keep }]);
  });

  it('an advance bigger than what was earned is a negative balance (the worker owes the company)', () => {
    const p = saveProject({ name: 'P' });
    const x = saveWorker({ name: 'X', daily_rate_cents: 100_000 });
    recordWorkDay({ project_id: p, worker_id: x, day: '2026-10-20', days: 1 });
    saveWageEntry({ worker_id: x, project_id: p, day: '2026-10-20', kind: 'advance', amount_cents: 150_000 });
    expect(wb(x)).toMatchObject({ earned_cents: 100_000, advance_cents: 150_000, balance_cents: -50_000 });
  });

  it('is not double counted by having several projects or several assignments', () => {
    const p1 = saveProject({ name: 'P1' });
    const p2 = saveProject({ name: 'P2' });
    const x = saveWorker({ name: 'X', daily_rate_cents: 100_000 });
    for (const p of [p1, p2]) {
      assignWorker({ project_id: p, worker_id: x, rate_cents: 100_000 });
      recordWorkDay({ project_id: p, worker_id: x, day: '2026-10-20', days: 1 });
    }
    expect(wb(x)).toMatchObject({ earned_cents: 200_000, balance_cents: 200_000 });
  });
});
