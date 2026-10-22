/**
 * The daily sheet: recordWorkDay / removeWorkDay / payWages, and the wage ledger
 * (saveWageEntry) underneath. One 'work' entry per worker + project + day.
 */
import { all, first, mergeRow, newId } from '@/db';
import {
  assignWorker,
  payWages,
  recordWorkDay,
  removeWorkDay,
  saveProject,
  saveWageEntry,
  saveWorker,
  unassignWorker,
  ValidationError,
} from '@/db/repo';
import type { WageEntry } from '@/db/types';
import { nowIso } from '@/lib/dates';
import { resetDb } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

const D1 = '2026-10-19';
const D2 = '2026-10-20';

let school: string;
let culvert: string;
let nimal: string;
let sunil: string;
let clock: ReturnType<typeof useClock>;

beforeEach(() => {
  resetDb();
  clock = useClock('2026-10-20T04:00:00.000Z');
  school = saveProject({ name: 'Welimada school' });
  culvert = saveProject({ name: 'Badulla culvert' });
  nimal = saveWorker({ name: 'Nimal Perera', daily_rate_cents: 350_000 });
  sunil = saveWorker({ name: 'Sunil Fernando', daily_rate_cents: 0 });
  assignWorker({ project_id: school, worker_id: nimal, rate_cents: 350_000 });
});

afterEach(() => clock.restore());

const entries = (where = '1=1', params: (string | number)[] = []) =>
  all<WageEntry>(`SELECT * FROM wage_entries WHERE ${where} ORDER BY created_at, id`, params);
const work = (project = school, worker = nimal, day?: string) =>
  entries(`kind = 'work' AND project_id = ? AND worker_id = ? ${day ? 'AND day = ?' : ''} AND deleted_at IS NULL`, day ? [project, worker, day] : [project, worker]);

/**
 * A second live 'work' entry for a day, the way merging another phone's data leaves one.
 * saveWageEntry refuses to make it, so it comes in through the merge path.
 */
function mergedWork(day: string, days: number, amount: number, project = school, worker = nimal): string {
  const id = newId();
  const at = nowIso();
  mergeRow('wage_entries', {
    id,
    created_at: at,
    updated_at: at,
    deleted_at: null,
    version: 1,
    device_id: 'phone-b',
    worker_id: worker,
    project_id: project,
    day,
    kind: 'work',
    days,
    amount_cents: amount,
    note: null,
  });
  return id;
}

function refused(fn: () => unknown): { field: string; key: string } {
  try {
    fn();
  } catch (e) {
    if (e instanceof ValidationError) return { field: e.field, key: e.key };
    throw e;
  }
  throw new Error('expected a ValidationError');
}

