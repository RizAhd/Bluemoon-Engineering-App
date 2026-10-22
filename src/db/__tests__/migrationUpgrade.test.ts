/**
 * Upgrading a phone that already holds the owner's data.
 *
 * The database is built exactly as the PREVIOUS app version left it (only migration 1 applied,
 * user_version = 1, realistic rows), then the app's own migration path (getDb) runs.
 * Nothing the owner entered may be lost, changed or re-attributed.
 */
import * as SQLite from 'expo-sqlite';

import { all, closeDb, DB_NAME, first, getDb } from '@/db';
import { assignWorker, payWages, recordWorkDay, saveExpense } from '@/db/repo';
import { DATA_TABLES, migrations } from '@/db/schema';
import { Directory, File, mainPhone, openSecondPhone, Paths, resetDb, silenceConsoleError, transfer } from '@/test-utils';
import { openLegacyDb, V1_TABLES } from '@/test-utils/dataKit';
import { EXPECTED, fillVersion1, insertRow, L, V1_DATA_TABLES } from '@/test-utils/legacyData';

jest.setTimeout(60_000);

const LATEST = () => migrations.length;

type Rows = Record<string, unknown>[];

const ORDER: Record<string, string> = { audit_log: 'seq', settings: 'key' };

/** Every row of every version-1 table, in a stable order. */
function dumpV1(db: { getAllSync: <T>(sql: string) => T[] }): Record<string, Rows> {
  const out: Record<string, Rows> = {};
  for (const t of V1_DATA_TABLES) out[t] = db.getAllSync<Record<string, unknown>>(`SELECT * FROM ${t} ORDER BY ${ORDER[t] ?? 'id'}`);
  return out;
}

const VIEWS_V1 = {
  v_worker_balance: 'SELECT * FROM v_worker_balance ORDER BY worker_id',
  v_project_cost: 'SELECT * FROM v_project_cost ORDER BY project_id',
  v_tool_status: 'SELECT * FROM v_tool_status ORDER BY tool_id',
} as const;

function dumpViews(db: { getAllSync: <T>(sql: string) => T[] }): Record<string, Rows> {
  const out: Record<string, Rows> = {};
  for (const [name, sql] of Object.entries(VIEWS_V1)) out[name] = db.getAllSync<Record<string, unknown>>(sql);
  return out;
}

function schemaObjects() {
  return all<{ type: string; name: string; tbl_name: string }>(
    "SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
  );
}

function userVersion(): number {
  return first<{ user_version: number }>('PRAGMA user_version')?.user_version ?? -1;
}

