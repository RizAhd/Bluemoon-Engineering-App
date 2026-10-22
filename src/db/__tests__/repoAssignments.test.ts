/**
 * Putting workers on projects: assignWorker (upsert + revive), unassignWorker (history stays),
 * setProjectWorkerRate. One logical assignment per (project, worker).
 */
import { all, deviceId, first, mergeRow, newId } from '@/db';
import {
  assignWorker,
  payWages,
  recordWorkDay,
  saveProject,
  saveWorker,
  setProjectWorkerRate,
  unassignWorker,
  ValidationError,
} from '@/db/repo';
import type { ProjectWorker } from '@/db/types';
import { resetDb } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

let school: string;
let culvert: string;
let nimal: string;
let clock: ReturnType<typeof useClock>;

beforeEach(() => {
  resetDb();
  clock = useClock('2026-10-20T04:00:00.000Z');
  school = saveProject({ name: 'Welimada school' });
  culvert = saveProject({ name: 'Badulla culvert' });
  nimal = saveWorker({ name: 'Nimal Perera', daily_rate_cents: 350_000 });
});

afterEach(() => {
  clock.restore();
});

const rows = (project: string, worker: string) =>
  all<ProjectWorker>('SELECT * FROM project_workers WHERE project_id = ? AND worker_id = ? ORDER BY created_at, id', [project, worker]);
const live = (project: string, worker: string) => rows(project, worker).filter((r) => !r.deleted_at);

function refused(fn: () => unknown): { field: string; key: string } {
  try {
    fn();
  } catch (e) {
    if (e instanceof ValidationError) return { field: e.field, key: e.key };
    throw e;
  }
  throw new Error('expected a ValidationError');
}

describe('assignWorker', () => {
  it('creates one active row with the agreed rate', () => {
    const id = assignWorker({ project_id: school, worker_id: nimal, rate_cents: 360_000 });
    expect(rows(school, nimal)).toEqual([
      expect.objectContaining({ id, project_id: school, worker_id: nimal, rate_cents: 360_000, active: 1, deleted_at: null, version: 1, device_id: deviceId() }),
    ]);
  });

  it('a rate of 0 is allowed (agreed later, or paid by a fixed amount)', () => {
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 0 });
    expect(live(school, nimal)[0].rate_cents).toBe(0);
  });

  it.each([-1, -350_000, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses the rate %p', (rate) => {
    expect(refused(() => assignWorker({ project_id: school, worker_id: nimal, rate_cents: rate }))).toEqual({ field: 'rate', key: 'errAmount' });
    expect(rows(school, nimal)).toEqual([]);
  });

  it('refuses a project or worker that does not exist or was deleted', () => {
    expect(refused(() => assignWorker({ project_id: newId(), worker_id: nimal, rate_cents: 1 })).field).toBe('project_id');
    expect(refused(() => assignWorker({ project_id: school, worker_id: newId(), rate_cents: 1 })).field).toBe('worker_id');
    expect(refused(() => assignWorker({ project_id: '', worker_id: nimal, rate_cents: 1 })).field).toBe('project_id');
    expect(all('SELECT id FROM project_workers')).toEqual([]);
  });

  it('assigning again updates the same row (new rate, version + 1) and never adds a second one', () => {
    const first1 = assignWorker({ project_id: school, worker_id: nimal, rate_cents: 350_000 });
    clock.tick(5_000);
    const second = assignWorker({ project_id: school, worker_id: nimal, rate_cents: 400_000 });
    expect(second).toBe(first1);
    const r = rows(school, nimal);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ rate_cents: 400_000, version: 2, active: 1, deleted_at: null });
    expect(r[0].updated_at > r[0].created_at).toBe(true);
    expect(all('SELECT action FROM audit_log WHERE row_id = ? ORDER BY seq', [first1])).toEqual([{ action: 'insert' }, { action: 'update' }]);
  });

  it('bringing back a removed worker revives the old row (same id) with the new rate, as version 3', () => {
    const id = assignWorker({ project_id: school, worker_id: nimal, rate_cents: 350_000 });
    clock.tick(1_000);
    unassignWorker(school, nimal);
    expect(first('SELECT deleted_at FROM project_workers WHERE id = ?', [id])).not.toEqual({ deleted_at: null });
    clock.tick(1_000);

    expect(assignWorker({ project_id: school, worker_id: nimal, rate_cents: 375_000 })).toBe(id);
    const r = rows(school, nimal);
    expect(r).toHaveLength(1); // still one row for the pair, ever
    expect(r[0]).toMatchObject({ id, deleted_at: null, rate_cents: 375_000, version: 3, active: 1 });
    expect(first('SELECT rate_cents FROM v_project_worker_balance WHERE project_id = ? AND worker_id = ?', [school, nimal])).toEqual({ rate_cents: 375_000 });
    expect(all('SELECT action FROM audit_log WHERE row_id = ? ORDER BY seq', [id])).toEqual([{ action: 'insert' }, { action: 'delete' }, { action: 'update' }]);
  });

  it('the same worker on two projects has two independent assignments', () => {
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 350_000 });
    assignWorker({ project_id: culvert, worker_id: nimal, rate_cents: 400_000 });
    setProjectWorkerRate(school, nimal, 360_000);
    expect(live(school, nimal)[0].rate_cents).toBe(360_000);
    expect(live(culvert, nimal)[0].rate_cents).toBe(400_000);
    unassignWorker(culvert, nimal);
    expect(live(school, nimal)).toHaveLength(1);
    expect(live(culvert, nimal)).toHaveLength(0);
  });

  it("does not change the worker's own default daily rate", () => {
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 999_000 });
    expect(first('SELECT daily_rate_cents, version FROM workers WHERE id = ?', [nimal])).toEqual({ daily_rate_cents: 350_000, version: 1 });
  });
});