describe('recordWorkDay: the amount', () => {
  it('defaults to days x the rate agreed for the project', () => {
    const id = recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1 });
    expect(first('SELECT kind, days, amount_cents, project_id, worker_id, day FROM wage_entries WHERE id = ?', [id])).toEqual({
      kind: 'work',
      days: 1,
      amount_cents: 350_000,
      project_id: school,
      worker_id: nimal,
      day: D1,
    });
  });

  it.each([
    [0.5, 350_000, 175_000],
    [1.5, 350_000, 525_000],
    [2, 350_000, 700_000],
    [31, 350_000, 10_850_000],
    [0.5, 333_333, 166_667], // 166,666.5 rounds half up to a whole cent
    [0.25, 100_001, 25_000], // 25,000.25
    [0.1, 350_000, 35_000], // floating point gives 35000.00000000001
    [0.3, 350_000, 105_000], // floating point gives 104999.99999999999
    [1 / 3, 300_000, 100_000],
  ])('%p days at %p cents is %p cents, a whole number', (days, rate, want) => {
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: rate });
    const id = recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days });
    const row = first<{ amount_cents: number; t: string }>('SELECT amount_cents, typeof(amount_cents) AS t FROM wage_entries WHERE id = ?', [id]);
    expect(row).toEqual({ amount_cents: want, t: 'integer' });
    expect(Number.isInteger(row?.amount_cents)).toBe(true);
  });

  it('a custom amount (e.g. a negotiated lump sum) wins over days x rate', () => {
    const id = recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1, amount_cents: 420_050 });
    expect(first('SELECT days, amount_cents FROM wage_entries WHERE id = ?', [id])).toEqual({ days: 1, amount_cents: 420_050 });
  });

  it.each([0, -100, 12.5, Number.NaN])('refuses the custom amount %p', (amount) => {
    expect(refused(() => recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1, amount_cents: amount }))).toEqual({ field: 'amount', key: 'errAmount' });
    expect(entries()).toEqual([]);
  });

  it("falls back to the worker's own daily rate when they are not assigned to the project", () => {
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 350_000 });
    const id = recordWorkDay({ project_id: culvert, worker_id: nimal, day: D1, days: 2 }); // not assigned on the culvert
    expect(first('SELECT amount_cents FROM wage_entries WHERE id = ?', [id])).toEqual({ amount_cents: 700_000 });
  });

  it('the project rate beats the default rate', () => {
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 400_000 });
    const id = recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1 });
    expect(first('SELECT amount_cents FROM wage_entries WHERE id = ?', [id])).toEqual({ amount_cents: 400_000 });
  });

  it('needs a rate: refused when neither the project nor the worker has one (unless an amount is given)', () => {
    expect(refused(() => recordWorkDay({ project_id: school, worker_id: sunil, day: D1, days: 1 }))).toEqual({ field: 'rate', key: 'rateRequired' });
    assignWorker({ project_id: school, worker_id: sunil, rate_cents: 0 });
    expect(refused(() => recordWorkDay({ project_id: school, worker_id: sunil, day: D1, days: 1 }))).toEqual({ field: 'rate', key: 'rateRequired' });
    expect(entries()).toEqual([]);
    expect(() => recordWorkDay({ project_id: school, worker_id: sunil, day: D1, days: 1, amount_cents: 300_000 })).not.toThrow();
  });

  it('an assignment at rate 0 means "no rate yet", even if the worker has a default rate', () => {
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 0 });
    expect(refused(() => recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1 })).key).toBe('rateRequired');
    unassignWorker(school, nimal);
    expect(() => recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1 })).not.toThrow();
  });
});

describe('recordWorkDay: the days', () => {
  it.each([0.25, 0.5, 1, 1.5, 2, 30.5, 31])('accepts %p', (days) => {
    const id = recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days });
    expect(first('SELECT days FROM wage_entries WHERE id = ?', [id])).toEqual({ days });
  });

  it.each([0, -1, -0.5, 31.01, 32, 365, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('refuses %p', (days) => {
    expect(refused(() => recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days }))).toEqual({ field: 'days', key: 'errDays' });
    expect(entries()).toEqual([]);
  });

  it('refuses a missing number of days', () => {
    expect(refused(() => recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: undefined as unknown as number })).field).toBe('days');
    expect(refused(() => recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: null as unknown as number })).field).toBe('days');
  });

  it('refuses a bad date, an unknown project and an unknown worker', () => {
    expect(refused(() => recordWorkDay({ project_id: school, worker_id: nimal, day: '2026-10-32', days: 1 }))).toEqual({ field: 'day', key: 'errDate' });
    expect(refused(() => recordWorkDay({ project_id: 'x', worker_id: nimal, day: D1, days: 1 }))).toEqual({ field: 'project_id', key: 'errProject' });
    expect(refused(() => recordWorkDay({ project_id: school, worker_id: 'x', day: D1, days: 1 }))).toEqual({ field: 'worker_id', key: 'errWorker' });
  });
});

