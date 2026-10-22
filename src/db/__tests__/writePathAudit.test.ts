/**
 * The single write path: every change bumps the version, stamps the time and device,
 * and leaves an audit entry. Nothing can overwrite the bookkeeping columns.
 */
import { all, closeDb, deviceId, first, getSetting, remove, save, setSetting } from '@/db';
import {
  assignWorker,
  deleteRecord,
  moveTool,
  payWages,
  recordWorkDay,
  removeWorkDay,
  saveExpense,
  saveNote,
  saveProject,
  saveTool,
  saveWageEntry,
  saveWorker,
  unassignWorker,
} from '@/db/repo';
import { DATA_TABLES } from '@/db/schema';
import { readErrorLog } from '@/lib/errors';
import { addPhotos } from '@/lib/files';
import { queuePhotos, resetDb, seedDemo, silenceConsoleError } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

const T0 = '2026-10-20T04:00:00.000Z';
let clock: ReturnType<typeof useClock>;

beforeEach(() => {
  resetDb();
  clock = useClock(T0);
});
afterEach(() => clock.restore());

interface AuditRow {
  seq: number;
  at: string;
  device_id: string;
  table_name: string;
  row_id: string;
  action: string;
  data: string | null;
}
const audit = (where = '1=1', params: (string | number)[] = []) => all<AuditRow>(`SELECT * FROM audit_log WHERE ${where} ORDER BY seq`, params);
const auditCount = () => first<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n ?? 0;

describe('save()', () => {
  it('insert: version 1, created_at = updated_at = now, this device, an insert audit entry with the full row', () => {
    const id = save('projects', { name: 'Welimada school', status: 'active' });
    const row = first<Record<string, unknown>>('SELECT * FROM projects WHERE id = ?', [id]);
    expect(row).toMatchObject({ version: 1, created_at: T0, updated_at: T0, deleted_at: null, device_id: deviceId(), name: 'Welimada school' });
    const [entry] = audit('row_id = ?', [id]);
    expect(entry).toMatchObject({ table_name: 'projects', row_id: id, action: 'insert', device_id: deviceId(), at: T0 });
    expect(JSON.parse(entry.data as string)).toMatchObject({ id, name: 'Welimada school', version: 1, device_id: deviceId() });
  });

  it('update: version + 1, new updated_at, created_at untouched, an update audit entry with the changed values', () => {
    const id = save('projects', { name: 'Old name' });
    clock.tick(60_000);
    save('projects', { id, name: 'New name' });
    clock.tick(60_000);
    save('projects', { id, client: 'RDA' });
    expect(first('SELECT name, client, version, created_at, updated_at FROM projects WHERE id = ?', [id])).toEqual({
      name: 'New name', // a partial update leaves the other columns alone
      client: 'RDA',
      version: 3,
      created_at: T0,
      updated_at: new Date(Date.parse(T0) + 120_000).toISOString(),
    });
    expect(audit('row_id = ?', [id]).map((a) => a.action)).toEqual(['insert', 'update', 'update']);
    expect(JSON.parse(audit('row_id = ?', [id])[1].data as string)).toEqual({ id, name: 'New name' });
  });

  it('the bookkeeping columns cannot be set from outside', () => {
    const id = save('projects', { name: 'A', version: 99, created_at: '1999-01-01T00:00:00.000Z', updated_at: '1999', device_id: 'evil' } as never);
    expect(first('SELECT version, created_at, updated_at, device_id FROM projects WHERE id = ?', [id])).toMatchObject({ version: 1, created_at: T0, updated_at: T0, device_id: deviceId() });

    clock.tick(1_000);
    save('projects', { id, name: 'B', version: 50, created_at: '1999-01-01T00:00:00.000Z', device_id: 'evil' });
    expect(first('SELECT version, created_at, device_id, name FROM projects WHERE id = ?', [id])).toEqual({ version: 2, created_at: T0, device_id: deviceId(), name: 'B' });
  });

  it('ignores a column that does not exist instead of failing or storing it', () => {
    const id = save('projects', { name: 'A', bogus: 'x' } as never);
    expect(first('SELECT name FROM projects WHERE id = ?', [id])).toEqual({ name: 'A' });
  });

  it('saving with an id that is not in the table inserts that id (the form-generated id case)', () => {
    const id = save('projects', { id: 'form-made-id', name: 'A' });
    expect(id).toBe('form-made-id');
    expect(first('SELECT version FROM projects WHERE id = ?', ['form-made-id'])).toEqual({ version: 1 });
    expect(audit('row_id = ?', [id]).map((a) => a.action)).toEqual(['insert']);
  });

  it('refuses a table that is not business data', () => {
    expect(() => save('audit_log' as never, { x: 1 })).toThrow('Unknown table audit_log');
    expect(() => save('settings' as never, { key: 'a' })).toThrow('Unknown table settings');
    expect(() => remove('audit_log' as never, '1')).toThrow('Unknown table');
  });

  it('a refused write leaves no row, no audit entry, and is written to the error log', () => {
    const p = saveProject({ name: 'P' });
    const mute = silenceConsoleError();
    const n = auditCount();
    expect(() => save('expenses', { project_id: p, day: '2026-10-20', category: 'fuel', amount_cents: 0, method: 'cash' })).toThrow(/constraint/i);
    mute.mockRestore();
    expect(auditCount()).toBe(n);
    expect(first('SELECT COUNT(*) AS n FROM expenses')).toEqual({ n: 0 });
    expect(readErrorLog()).toContain('db.save');
  });

  it('a failed update changes neither the row nor its version', () => {
    const p = saveProject({ name: 'P' });
    const e = saveExpense({ project_id: p, day: '2026-10-20', category: 'fuel', amount_cents: 1000, method: 'cash' });
    const before = first('SELECT * FROM expenses WHERE id = ?', [e]);
    const n = auditCount();
    const mute = silenceConsoleError();
    expect(() => save('expenses', { id: e, amount_cents: -5 })).toThrow(/constraint/i);
    mute.mockRestore();
    expect(first('SELECT * FROM expenses WHERE id = ?', [e])).toEqual(before);
    expect(auditCount()).toBe(n);
  });
});