describe('unassignWorker', () => {
  function workedAndPaid() {
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 350_000 });
    recordWorkDay({ project_id: school, worker_id: nimal, day: '2026-10-19', days: 1 });
    recordWorkDay({ project_id: school, worker_id: nimal, day: '2026-10-20', days: 2 });
    payWages({ project_id: school, worker_id: nimal, day: '2026-10-20', amount_cents: 500_000 });
  }

  it('takes the worker off the project but keeps every wage entry and every total', () => {
    workedAndPaid();
    const before = {
      entries: all('SELECT * FROM wage_entries ORDER BY id'),
      worker: first('SELECT earned_cents, paid_cents, balance_cents FROM v_worker_balance WHERE worker_id = ?', [nimal]),
      cost: first('SELECT labour_cents, labour_paid_cents FROM v_project_cost WHERE project_id = ?', [school]),
    };
    expect(before.worker).toEqual({ earned_cents: 1_050_000, paid_cents: 500_000, balance_cents: 550_000 });

    clock.tick(1_000);
    unassignWorker(school, nimal);

    expect(all('SELECT * FROM v_project_worker_balance WHERE project_id = ?', [school])).toEqual([]); // no longer listed
    expect(all('SELECT * FROM wage_entries ORDER BY id')).toEqual(before.entries); // history is byte-for-byte the same
    expect(first('SELECT earned_cents, paid_cents, balance_cents FROM v_worker_balance WHERE worker_id = ?', [nimal])).toEqual(before.worker);
    expect(first('SELECT labour_cents, labour_paid_cents FROM v_project_cost WHERE project_id = ?', [school])).toEqual(before.cost);
    // the assignment row itself is soft-deleted, not removed
    expect(rows(school, nimal)).toEqual([expect.objectContaining({ version: 2, deleted_at: expect.any(String) })]);
  });

  it('assigning the worker back shows the old history again, unchanged', () => {
    workedAndPaid();
    unassignWorker(school, nimal);
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 350_000 });
    expect(first('SELECT earned_cents, paid_cents, balance_cents, days_total FROM v_project_worker_balance WHERE project_id = ? AND worker_id = ?', [school, nimal])).toEqual({
      earned_cents: 1_050_000,
      paid_cents: 500_000,
      balance_cents: 550_000,
      days_total: 3,
    });
  });

  it('does nothing (no write, no audit entry) for a worker who is not on the project, and when repeated', () => {
    const audit = () => first<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n;
    const n = audit();
    unassignWorker(school, nimal);
    expect(audit()).toBe(n);

    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 1 });
    unassignWorker(school, nimal);
    const afterFirst = rows(school, nimal)[0];
    const m = audit();
    unassignWorker(school, nimal);
    expect(audit()).toBe(m);
    expect(rows(school, nimal)[0]).toEqual(afterFirst); // version and deleted_at not touched again
  });

  it('only removes the assignment on that project', () => {
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 1 });
    assignWorker({ project_id: culvert, worker_id: nimal, rate_cents: 1 });
    unassignWorker(school, nimal);
    expect(live(culvert, nimal)).toHaveLength(1);
    expect(all('SELECT project_id FROM v_project_worker_balance')).toEqual([{ project_id: culvert }]);
  });

  it('after removal the worker is paid at their own default rate again', () => {
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 500_000 });
    unassignWorker(school, nimal);
    const id = recordWorkDay({ project_id: school, worker_id: nimal, day: '2026-10-20', days: 1 });
    expect(first('SELECT amount_cents FROM wage_entries WHERE id = ?', [id])).toEqual({ amount_cents: 350_000 });
  });

  it('removes every live row of the pair, so two assignments merged from two phones cannot keep the worker on the project', () => {
    const a = assignWorker({ project_id: school, worker_id: nimal, rate_cents: 350_000 });
    // the other phone assigned the same worker to the same project on its own: a different row id arrives with the merge
    const b = newId();
    expect(
      mergeRow('project_workers', {
        id: b,
        created_at: '2026-10-20T05:00:00.000Z',
        updated_at: '2026-10-20T05:00:00.000Z',
        deleted_at: null,
        version: 1,
        device_id: 'other-phone',
        project_id: school,
        worker_id: nimal,
        rate_cents: 380_000,
        active: 1,
      }),
    ).toBe('inserted');
    expect(live(school, nimal)).toHaveLength(2);

    unassignWorker(school, nimal);

    expect(live(school, nimal)).toEqual([]);
    expect(all('SELECT * FROM v_project_worker_balance WHERE project_id = ?', [school])).toEqual([]);
    expect(rows(school, nimal).map((r) => r.id).sort()).toEqual([a, b].sort()); // both kept as history
  });
});