describe('recordWorkDay: one entry per worker + project + day', () => {
  it('recording the same day again updates that entry (same id), it does not add one', () => {
    const a = recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1 });
    clock.tick(1_000);
    const b = recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1 });
    expect(b).toBe(a);
    expect(work()).toHaveLength(1);
    expect(first('SELECT COUNT(*) AS n FROM wage_entries')).toEqual({ n: 1 });
  });

  it('changing the days recalculates the amount; a note can be added and changed', () => {
    const id = recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1, note: ' first ' });
    expect(first('SELECT note FROM wage_entries WHERE id = ?', [id])).toEqual({ note: 'first' });
    recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 0.5, note: 'half day, rain' });
    expect(first('SELECT days, amount_cents, note, version FROM wage_entries WHERE id = ?', [id])).toEqual({
      days: 0.5,
      amount_cents: 175_000,
      note: 'half day, rain',
      version: 2,
    });
    expect(work()).toHaveLength(1);
  });

  it('a different day, project or worker is a different entry', () => {
    assignWorker({ project_id: culvert, worker_id: nimal, rate_cents: 360_000 });
    assignWorker({ project_id: school, worker_id: sunil, rate_cents: 380_000 });
    const ids = new Set([
      recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1 }),
      recordWorkDay({ project_id: school, worker_id: nimal, day: D2, days: 1 }),
      recordWorkDay({ project_id: culvert, worker_id: nimal, day: D1, days: 1 }),
      recordWorkDay({ project_id: school, worker_id: sunil, day: D1, days: 1 }),
    ]);
    expect(ids.size).toBe(4);
    expect(entries()).toHaveLength(4);
    // the same worker on the same day on two projects is paid by each project separately
    expect(first('SELECT labour_cents FROM v_project_cost WHERE project_id = ?', [culvert])).toEqual({ labour_cents: 360_000 });
    expect(first('SELECT labour_cents FROM v_project_cost WHERE project_id = ?', [school])).toEqual({ labour_cents: 350_000 + 350_000 + 380_000 });
  });

  it('payments and advances on the same day are not mistaken for the work entry', () => {
    payWages({ project_id: school, worker_id: nimal, day: D1, amount_cents: 100_000 });
    saveWageEntry({ worker_id: nimal, project_id: school, day: D1, kind: 'advance', amount_cents: 50_000 });
    const id = recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1 });
    expect(entries('day = ?', [D1])).toHaveLength(3);
    expect(entries("kind != 'work'").map((e) => e.amount_cents).sort((a, b) => a - b)).toEqual([50_000, 100_000]);
    expect(work()[0].id).toBe(id);
  });

  it('the day appears in the daily view with its days and cents', () => {
    recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1.5 });
    expect(first('SELECT days, work_cents FROM v_wage_day WHERE project_id = ? AND worker_id = ? AND day = ?', [school, nimal, D1])).toEqual({ days: 1.5, work_cents: 525_000 });
  });

  it('two entries for one day (two phones merged) are brought back to one by recording the day again', () => {
    saveWageEntry({ worker_id: nimal, project_id: school, day: D1, kind: 'work', days: 1, amount_cents: 350_000 });
    clock.tick(1_000);
    mergedWork(D1, 0.5, 175_000);
    expect(first('SELECT days, work_cents FROM v_wage_day WHERE project_id = ? AND worker_id = ? AND day = ?', [school, nimal, D1])).toEqual({ days: 1.5, work_cents: 525_000 });

    clock.tick(1_000);
    recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1.5 }); // what the sheet shows, saved as it shows

    expect(first('SELECT days, work_cents FROM v_wage_day WHERE project_id = ? AND worker_id = ? AND day = ?', [school, nimal, D1])).toEqual({ days: 1.5, work_cents: 525_000 });
    expect(work(school, nimal, D1)).toHaveLength(1);
    // the extra entry is soft-deleted, never removed
    expect(entries('day = ?', [D1])).toHaveLength(2);
  });
});