describe('remove()', () => {
  it('soft-deletes: deleted_at = updated_at = now, version + 1, a delete audit entry; the row stays', () => {
    const id = saveProject({ name: 'P' });
    clock.tick(5_000);
    remove('projects', id);
    const now = new Date(Date.parse(T0) + 5_000).toISOString();
    expect(first('SELECT name, version, deleted_at, updated_at, created_at FROM projects WHERE id = ?', [id])).toEqual({ name: 'P', version: 2, deleted_at: now, updated_at: now, created_at: T0 });
    const log = audit('row_id = ?', [id]);
    expect(log.map((a) => a.action)).toEqual(['insert', 'delete']);
    expect(JSON.parse(log[1].data ?? 'null')).toBeNull(); // a delete carries no values
  });

  it('removing something already removed, or something that never existed, writes nothing', () => {
    const id = saveProject({ name: 'P' });
    remove('projects', id);
    const row = first('SELECT * FROM projects WHERE id = ?', [id]);
    const n = auditCount();
    clock.tick(5_000);
    remove('projects', id);
    remove('projects', 'never-existed');
    expect(first('SELECT * FROM projects WHERE id = ?', [id])).toEqual(row);
    expect(auditCount()).toBe(n);
  });
});

describe('every domain write is audited', () => {
  it('each repo function records the right table, action and row, with this device and time', async () => {
    const steps: { name: string; run: () => string; table: string; action: string }[] = [];
    let project = '';
    let worker = '';
    let tool = '';
    let expenseId = '';
    const step = (name: string, table: string, action: string, run: () => string) => steps.push({ name, table, action, run });

    step('saveProject', 'projects', 'insert', () => (project = saveProject({ name: 'Welimada school' })));
    step('saveProject (edit)', 'projects', 'update', () => saveProject({ id: project, name: 'Welimada school 2' }));
    step('saveWorker', 'workers', 'insert', () => (worker = saveWorker({ name: 'Nimal', daily_rate_cents: 350_000 })));
    step('saveTool', 'tools', 'insert', () => (tool = saveTool({ name: 'Drill' })));
    step('assignWorker', 'project_workers', 'insert', () => assignWorker({ project_id: project, worker_id: worker, rate_cents: 350_000 }));
    step('assignWorker (again)', 'project_workers', 'update', () => assignWorker({ project_id: project, worker_id: worker, rate_cents: 360_000 }));
    step('saveExpense', 'expenses', 'insert', () => (expenseId = saveExpense({ project_id: project, day: '2026-10-20', category: 'fuel', amount_cents: 12_000, method: 'cash' })));
    step('saveExpense (edit)', 'expenses', 'update', () => saveExpense({ id: expenseId, project_id: project, day: '2026-10-20', category: 'fuel', amount_cents: 13_000, method: 'cash' }));
    step('saveNote', 'site_notes', 'insert', () => saveNote({ project_id: project, day: '2026-10-20', body: 'Rain' }));
    step('recordWorkDay', 'wage_entries', 'insert', () => recordWorkDay({ project_id: project, worker_id: worker, day: '2026-10-20', days: 1 }));
    step('recordWorkDay (again)', 'wage_entries', 'update', () => recordWorkDay({ project_id: project, worker_id: worker, day: '2026-10-20', days: 2 }));
    step('payWages', 'wage_entries', 'insert', () => payWages({ project_id: project, worker_id: worker, day: '2026-10-20', amount_cents: 100_000 }));
    step('saveWageEntry (advance)', 'wage_entries', 'insert', () => saveWageEntry({ worker_id: worker, project_id: project, day: '2026-10-20', kind: 'advance', amount_cents: 5_000 }));
    step('moveTool', 'tool_movements', 'insert', () => moveTool({ tool_id: tool, kind: 'issue', worker_id: worker, day: '2026-10-20' }));

    for (const s of steps) {
      clock.tick(1_000);
      const before = auditCount();
      const id = s.run();
      const added = audit().slice(before);
      expect({ step: s.name, entries: added.length, table: added[0]?.table_name, action: added[0]?.action, row: added[0]?.row_id, device: added[0]?.device_id, at: added[0]?.at }).toEqual({
        step: s.name,
        entries: 1,
        table: s.table,
        action: s.action,
        row: id,
        device: deviceId(),
        at: new Date(Date.now()).toISOString(),
      });
    }

    // a photo, then the deletions
    queuePhotos(1);
    const before = auditCount();
    await addPhotos('expenses', expenseId, 'gallery');
    const photoEntries = audit().slice(before);
    expect(photoEntries.map((a) => [a.table_name, a.action])).toEqual([['attachments', 'insert']]);

    clock.tick(1_000);
    for (const run of [() => removeWorkDay(project, worker, '2026-10-20'), () => unassignWorker(project, worker), () => deleteRecord('expenses', expenseId)]) {
      const n = auditCount();
      run();
      expect(auditCount()).toBeGreaterThan(n);
      expect(audit().slice(n).every((a) => a.action === 'delete')).toBe(true);
    }
  });
});