/** Leaves a version-1 database holding the owner's data. Returns what was in it. */
function installVersion1() {
  resetDb();
  const old = openLegacyDb(1);
  fillVersion1(old);
  const rows = dumpV1(old);
  const views = dumpViews(old);
  expect(old.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(1);
  old.closeSync();
  return { rows, views };
}

describe('upgrading a version-1 database', () => {
  it('has a newer schema than the data it is tested with (the test is not vacuous)', () => {
    expect(LATEST()).toBeGreaterThan(1);
  });

  it('runs the missing migrations and ends at the latest user_version', () => {
    installVersion1();
    expect(userVersion()).toBe(LATEST()); // opens through getDb()
    expect(all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_workers'")).toHaveLength(1);
    expect(all<{ foreign_keys: number }>('PRAGMA foreign_keys')[0].foreign_keys).toBe(1);
  });

  it('loses no row and changes no value in any version-1 table', () => {
    const before = installVersion1();
    getDb();
    const after = dumpV1(getDb());

    for (const t of V1_DATA_TABLES) {
      expect({ table: t, rows: after[t] }).toEqual({ table: t, rows: before.rows[t] });
    }
    // the sizes spelled out, so a wrong fixture cannot hide a loss
    expect(after.projects).toHaveLength(4);
    expect(after.workers).toHaveLength(4);
    expect(after.wage_entries).toHaveLength(11);
    expect(after.expenses).toHaveLength(5);
    expect(after.tools).toHaveLength(4);
    expect(after.tool_movements).toHaveLength(5);
    expect(after.site_notes).toHaveLength(2);
    expect(after.attachments).toHaveLength(2);
    expect(after.audit_log).toHaveLength(3);
    expect(after.settings.map((s) => s.key)).toEqual(['current_project', 'device_id', 'language']);
  });

  it('keeps soft-deleted rows soft-deleted (nothing comes back, nothing is hard-deleted)', () => {
    installVersion1();
    expect(first('SELECT deleted_at FROM projects WHERE id = ?', [L.cancelled])).not.toEqual({ deleted_at: null });
    expect(all('SELECT project_id FROM v_project_cost WHERE project_id = ?', [L.cancelled])).toEqual([]);
    expect(all('SELECT worker_id FROM v_worker_balance WHERE worker_id = ?', [L.retired])).toEqual([]);
    expect(first<{ n: number }>('SELECT COUNT(*) AS n FROM wage_entries WHERE deleted_at IS NOT NULL')?.n).toBe(1);
    expect(first<{ n: number }>('SELECT COUNT(*) AS n FROM expenses WHERE deleted_at IS NOT NULL')?.n).toBe(2);
  });

  it('leaves no dangling foreign key behind', () => {
    installVersion1();
    getDb();
    expect(all('PRAGMA foreign_key_check')).toEqual([]);
  });

  describe('the numbers the owner relies on', () => {
    it('v_worker_balance, v_project_cost and v_tool_status are identical before and after', () => {
      const before = installVersion1();
      getDb();
      expect(dumpViews(getDb())).toEqual(before.views);
    });

    it('v_worker_balance matches the hand-computed balances (work without a project still counts)', () => {
      installVersion1();
      const rows = all<{ worker_id: string; earned_cents: number; advance_cents: number; paid_cents: number; balance_cents: number }>(
        'SELECT * FROM v_worker_balance',
      );
      expect(rows).toHaveLength(3); // the soft-deleted worker is not listed
      for (const [id, want] of Object.entries(EXPECTED.workers)) {
        const got = rows.find((r) => r.worker_id === id);
        expect({ id, earned: got?.earned_cents, advance: got?.advance_cents, paid: got?.paid_cents, balance: got?.balance_cents }).toEqual({
          id,
          earned: want.earned,
          advance: want.advance,
          paid: want.paid,
          balance: want.balance,
        });
      }
    });

    it('v_project_cost matches the hand-computed expense, labour and labour-paid per project', () => {
      installVersion1();
      const rows = all<{ project_id: string; expense_cents: number; labour_cents: number; labour_paid_cents: number }>('SELECT * FROM v_project_cost');
      expect(rows.map((r) => r.project_id).sort()).toEqual([L.school, L.culvert, L.drain].sort());
      for (const [id, want] of Object.entries(EXPECTED.projects)) {
        const got = rows.find((r) => r.project_id === id);
        expect({ id, expense: got?.expense_cents, labour: got?.labour_cents, labourPaid: got?.labour_paid_cents }).toEqual({ id, ...want });
      }
    });

    it('v_tool_status: latest movement wins, and the same-day return written later puts the ladder back in', () => {
      installVersion1();
      const status = Object.fromEntries(all<{ tool_id: string; is_out: number; last_kind: string | null }>('SELECT * FROM v_tool_status').map((r) => [r.tool_id, r]));
      expect(status[L.drill]).toMatchObject({ is_out: 1, last_kind: 'issue' });
      expect(status[L.mixer]).toMatchObject({ is_out: 0, last_kind: 'return' });
      expect(status[L.ladder]).toMatchObject({ is_out: 0, last_kind: 'return' });
      expect(status[L.survey]).toMatchObject({ is_out: 0, last_kind: null });
    });
  });

  describe('old wage entries stay attributed to the right worker, project and day', () => {
    it('every old work/advance/payment row is still in the same project and still counted once', () => {
      installVersion1();
      const rows = all<{ id: string; worker_id: string; project_id: string | null; day: string; kind: string; amount_cents: number }>(
        'SELECT id, worker_id, project_id, day, kind, amount_cents FROM wage_entries WHERE deleted_at IS NULL ORDER BY id',
      );
      expect(rows).toHaveLength(10);
      expect(rows.filter((r) => r.project_id === null).map((r) => r.id)).toEqual(['00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000106']);
      expect(rows.filter((r) => r.project_id === L.school)).toHaveLength(5);
      expect(rows.filter((r) => r.project_id === L.culvert)).toHaveLength(3);
    });

    it('v_project_worker_balance shows each old worker on the project the wages were filed under', () => {
      installVersion1();
      const rows = all<{
        project_id: string;
        worker_id: string;
        name: string;
        rate_cents: number;
        active: number;
        earned_cents: number;
        advance_cents: number;
        paid_cents: number;
        balance_cents: number;
        days_total: number;
      }>('SELECT * FROM v_project_worker_balance ORDER BY project_id, worker_id');

      const pick = (project: string, worker: string) => rows.find((r) => r.project_id === project && r.worker_id === worker);
      // school: Nimal 2 days earned, Rs 4,000 paid; Sunil 1 day, Rs 500 advance
      expect(pick(L.school, L.nimal)).toMatchObject({ earned_cents: 700_000, advance_cents: 0, paid_cents: 400_000, balance_cents: 300_000, days_total: 2 });
      expect(pick(L.school, L.sunil)).toMatchObject({ earned_cents: 380_000, advance_cents: 50_000, paid_cents: 0, balance_cents: 330_000, days_total: 1 });
      // culvert: Nimal half a day, Kamal a day and a half with Rs 1,000 paid
      expect(pick(L.culvert, L.nimal)).toMatchObject({ earned_cents: 175_000, balance_cents: 175_000, days_total: 0.5 });
      expect(pick(L.culvert, L.kamal)).toMatchObject({ earned_cents: 330_000, paid_cents: 100_000, balance_cents: 230_000, days_total: 1.5 });
      // nobody else, and nobody twice
      expect(rows).toHaveLength(4);
      // the assignments made for them carry the worker's own daily rate and active flag
      const want: [string, string, number, number][] = [
        [L.school, L.nimal, 350_000, 1],
        [L.school, L.sunil, 380_000, 1],
        [L.culvert, L.nimal, 350_000, 1],
        [L.culvert, L.kamal, 220_000, 0], // Kamal is inactive
      ];
      want.sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1]));
      expect(rows.map((r) => [r.project_id, r.worker_id, r.rate_cents, r.active])).toEqual(want);
    });

    it('a worker whose wages are all deleted, a deleted worker and a deleted project get no assignment', () => {
      installVersion1();
      expect(all('SELECT * FROM project_workers WHERE worker_id = ? OR project_id = ?', [L.retired, L.cancelled])).toEqual([]);
      expect(all('SELECT 1 FROM project_workers WHERE project_id = ? AND worker_id = ?', [L.school, L.retired])).toEqual([]);
      // Sunil's removed entry on the school does not matter: he has live ones there. Four assignments in all.
      expect(first<{ n: number }>('SELECT COUNT(*) AS n FROM project_workers')?.n).toBe(4);
    });

    it('wage entries filed under no project get no assignment (there is no project to put them on)', () => {
      installVersion1();
      expect(all('SELECT * FROM project_workers WHERE project_id IS NULL')).toEqual([]);
    });

    it('the per-project balances plus the entries filed under no project add up to v_worker_balance', () => {
      installVersion1();
      for (const [workerId, want] of Object.entries(EXPECTED.workers)) {
        const onProjects = first<{ s: number }>('SELECT COALESCE(SUM(balance_cents), 0) AS s FROM v_project_worker_balance WHERE worker_id = ?', [workerId])?.s;
        const noProject = first<{ s: number }>(
          "SELECT COALESCE(SUM(CASE WHEN kind = 'work' THEN amount_cents ELSE -amount_cents END), 0) AS s FROM wage_entries WHERE worker_id = ? AND project_id IS NULL AND deleted_at IS NULL",
          [workerId],
        )?.s;
        expect({ workerId, total: (onProjects ?? 0) + (noProject ?? 0) }).toEqual({ workerId, total: want.balance });
      }
    });

    it('v_wage_day lists the old days; a day with only a payment has days = NULL', () => {
      installVersion1();
      const day = (project: string, worker: string, d: string) =>
        first<{ days: number | null; work_cents: number; paid_cents: number; advance_cents: number }>(
          'SELECT days, work_cents, paid_cents, advance_cents FROM v_wage_day WHERE project_id = ? AND worker_id = ? AND day = ?',
          [project, worker, d],
        );
      expect(day(L.school, L.nimal, '2026-10-01')).toEqual({ days: 1, work_cents: 350_000, paid_cents: 0, advance_cents: 0 });
      expect(day(L.school, L.nimal, '2026-10-04')).toEqual({ days: null, work_cents: 0, paid_cents: 400_000, advance_cents: 0 });
      expect(day(L.school, L.sunil, '2026-10-01')).toEqual({ days: 1, work_cents: 380_000, paid_cents: 0, advance_cents: 50_000 });
      expect(day(L.culvert, L.kamal, '2026-10-03')).toEqual({ days: 1.5, work_cents: 330_000, paid_cents: 100_000, advance_cents: 0 });
      // the removed entry and the no-project entries never show up in a project day
      expect(day(L.school, L.sunil, '2026-10-02')).toBeNull();
      expect(all('SELECT * FROM v_wage_day WHERE project_id IS NULL')).toEqual([]);
    });
  });

  describe('the new tables and views work on top of the old data', () => {
    it('assigning an already-assigned old worker updates the row instead of adding a second one', () => {
      installVersion1();
      assignWorker({ project_id: L.school, worker_id: L.nimal, rate_cents: 360_000 });
      expect(all('SELECT rate_cents, version FROM project_workers WHERE project_id = ? AND worker_id = ? AND deleted_at IS NULL', [L.school, L.nimal])).toEqual([
        { rate_cents: 360_000, version: 2 },
      ]);
      // his old earnings are untouched by the new rate; only future days use it
      expect(first('SELECT earned_cents FROM v_project_worker_balance WHERE project_id = ? AND worker_id = ?', [L.school, L.nimal])).toEqual({ earned_cents: 700_000 });
    });

    it('marking a day that was already recorded in version 1 updates that entry (no second entry for the day)', () => {
      installVersion1();
      assignWorker({ project_id: L.school, worker_id: L.nimal, rate_cents: 350_000 });
      const oldId = '00000000-0000-4000-8000-000000000102';
      expect(recordWorkDay({ project_id: L.school, worker_id: L.nimal, day: '2026-10-02', days: 1.5 })).toBe(oldId);
      expect(all("SELECT id FROM wage_entries WHERE worker_id = ? AND project_id = ? AND day = '2026-10-02' AND kind = 'work' AND deleted_at IS NULL", [L.nimal, L.school])).toEqual([
        { id: oldId },
      ]);
      expect(first('SELECT days, amount_cents, version FROM wage_entries WHERE id = ?', [oldId])).toEqual({ days: 1.5, amount_cents: 525_000, version: 2 });
      // 1 + 1.5 days at Rs 3,500 = Rs 8,750 earned here, less Rs 4,000 paid
      expect(first('SELECT earned_cents, paid_cents, balance_cents FROM v_project_worker_balance WHERE project_id = ? AND worker_id = ?', [L.school, L.nimal])).toEqual({
        earned_cents: 875_000,
        paid_cents: 400_000,
        balance_cents: 475_000,
      });
    });

    it('new work, pay and expenses add to the old totals exactly', () => {
      installVersion1();
      assignWorker({ project_id: L.culvert, worker_id: L.sunil, rate_cents: 400_000 });
      recordWorkDay({ project_id: L.culvert, worker_id: L.sunil, day: '2026-10-07', days: 2 });
      payWages({ project_id: L.culvert, worker_id: L.sunil, day: '2026-10-07', amount_cents: 300_000 });
      saveExpense({ project_id: L.culvert, day: '2026-10-07', category: 'food', amount_cents: 12_345, method: 'cash' });

      expect(first('SELECT labour_cents, labour_paid_cents, expense_cents FROM v_project_cost WHERE project_id = ?', [L.culvert])).toEqual({
        labour_cents: 505_000 + 800_000,
        labour_paid_cents: 100_000 + 300_000,
        expense_cents: 850_000 + 12_345,
      });
      // Sunil's overall balance: 330,000 + 800,000 earned - 300,000 paid
      expect(first('SELECT balance_cents FROM v_worker_balance WHERE worker_id = ?', [L.sunil])).toEqual({ balance_cents: 330_000 + 800_000 - 300_000 });
      expect(first('SELECT days, work_cents, paid_cents FROM v_wage_day WHERE project_id = ? AND worker_id = ? AND day = ?', [L.culvert, L.sunil, '2026-10-07'])).toEqual({
        days: 2,
        work_cents: 800_000,
        paid_cents: 300_000,
      });
    });

    it('new writes continue the old audit log instead of restarting it', () => {
      installVersion1();
      assignWorker({ project_id: L.school, worker_id: L.sunil, rate_cents: 380_000 });
      const log = all<{ seq: number; table_name: string; action: string }>('SELECT seq, table_name, action FROM audit_log ORDER BY seq');
      expect(log.slice(0, 3).map((r) => r.seq)).toEqual([1, 2, 3]);
      expect(log.slice(0, 3).every((r) => r.action === 'insert')).toBe(true);
      expect(log.length).toBeGreaterThan(3);
      expect(log[3].seq).toBe(4);
      expect(log.some((r) => r.table_name === 'project_workers')).toBe(true);
    });

    it('old rows keep their original device id until somebody edits them', () => {
      installVersion1();
      expect(first<{ n: number }>('SELECT COUNT(*) AS n FROM wage_entries WHERE device_id != ?', [L.device])?.n).toBe(0);
      recordWorkDay({ project_id: L.school, worker_id: L.nimal, day: '2026-10-01', days: 1, amount_cents: 350_000 });
      const row = first<{ device_id: string; version: number }>('SELECT device_id, version FROM wage_entries WHERE id = ?', ['00000000-0000-4000-8000-000000000101']);
      expect(row?.version).toBe(2);
      expect(row?.device_id).toBe(L.device); // same install, same device id
    });
  });

  describe('running the migration path again', () => {
    it('is a no-op: restarting the app several times changes nothing', () => {
      const before = installVersion1();
      getDb();
      const snapshot = () => ({ schema: schemaObjects(), version: userVersion(), data: dumpV1(getDb()) });
      const first1 = snapshot();
      for (let i = 0; i < 3; i++) {
        closeDb();
        getDb();
      }
      expect(snapshot()).toEqual(first1);
      expect(first1.version).toBe(LATEST());
      expect(first1.data.projects).toEqual(before.rows.projects);
      expect(first1.data.audit_log).toEqual(before.rows.audit_log);
    });

    it('does not re-run a migration that is already applied (nothing is written)', () => {
      installVersion1();
      getDb();
      const count = () => first<{ n: number }>('SELECT (SELECT COUNT(*) FROM project_workers) AS n')?.n;
      const n = count();
      closeDb();
      getDb();
      closeDb();
      getDb();
      expect(count()).toBe(n);
    });

    it('a database already at the latest version is opened untouched', () => {
      resetDb();
      const db = openLegacyDb(LATEST());
      db.runSync(
        "INSERT INTO projects(id, created_at, updated_at, version, device_id, name) VALUES ('p1', 't', 't', 1, 'd', 'Existing')",
      );
      db.closeSync();
      expect(all('SELECT name FROM projects')).toEqual([{ name: 'Existing' }]);
      expect(userVersion()).toBe(LATEST());
    });

    it('a fresh install and an upgraded install end up with the same tables, columns, indexes and views', () => {
      installVersion1();
      getDb();
      const describeSchema = () =>
        schemaObjects().map((o) => ({
          ...o,
          columns: o.type === 'table' ? all<{ name: string; type: string; notnull: number }>(`PRAGMA table_info(${o.name})`).map((c) => `${c.name}:${c.type}:${c.notnull}`) : undefined,
          viewColumns: o.type === 'view' ? all<{ name: string }>(`PRAGMA table_info(${o.name})`).map((c) => c.name) : undefined,
        }));
      const upgraded = describeSchema();
      resetDb();
      getDb(); // fresh install: migrations 1..latest
      expect(describeSchema()).toEqual(upgraded);
    });
  });

  it('backfills nothing it should not: version-1 databases with no wages get no assignments', () => {
    resetDb();
    const old = openLegacyDb(1);
    old.runSync("INSERT INTO projects(id, created_at, updated_at, version, device_id, name) VALUES ('p1', 't', 't', 1, 'd', 'Empty job')");
    old.runSync("INSERT INTO workers(id, created_at, updated_at, version, device_id, name) VALUES ('w1', 't', 't', 1, 'd', 'Idle worker')");
    old.closeSync();
    expect(all('SELECT * FROM project_workers')).toEqual([]);
    expect(all('SELECT * FROM v_project_worker_balance')).toEqual([]);
  });

  it('survives the same upgrade when the database is a real file (WAL) and the app restarts', () => {
    resetDb({ fileDb: true });
    const old = openLegacyDb(1);
    fillVersion1(old);
    const before = dumpV1(old);
    old.closeSync();

    expect(userVersion()).toBe(LATEST());
    closeDb();
    expect(dumpV1(getDb())).toEqual(before);
    expect(new File(Paths.document, 'SQLite', DB_NAME).exists).toBe(true);
    // nothing was set aside
    expect(new Directory(Paths.document, 'SQLite').list().filter((e) => e.name.includes('.corrupt-'))).toEqual([]);
    expect(first('SELECT value FROM settings WHERE key = ?', ['recovered_from_corruption'])).toBeNull();
  });
});