describe('removeWorkDay', () => {
  it('soft-deletes that day only; the payment made the same day stays', () => {
    recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1 });
    recordWorkDay({ project_id: school, worker_id: nimal, day: D2, days: 1 });
    payWages({ project_id: school, worker_id: nimal, day: D1, amount_cents: 200_000 });

    clock.tick(1_000);
    removeWorkDay(school, nimal, D1);

    expect(work(school, nimal, D1)).toEqual([]);
    expect(work(school, nimal, D2)).toHaveLength(1);
    expect(entries("kind = 'payment' AND deleted_at IS NULL")).toHaveLength(1);
    expect(entries()).toHaveLength(3); // nothing removed
    expect(first('SELECT days, work_cents, paid_cents FROM v_wage_day WHERE project_id = ? AND worker_id = ? AND day = ?', [school, nimal, D1])).toEqual({
      days: null,
      work_cents: 0,
      paid_cents: 200_000,
    });
    expect(first('SELECT earned_cents, paid_cents, balance_cents FROM v_project_worker_balance WHERE project_id = ? AND worker_id = ?', [school, nimal])).toEqual({
      earned_cents: 350_000,
      paid_cents: 200_000,
      balance_cents: 150_000,
    });
  });

  it('removing a day that was never recorded (or twice) does nothing and writes nothing', () => {
    const audit = () => first<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n;
    const n = audit();
    removeWorkDay(school, nimal, D1);
    expect(audit()).toBe(n);
    recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1 });
    removeWorkDay(school, nimal, D1);
    const m = audit();
    removeWorkDay(school, nimal, D1);
    expect(audit()).toBe(m);
  });

  it('recording the day again after removing it adds a fresh live entry; the removed one stays as history', () => {
    const first1 = recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1 });
    removeWorkDay(school, nimal, D1);
    const second = recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 2 });
    expect(second).not.toBe(first1);
    expect(work(school, nimal, D1).map((e) => e.id)).toEqual([second]);
    expect(first('SELECT deleted_at FROM wage_entries WHERE id = ?', [first1])).not.toEqual({ deleted_at: null });
    expect(first('SELECT earned_cents FROM v_project_worker_balance WHERE project_id = ? AND worker_id = ?', [school, nimal])).toEqual({ earned_cents: 700_000 });
  });

  it('refuses a bad date', () => {
    expect(refused(() => removeWorkDay(school, nimal, 'nope'))).toEqual({ field: 'day', key: 'errDate' });
  });

  it('removes every live entry of that day when there are several, so the day is really un-marked', () => {
    saveWageEntry({ worker_id: nimal, project_id: school, day: D1, kind: 'work', days: 1, amount_cents: 350_000 });
    clock.tick(1_000);
    mergedWork(D1, 1, 350_000);
    removeWorkDay(school, nimal, D1);
    expect(work(school, nimal, D1)).toEqual([]);
    expect(first('SELECT labour_cents FROM v_project_cost WHERE project_id = ?', [school])).toEqual({ labour_cents: 0 });
  });
});

describe('payWages', () => {
  beforeEach(() => {
    recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 2 }); // earns 700,000
  });

  it('stores a payment (no days) against the project and worker', () => {
    const id = payWages({ project_id: school, worker_id: nimal, day: D2, amount_cents: 300_000, note: '  weekly ' });
    expect(first('SELECT kind, days, amount_cents, project_id, worker_id, day, note FROM wage_entries WHERE id = ?', [id])).toEqual({
      kind: 'payment',
      days: null,
      amount_cents: 300_000,
      project_id: school,
      worker_id: nimal,
      day: D2,
      note: 'weekly',
    });
  });

  it.each([0, -1, 100.5, Number.NaN])('refuses %p', (amount) => {
    expect(refused(() => payWages({ project_id: school, worker_id: nimal, day: D2, amount_cents: amount }))).toEqual({ field: 'amount', key: 'errAmount' });
    expect(entries("kind = 'payment'")).toEqual([]);
  });

  it('partial payments add up and the balance falls by exactly what was paid', () => {
    const balance = () => first<{ balance_cents: number; paid_cents: number }>('SELECT balance_cents, paid_cents FROM v_project_worker_balance WHERE project_id = ? AND worker_id = ?', [school, nimal]);
    expect(balance()).toEqual({ balance_cents: 700_000, paid_cents: 0 });
    payWages({ project_id: school, worker_id: nimal, day: D1, amount_cents: 100_000 });
    expect(balance()).toEqual({ balance_cents: 600_000, paid_cents: 100_000 });
    payWages({ project_id: school, worker_id: nimal, day: D1, amount_cents: 250_050 });
    expect(balance()).toEqual({ balance_cents: 349_950, paid_cents: 350_050 });
    payWages({ project_id: school, worker_id: nimal, day: D2, amount_cents: 349_950 });
    expect(balance()).toEqual({ balance_cents: 0, paid_cents: 700_000 });
    expect(entries("kind = 'payment' AND deleted_at IS NULL")).toHaveLength(3); // each payment is its own entry
    // two payments on the same day show as one paid figure in the daily view
    expect(first('SELECT paid_cents FROM v_wage_day WHERE project_id = ? AND worker_id = ? AND day = ?', [school, nimal, D1])).toEqual({ paid_cents: 350_050 });
  });

  it('paying more than was earned shows as a negative balance (an advance), never as lost money', () => {
    payWages({ project_id: school, worker_id: nimal, day: D1, amount_cents: 900_000 });
    expect(first('SELECT balance_cents FROM v_worker_balance WHERE worker_id = ?', [nimal])).toEqual({ balance_cents: -200_000 });
    expect(first('SELECT MIN(amount_cents) AS m FROM wage_entries')).toEqual({ m: 700_000 }); // stored amounts stay positive
  });

  it('a worker not assigned to the project can still be paid (the money was given)', () => {
    expect(() => payWages({ project_id: school, worker_id: sunil, day: D1, amount_cents: 10_000 })).not.toThrow();
  });

  it('refuses an unknown worker or project, and a bad day', () => {
    expect(refused(() => payWages({ project_id: school, worker_id: 'x', day: D1, amount_cents: 1 })).field).toBe('worker_id');
    expect(refused(() => payWages({ project_id: 'x', worker_id: nimal, day: D1, amount_cents: 1 })).field).toBe('project_id');
    expect(refused(() => payWages({ project_id: school, worker_id: nimal, day: '2026-02-30', amount_cents: 1 })).field).toBe('day');
  });
});