describe('setProjectWorkerRate', () => {
  it('changes the rate from now on; earlier work keeps the amount it was recorded at', () => {
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 350_000 });
    const monday = recordWorkDay({ project_id: school, worker_id: nimal, day: '2026-10-19', days: 1 });
    clock.tick(1_000);

    setProjectWorkerRate(school, nimal, 400_000);

    expect(live(school, nimal)[0]).toMatchObject({ rate_cents: 400_000, version: 2 });
    const tuesday = recordWorkDay({ project_id: school, worker_id: nimal, day: '2026-10-20', days: 1 });
    expect(first('SELECT amount_cents FROM wage_entries WHERE id = ?', [monday])).toEqual({ amount_cents: 350_000 });
    expect(first('SELECT amount_cents FROM wage_entries WHERE id = ?', [tuesday])).toEqual({ amount_cents: 400_000 });
  });

  it('only changes the rate on that project', () => {
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 350_000 });
    assignWorker({ project_id: culvert, worker_id: nimal, rate_cents: 350_000 });
    setProjectWorkerRate(school, nimal, 1);
    expect(live(culvert, nimal)[0]).toMatchObject({ rate_cents: 350_000, version: 1 });
  });

  it('a rate of 0 is allowed', () => {
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 350_000 });
    setProjectWorkerRate(school, nimal, 0);
    expect(live(school, nimal)[0].rate_cents).toBe(0);
  });

  it.each([-1, 0.5, Number.NaN])('refuses the rate %p and keeps the old one', (rate) => {
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 350_000 });
    expect(refused(() => setProjectWorkerRate(school, nimal, rate))).toEqual({ field: 'rate', key: 'errAmount' });
    expect(live(school, nimal)[0]).toMatchObject({ rate_cents: 350_000, version: 1 });
  });

  it('refuses a worker who is not on the project, or was removed from it', () => {
    expect(refused(() => setProjectWorkerRate(school, nimal, 1))).toEqual({ field: 'worker_id', key: 'errWorker' });
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 350_000 });
    unassignWorker(school, nimal);
    expect(refused(() => setProjectWorkerRate(school, nimal, 1)).field).toBe('worker_id');
    expect(rows(school, nimal)[0].rate_cents).toBe(350_000);
  });
});