describe('upgrading a version-2 database (assignments already exist)', () => {
  const stamp = '2026-10-10T04:00:00.000Z';
  const base = (id: string) => ({ id, created_at: stamp, updated_at: stamp, version: 1, device_id: 'dev' });

  function installVersion2() {
    resetDb();
    const old = openLegacyDb(2);
    insertRow(old, 'projects', { ...base('P'), name: 'Job', status: 'active' });
    insertRow(old, 'workers', { ...base('KEPT'), name: 'Kept on', daily_rate_cents: 100_000, active: 1 });
    insertRow(old, 'workers', { ...base('GONE'), name: 'Taken off', daily_rate_cents: 100_000, active: 1 });
    insertRow(old, 'workers', { ...base('NEW'), name: 'Never assigned', daily_rate_cents: 100_000, active: 1 });
    // KEPT is assigned at a project rate of 1,200 (not the default 1,000); GONE was assigned and then removed
    insertRow(old, 'project_workers', { ...base('pw-kept'), project_id: 'P', worker_id: 'KEPT', rate_cents: 120_000, active: 1, deleted_at: null });
    insertRow(old, 'project_workers', { ...base('pw-gone'), project_id: 'P', worker_id: 'GONE', rate_cents: 110_000, active: 1, deleted_at: '2026-10-11T00:00:00.000Z' });
    for (const [i, w] of ['KEPT', 'GONE', 'NEW'].entries()) {
      insertRow(old, 'wage_entries', { ...base(`we-${i}`), worker_id: w, project_id: 'P', day: '2026-10-09', kind: 'work', days: 1, amount_cents: 100_000, deleted_at: null });
    }
    old.closeSync();
  }

  it('leaves existing assignments exactly as they are, including a removed one, and adds one for the unassigned worker with wages', () => {
    installVersion2();
    const rows = all<{ id: string; worker_id: string; rate_cents: number; deleted_at: string | null; version: number }>('SELECT * FROM project_workers ORDER BY worker_id');
    expect(rows.map((r) => [r.worker_id, r.id.startsWith('pw:') ? 'new' : r.id, r.rate_cents, r.deleted_at === null ? 'live' : 'removed'])).toEqual([
      ['GONE', 'pw-gone', 110_000, 'removed'], // not brought back
      ['KEPT', 'pw-kept', 120_000, 'live'], // not touched, rate kept
      ['NEW', 'new', 100_000, 'live'],
    ]);
    expect(rows.find((r) => r.worker_id === 'KEPT')?.version).toBe(1);
    expect(all('SELECT worker_id FROM v_project_worker_balance ORDER BY worker_id')).toEqual([{ worker_id: 'KEPT' }, { worker_id: 'NEW' }]);
  });

  it('the wage history of the removed assignment is still there, unchanged', () => {
    installVersion2();
    expect(first('SELECT earned_cents FROM v_worker_balance WHERE worker_id = ?', ['GONE'])).toEqual({ earned_cents: 100_000 });
    expect(first("SELECT labour_cents FROM v_project_cost WHERE project_id = 'P'")).toEqual({ labour_cents: 300_000 });
  });
});