describe('saveWageEntry edits', () => {
  it('editing an entry keeps its id and bumps the version; the totals follow', () => {
    const id = saveWageEntry({ worker_id: nimal, project_id: school, day: D1, kind: 'payment', amount_cents: 100_000 });
    clock.tick(1_000);
    expect(saveWageEntry({ id, worker_id: nimal, project_id: school, day: D1, kind: 'payment', amount_cents: 120_000, note: 'corrected' })).toBe(id);
    expect(entries()).toHaveLength(1);
    expect(first('SELECT amount_cents, version, note FROM wage_entries WHERE id = ?', [id])).toEqual({ amount_cents: 120_000, version: 2, note: 'corrected' });
    expect(first('SELECT paid_cents FROM v_worker_balance WHERE worker_id = ?', [nimal])).toEqual({ paid_cents: 120_000 });
  });

  it('an advance is money given: it lowers the balance like a payment but is listed separately', () => {
    recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1 });
    saveWageEntry({ worker_id: nimal, project_id: school, day: D1, kind: 'advance', amount_cents: 100_000 });
    expect(first('SELECT earned_cents, advance_cents, paid_cents, balance_cents FROM v_project_worker_balance WHERE project_id = ? AND worker_id = ?', [school, nimal])).toEqual({
      earned_cents: 350_000,
      advance_cents: 100_000,
      paid_cents: 0,
      balance_cents: 250_000,
    });
    expect(first('SELECT labour_cents, labour_paid_cents FROM v_project_cost WHERE project_id = ?', [school])).toEqual({ labour_cents: 350_000, labour_paid_cents: 100_000 });
  });
});