describe('version bookkeeping across a whole working history', () => {
  it('every row has version = its number of audit entries, in every table', async () => {
    seedDemo();
    // a month of normal use: edits, corrections, deletes, re-assigning, repeated taps
    const school = first<{ id: string }>("SELECT id FROM projects WHERE name LIKE 'Welimada%'")?.id as string;
    const nimal = first<{ id: string }>("SELECT id FROM workers WHERE name LIKE 'Nimal%'")?.id as string;
    const expenseId = first<{ id: string }>('SELECT id FROM expenses WHERE project_id = ? ORDER BY day LIMIT 1', [school])?.id as string;
    clock.tick(60_000);
    saveProject({ id: school, name: 'Welimada Primary School Building' });
    saveProject({ id: school, name: 'Welimada Primary School', notes: 'renamed' });
    saveExpense({ id: expenseId, project_id: school, day: '2026-10-20', category: 'fuel', amount_cents: 1, method: 'bank' });
    recordWorkDay({ project_id: school, worker_id: nimal, day: '2026-10-01', days: 1 });
    recordWorkDay({ project_id: school, worker_id: nimal, day: '2026-10-01', days: 2 });
    removeWorkDay(school, nimal, '2026-10-01');
    unassignWorker(school, nimal);
    assignWorker({ project_id: school, worker_id: nimal, rate_cents: 400_000 });
    deleteRecord('expenses', expenseId);
    deleteRecord('expenses', expenseId);
    queuePhotos(2);
    await addPhotos('projects', school, 'gallery');
    deleteRecord('projects', school);

    for (const t of DATA_TABLES) {
      const bad = all(
        `SELECT t.id, t.version, (SELECT COUNT(*) FROM audit_log a WHERE a.table_name = ? AND a.row_id = t.id) AS audited
         FROM ${t} t WHERE t.version != (SELECT COUNT(*) FROM audit_log a WHERE a.table_name = ? AND a.row_id = t.id)`,
        [t, t],
      );
      expect({ table: t, mismatches: bad }).toEqual({ table: t, mismatches: [] });
    }
  });

  it('the audit log only grows: sequence numbers never repeat or go back, and nothing in it is altered', () => {
    const snapshots: AuditRow[][] = [];
    const p = saveProject({ name: 'P' });
    snapshots.push(audit());
    saveProject({ id: p, name: 'P2' });
    snapshots.push(audit());
    deleteRecord('projects', p);
    snapshots.push(audit());
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i].slice(0, snapshots[i - 1].length)).toEqual(snapshots[i - 1]); // earlier entries unchanged
      expect(snapshots[i].length).toBeGreaterThan(snapshots[i - 1].length);
    }
    const seqs = audit().map((a) => a.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('the device id is created once, stored, stable across restarts and written into every row and entry', () => {
    const id = deviceId();
    expect(getSetting('device_id')).toBe(id);
    saveProject({ name: 'P' });
    closeDb();
    expect(deviceId()).toBe(id);
    saveWorker({ name: 'W', daily_rate_cents: 0 });
    expect(all('SELECT DISTINCT device_id FROM projects UNION SELECT DISTINCT device_id FROM workers UNION SELECT DISTINCT device_id FROM audit_log')).toEqual([{ device_id: id }]);
  });

  it('settings are plain key/value and survive a restart; they are not versioned business data', () => {
    setSetting('lang', 'si');
    setSetting('lang', 'ta');
    setSetting('current_project', null);
    closeDb();
    expect(getSetting('lang')).toBe('ta');
    expect(getSetting('current_project')).toBeNull();
    expect(audit("table_name = 'settings'")).toEqual([]);
  });
});