describe('upgrading a version-3 database (migration 4: a worker who left is inactive on the roster)', () => {
  const stamp = '2026-10-10T04:00:00.000Z';
  const base = (id: string) => ({ id, created_at: stamp, updated_at: stamp, version: 1, device_id: 'dev' });
  // the tables a version-3 phone has (estimates arrived with version 5)
  const ALL_TABLES = [...DATA_TABLES.filter((t) => !t.startsWith('estimate')), 'audit_log', 'settings'] as const;
  const ROSTER = 'SELECT * FROM v_project_worker_balance ORDER BY project_id, worker_id';

  type Reader = { getAllSync: <T>(sql: string) => T[] };
  const dumpAll = (db: Reader): Record<string, Rows> =>
    Object.fromEntries(ALL_TABLES.map((t) => [t, db.getAllSync<Record<string, unknown>>(`SELECT * FROM ${t} ORDER BY ${ORDER[t] ?? 'id'}`)]));

  /** A phone on schema version 3 that holds a worker who has left but is still assigned (the bug this fixes). */
  function installVersion3() {
    resetDb();
    const old = openLegacyDb(3);
    insertRow(old, 'projects', { ...base('P'), name: 'School', status: 'active' });
    insertRow(old, 'projects', { ...base('Q'), name: 'Culvert', status: 'active' });
    insertRow(old, 'workers', { ...base('STAY'), name: 'Stays', daily_rate_cents: 100_000, active: 1 });
    insertRow(old, 'workers', { ...base('LEFT'), name: 'Left the company', daily_rate_cents: 120_000, active: 0 });
    insertRow(old, 'workers', { ...base('OFF'), name: 'Off this project', daily_rate_cents: 90_000, active: 1 });
    // LEFT was marked as left (workers.active = 0) but both of the assignments still say 1
    insertRow(old, 'project_workers', { ...base('pw-stay-p'), project_id: 'P', worker_id: 'STAY', rate_cents: 110_000, active: 1 });
    insertRow(old, 'project_workers', { ...base('pw-left-p'), project_id: 'P', worker_id: 'LEFT', rate_cents: 125_000, active: 1 });
    insertRow(old, 'project_workers', { ...base('pw-left-q'), project_id: 'Q', worker_id: 'LEFT', rate_cents: 130_000, active: 1 });
    insertRow(old, 'project_workers', { ...base('pw-off-p'), project_id: 'P', worker_id: 'OFF', rate_cents: 95_000, active: 0 });
    const we = (id: string, worker: string, project: string, kind: string, amount: number, days: number | null) =>
      insertRow(old, 'wage_entries', { ...base(id), worker_id: worker, project_id: project, day: '2026-10-09', kind, days, amount_cents: amount });
    we('we-1', 'STAY', 'P', 'work', 110_000, 1);
    we('we-2', 'LEFT', 'P', 'work', 250_000, 2);
    we('we-3', 'LEFT', 'P', 'payment', 100_000, null);
    we('we-4', 'LEFT', 'Q', 'work', 130_000, 1);
    we('we-5', 'LEFT', 'Q', 'advance', 30_000, null);
    we('we-6', 'OFF', 'P', 'work', 95_000, 1);
    insertRow(old, 'expenses', { ...base('ex-1'), project_id: 'P', day: '2026-10-09', category: 'food', amount_cents: 4_200, method: 'cash' });
    insertRow(old, 'tools', { ...base('drill'), name: 'Drill' });
    insertRow(old, 'tool_movements', { ...base('mv-1'), tool_id: 'drill', kind: 'issue', project_id: 'P', worker_id: 'LEFT', day: '2026-10-09' });
    insertRow(old, 'site_notes', { ...base('sn-1'), project_id: 'P', day: '2026-10-09', body: 'Slab poured' });
    old.runSync("INSERT INTO settings(key, value) VALUES ('language', 'si')");
    old.runSync("INSERT INTO audit_log(at, device_id, table_name, row_id, action, data) VALUES (?, 'dev', 'workers', 'LEFT', 'update', NULL)", [stamp]);
    expect(old.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(3);
    const rows = dumpAll(old);
    const roster = old.getAllSync<Record<string, unknown>>(ROSTER);
    old.closeSync();
    return { rows, roster };
  }

  it('has a newer schema than the data it is tested with (the test is not vacuous)', () => {
    expect(LATEST()).toBeGreaterThan(3);
  });

  it('runs migration 4 and ends at the latest user_version', () => {
    installVersion3();
    expect(userVersion()).toBe(LATEST());
  });

  it('loses no row and changes no value in any table, the audit log and the settings included', () => {
    const before = installVersion3();
    getDb();
    const after = dumpAll(getDb());
    for (const t of ALL_TABLES) expect({ table: t, rows: after[t] }).toEqual({ table: t, rows: before.rows[t] });
    expect(after.wage_entries).toHaveLength(6);
    expect(after.project_workers).toHaveLength(4);
    expect(after.workers).toHaveLength(3);
    expect(after.audit_log).toHaveLength(1);
    expect(all('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('the roster before the upgrade shows the worker who left as active (what the bug looked like)', () => {
    const { roster } = installVersion3();
    expect(roster.filter((r) => r.worker_id === 'LEFT').map((r) => r.active)).toEqual([1, 1]);
  });

  it('afterwards the worker who left is inactive on every project, still listed, every other column unchanged', () => {
    const { roster } = installVersion3();
    const after = all<Record<string, unknown>>(ROSTER);
    expect(after).toHaveLength(roster.length);
    expect(after.filter((r) => r.worker_id === 'LEFT').map((r) => [r.project_id, r.active])).toEqual([['P', 0], ['Q', 0]]);
    // a roster row, apart from `active`, is exactly what it was: balances, days, rate, name
    const without = (r: Record<string, unknown>) => ({ ...r, active: undefined });
    expect(after.map(without)).toEqual(roster.map(without));
    expect(after.find((r) => r.worker_id === 'LEFT' && r.project_id === 'P')).toMatchObject({ earned_cents: 250_000, paid_cents: 100_000, balance_cents: 150_000, days_total: 2 });
    expect(after.find((r) => r.worker_id === 'LEFT' && r.project_id === 'Q')).toMatchObject({ earned_cents: 130_000, advance_cents: 30_000, balance_cents: 100_000 });
  });

  it('a worker who is still working keeps the assignment flag they had (on stays on, off stays off)', () => {
    installVersion3();
    const active = (project: string, worker: string) => first<{ active: number }>('SELECT active FROM v_project_worker_balance WHERE project_id = ? AND worker_id = ?', [project, worker])?.active;
    expect(active('P', 'STAY')).toBe(1);
    expect(active('P', 'OFF')).toBe(0);
  });

  it('the view keeps the same columns in the same order', () => {
    resetDb();
    const old = openLegacyDb(3);
    const columns = old.getAllSync<{ name: string }>('PRAGMA table_info(v_project_worker_balance)').map((c) => c.name);
    old.closeSync();
    getDb();
    expect(all<{ name: string }>('PRAGMA table_info(v_project_worker_balance)').map((c) => c.name)).toEqual(columns);
    expect(columns).toEqual(['project_id', 'worker_id', 'name', 'trade', 'phone', 'rate_cents', 'active', 'earned_cents', 'advance_cents', 'paid_cents', 'balance_cents', 'days_total']);
  });

  it('the upgraded view is the same view a fresh install gets, and a restart changes nothing', () => {
    installVersion3();
    getDb();
    const viewSql = () => first<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'v_project_worker_balance'")?.sql;
    const upgraded = viewSql();
    const snapshot = () => ({ schema: schemaObjects(), version: userVersion(), data: dumpAll(getDb()) });
    const first1 = snapshot();
    for (let i = 0; i < 2; i++) {
      closeDb();
      getDb();
    }
    expect(snapshot()).toEqual(first1);
    resetDb();
    getDb();
    expect(viewSql()).toBe(upgraded);
  });

  it('marking the worker as working again brings the roster entries back to active', () => {
    installVersion3();
    getDb().runSync("UPDATE workers SET active = 1 WHERE id = 'LEFT'");
    expect(all('SELECT project_id, active FROM v_project_worker_balance WHERE worker_id = ? ORDER BY project_id', ['LEFT'])).toEqual([
      { project_id: 'P', active: 1 },
      { project_id: 'Q', active: 1 },
    ]);
  });
});

describe('two phones that upgrade the same version-1 data', () => {
  let other: ReturnType<typeof openSecondPhone>;
  beforeAll(() => {
    other = openSecondPhone();
  });
  afterAll(() => other.dispose());

  it('end up with the same assignment rows, so handing a project between them never doubles a worker', async () => {
    resetDb();
    other.resetDb();
    const seed = (db: ReturnType<typeof openLegacyDb>) => {
      fillVersion1(db);
      db.closeSync();
    };
    seed(openLegacyDb(1));
    other.run(() => seed(openLegacyDb(1)));

    const ids = (phone: typeof other) => phone.db.all<{ id: string }>('SELECT id FROM project_workers ORDER BY id').map((r) => r.id);
    expect(ids(other)).toEqual(ids(mainPhone()));
    expect(ids(other)).toHaveLength(4);

    await transfer(mainPhone(), other, { projectId: L.school });
    await transfer(other, mainPhone(), { projectId: L.school });

    for (const phone of [mainPhone(), other]) {
      expect(phone.db.all('SELECT project_id, worker_id FROM project_workers WHERE deleted_at IS NULL ORDER BY id')).toHaveLength(4);
      expect(phone.db.first('SELECT earned_cents, paid_cents FROM v_project_worker_balance WHERE project_id = ? AND worker_id = ?', [L.school, L.nimal])).toEqual({
        earned_cents: 700_000,
        paid_cents: 400_000,
      });
    }
  });
});

describe('a migration that fails', () => {
  /** SQL that does real work (creates a table, inserts), then breaks. */
  const BROKEN = `
    CREATE TABLE half_done (id TEXT PRIMARY KEY);
    INSERT INTO half_done VALUES ('x');
    ALTER TABLE projects ADD COLUMN extra TEXT;
    INSERT INTO table_that_does_not_exist VALUES (1);
  `;
  let mute: ReturnType<typeof silenceConsoleError>;

  beforeEach(() => {
    mute = silenceConsoleError();
  });
  afterEach(() => {
    mute.mockRestore();
    while (migrations.length > 2 && migrations[migrations.length - 1] === BROKEN) migrations.pop();
  });

  function withBrokenMigration<T>(fn: (n: number) => T): T {
    migrations.push(BROKEN);
    try {
      return fn(migrations.length);
    } finally {
      migrations.pop();
    }
  }

  it('is reported with its number and the database does not open', () => {
    installVersion1();
    getDb(); // upgrade to the current latest first, with the real migrations
    closeDb();
    withBrokenMigration((n) => {
      expect(() => getDb()).toThrow(new RegExp(`Migration ${n} failed`));
    });
  });

  it('rolls back completely: no half-created table, no extra column, user_version unchanged, every row intact', () => {
    const before = installVersion1();
    getDb();
    const latestBefore = userVersion();
    const structureBefore = schemaObjects();
    closeDb();

    withBrokenMigration(() => {
      expect(() => getDb()).toThrow(/Migration \d+ failed/);
    });

    // look at the database with a plain connection, the way the next app start will
    const raw = SQLite.openDatabaseSync(DB_NAME);
    expect(raw.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(latestBefore);
    expect(raw.getAllSync("SELECT name FROM sqlite_master WHERE name = 'half_done'")).toEqual([]);
    expect(raw.getAllSync<{ name: string }>('PRAGMA table_info(projects)').map((c) => c.name)).not.toContain('extra');
    expect(dumpV1(raw)).toEqual(before.rows);
    raw.closeSync();

    // and the fixed app (without the broken step) opens the very same data
    expect(userVersion()).toBe(latestBefore);
    expect(schemaObjects()).toEqual(structureBefore);
    expect(dumpV1(getDb())).toEqual(before.rows);
  });

  it('a broken step after a good one keeps the good one: the upgrade is one step at a time', () => {
    const before = installVersion1();
    const GOOD = 'CREATE TABLE good_step (id TEXT PRIMARY KEY);';
    migrations.push(GOOD, BROKEN);
    try {
      expect(() => getDb()).toThrow(new RegExp(`Migration ${migrations.length} failed`));
    } finally {
      migrations.pop();
      migrations.pop();
    }
    const raw = SQLite.openDatabaseSync(DB_NAME);
    // migrations 2 and the good step were applied and committed; the broken one left no trace
    expect(raw.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(LATEST() + 1);
    expect(raw.getAllSync("SELECT name FROM sqlite_master WHERE name IN ('good_step', 'half_done')").map((r) => (r as { name: string }).name)).toEqual(['good_step']);
    expect(dumpV1(raw)).toEqual(before.rows);
    raw.closeSync();
  });

  it('on a real file the owner data stays in place (it is not moved aside as if it were corrupt)', () => {
    resetDb({ fileDb: true });
    const old = openLegacyDb(1);
    fillVersion1(old);
    const before = dumpV1(old);
    old.closeSync();
    getDb(); // real upgrade
    closeDb();

    withBrokenMigration(() => {
      expect(() => getDb()).toThrow(/Migration \d+ failed/);
    });

    const dir = new Directory(Paths.document, 'SQLite');
    const names = dir.list().map((e) => e.name);
    expect(names.filter((n) => n.includes('.corrupt-'))).toEqual([]);
    const raw = SQLite.openDatabaseSync(DB_NAME);
    expect(dumpV1(raw)).toEqual(before);
    raw.closeSync();
    // the next start (with a fixed app) is a normal start, not a recovery
    expect(dumpV1(getDb())).toEqual(before);
    expect(first('SELECT value FROM settings WHERE key = ?', ['recovered_from_corruption'])).toBeNull();
  });
});

describe('the migrations themselves', () => {
  it('only ever append: migration 1 still creates exactly the version-1 tables', () => {
    resetDb();
    const db = SQLite.openDatabaseSync('probe.db');
    db.execSync(migrations[0]);
    const tables = db.getAllSync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((t) => t.name);
    expect(tables).toEqual([...V1_TABLES].sort());
    db.closeSync();
  });

  it('every migration is a single non-empty script', () => {
    for (const m of migrations) expect(m.trim().length).toBeGreaterThan(20);
  });
});