describe('saveWageEntry: one work entry per worker + project + day', () => {
  const work1 = (over: Partial<Parameters<typeof saveWageEntry>[0]> = {}) =>
    saveWageEntry({ worker_id: nimal, project_id: school, day: D1, kind: 'work', days: 1, amount_cents: 350_000, ...over });
  const auditCount = () => first<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n;

  it('refuses a second work entry for the same day and says so on the day field', () => {
    const id = work1();
    clock.tick(1_000);
    const audit = auditCount();
    expect(refused(() => work1({ days: 0.5, amount_cents: 175_000 }))).toEqual({ field: 'day', key: 'errWorkDayExists' });
    expect(work(school, nimal, D1).map((e) => e.id)).toEqual([id]);
    expect(first('SELECT days, amount_cents, version FROM wage_entries WHERE id = ?', [id])).toEqual({ days: 1, amount_cents: 350_000, version: 1 });
    expect(auditCount()).toBe(audit); // nothing written, not even a failed attempt
    expect(first('SELECT labour_cents FROM v_project_cost WHERE project_id = ?', [school])).toEqual({ labour_cents: 350_000 });
  });

  it('refuses it when the form brings a fresh id of its own (a new entry has no row yet)', () => {
    work1();
    expect(refused(() => work1({ id: newId() })).key).toBe('errWorkDayExists');
  });

  it('refuses a work entry for a day the sheet has already marked', () => {
    recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 1 });
    expect(refused(() => work1()).key).toBe('errWorkDayExists');
    expect(work(school, nimal, D1)).toHaveLength(1);
  });

  it('editing the entry itself is fine (its own id is not "another" entry)', () => {
    const id = work1();
    clock.tick(1_000);
    expect(work1({ id, days: 1.5, amount_cents: 525_000, note: 'overtime' })).toBe(id);
    expect(first('SELECT days, amount_cents, note, version FROM wage_entries WHERE id = ?', [id])).toEqual({ days: 1.5, amount_cents: 525_000, note: 'overtime', version: 2 });
    expect(work(school, nimal, D1)).toHaveLength(1);
  });

  it('moving an entry onto a day that already has one is refused and leaves it where it was', () => {
    work1();
    const later = work1({ day: D2 });
    expect(refused(() => work1({ id: later, day: D1 })).key).toBe('errWorkDayExists');
    expect(first('SELECT day, version FROM wage_entries WHERE id = ?', [later])).toEqual({ day: D2, version: 1 });
  });

  it('another day, another worker and another project are all separate days', () => {
    assignWorker({ project_id: culvert, worker_id: nimal, rate_cents: 360_000 });
    work1();
    expect(() => work1({ day: D2 })).not.toThrow();
    expect(() => work1({ worker_id: sunil })).not.toThrow();
    expect(() => work1({ project_id: culvert })).not.toThrow();
    expect(entries("kind = 'work'")).toHaveLength(4);
  });

  it('payments and advances on that day are not work entries and never collide with it', () => {
    work1();
    expect(() => saveWageEntry({ worker_id: nimal, project_id: school, day: D1, kind: 'advance', amount_cents: 10_000 })).not.toThrow();
    expect(() => saveWageEntry({ worker_id: nimal, project_id: school, day: D1, kind: 'payment', amount_cents: 20_000 })).not.toThrow();
    expect(() => saveWageEntry({ worker_id: nimal, project_id: school, day: D1, kind: 'payment', amount_cents: 20_000 })).not.toThrow();
  });

  it('a deleted work entry no longer blocks the day', () => {
    work1();
    removeWorkDay(school, nimal, D1);
    expect(() => work1({ days: 2, amount_cents: 700_000 })).not.toThrow();
    expect(work(school, nimal, D1)).toHaveLength(1);
  });

  it('with two entries already there (merged phones) the wage form cannot edit either; the sheet repairs the day', () => {
    const a = work1();
    clock.tick(1_000);
    const b = mergedWork(D1, 0.5, 175_000);
    expect(refused(() => work1({ id: a, days: 2, amount_cents: 700_000 })).key).toBe('errWorkDayExists');
    expect(refused(() => work1({ id: b, days: 2, amount_cents: 700_000 })).key).toBe('errWorkDayExists');

    clock.tick(1_000);
    expect(recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 2 })).toBe(a);
    expect(work(school, nimal, D1).map((e) => [e.id, e.days])).toEqual([[a, 2]]);
  });

  it('recordWorkDay keeps working on a day the wage form created (it updates that entry)', () => {
    const id = work1();
    clock.tick(1_000);
    expect(recordWorkDay({ project_id: school, worker_id: nimal, day: D1, days: 0.5 })).toBe(id);
    expect(first('SELECT days, amount_cents FROM wage_entries WHERE id = ?', [id])).toEqual({ days: 0.5, amount_cents: 175_000 });
  });

  it('keeps refusing on every attempt and never leaves a row behind', () => {
    work1();
    for (let i = 0; i < 3; i++) expect(refused(() => work1()).key).toBe('errWorkDayExists');
    expect(entries()).toHaveLength(1);
  });
});
