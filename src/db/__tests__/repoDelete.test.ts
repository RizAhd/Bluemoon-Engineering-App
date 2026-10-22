/**
 * Deleting is always soft: rows get deleted_at, nothing is removed, photos stay on disk.
 * Deleting a project takes everything that belongs to it with it, and nothing of any other project.
 */
import { all, first, getDb, newId } from '@/db';
import {
  assignWorker,
  deleteRecord,
  moveTool,
  payWages,
  recordWorkDay,
  saveExpense,
  saveNote,
  saveProject,
  saveTool,
  saveWageEntry,
  saveWorker,
} from '@/db/repo';
import { DATA_TABLES } from '@/db/schema';
import { addFile, addPhotos, attachmentsDir } from '@/lib/files';
import { File, Paths, queuePhotos, resetDb, silenceConsoleError } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

const D = '2026-10-20';

let clock: ReturnType<typeof useClock>;
// ids
let p1: string;
let p2: string;
let nimal: string;
let sunil: string;
let drill: string;
const ids: Record<string, string[]> = {};

beforeEach(async () => {
  resetDb();
  clock = useClock('2026-10-20T04:00:00.000Z');
  await build();
});

afterEach(() => clock.restore());

async function photo(table: string, id: string, n = 1) {
  queuePhotos(n);
  await addPhotos(table, id, 'gallery');
}

/** Two projects with one of everything on each, a worker on both, a tool used on both. */
async function build() {
  p1 = saveProject({ name: 'Welimada school', contract_cents: 1_000_000_00 });
  p2 = saveProject({ name: 'Badulla culvert' });
  nimal = saveWorker({ name: 'Nimal', daily_rate_cents: 350_000 });
  sunil = saveWorker({ name: 'Sunil', daily_rate_cents: 380_000 });
  drill = saveTool({ name: 'Drill' });
  assignWorker({ project_id: p1, worker_id: nimal, rate_cents: 350_000 });
  assignWorker({ project_id: p1, worker_id: sunil, rate_cents: 380_000 });
  assignWorker({ project_id: p2, worker_id: nimal, rate_cents: 360_000 });

  const exp = (project: string, cents: number) =>
    saveExpense({ project_id: project, day: D, category: 'materials', amount_cents: cents, method: 'cash' });
  ids.e1 = [exp(p1, 100_000), exp(p1, 250_000)];
  ids.e2 = [exp(p2, 70_000)];
  ids.n1 = [saveNote({ project_id: p1, day: D, body: 'Slab poured' }), saveNote({ project_id: p1, day: D, body: 'Rain' })];
  ids.n2 = [saveNote({ project_id: p2, day: D, body: 'Pipes out' })];
  ids.w1 = [
    recordWorkDay({ project_id: p1, worker_id: nimal, day: D, days: 1 }),
    recordWorkDay({ project_id: p1, worker_id: sunil, day: D, days: 1 }),
    payWages({ project_id: p1, worker_id: nimal, day: D, amount_cents: 200_000 }),
    saveWageEntry({ worker_id: sunil, project_id: p1, day: D, kind: 'advance', amount_cents: 50_000 }),
  ];
  ids.w2 = [recordWorkDay({ project_id: p2, worker_id: nimal, day: D, days: 2 })];
  ids.m1 = [moveTool({ tool_id: drill, kind: 'issue', project_id: p1, worker_id: nimal, day: D })];
  clock.tick(1_000);
  ids.m2 = [moveTool({ tool_id: drill, kind: 'return', project_id: p2, worker_id: nimal, day: '2026-10-21' })];

  await photo('projects', p1, 2);
  await addFile('projects', p1, fakePdf(), 'application/pdf');
  await photo('expenses', ids.e1[0]);
  await photo('site_notes', ids.n1[0]);
  await photo('tool_movements', ids.m1[0]);
  await photo('projects', p2);
  await photo('expenses', ids.e2[0]);
  await photo('tools', drill);
  clock.tick(1_000);
}

function fakePdf(): string {
  const f = new File(Paths.cache, `scan-${newId()}.pdf`);
  f.create();
  f.writeSync('%PDF-1.4 a signed quotation');
  return f.uri;
}

const total = (t: string) => first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0;
const liveOf = (t: string, where = '1=1', params: string[] = []) =>
  first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE deleted_at IS NULL AND ${where}`, params)?.n ?? 0;
const allTotals = () => Object.fromEntries(DATA_TABLES.map((t) => [t, total(t)]));
const files = () => attachmentsDir().list().map((f) => f.name).sort();

/** Live attachments owned by any record of the given table / ids. */
const livePhotos = (table: string, owners: string[]) =>
  owners.reduce((n, id) => n + (first<{ n: number }>('SELECT COUNT(*) AS n FROM attachments WHERE owner_table = ? AND owner_id = ? AND deleted_at IS NULL', [table, id])?.n ?? 0), 0);

describe('deleting a project', () => {
  it('builds the scenario the tests rely on', () => {
    expect(livePhotos('projects', [p1])).toBe(3); // two photos and a pdf
    expect(livePhotos('expenses', ids.e1)).toBe(1);
    expect(liveOf('wage_entries', 'project_id = ?', [p1])).toBe(4);
    expect(liveOf('project_workers', 'project_id = ?', [p1])).toBe(2);
  });

  it('soft-deletes the project and everything on it: expenses, notes, wages, tool movements, assignments', () => {
    deleteRecord('projects', p1);
    expect(liveOf('projects', 'id = ?', [p1])).toBe(0);
    for (const t of ['expenses', 'site_notes', 'wage_entries', 'tool_movements', 'project_workers']) {
      expect({ table: t, live: liveOf(t, 'project_id = ?', [p1]) }).toEqual({ table: t, live: 0 });
      expect({ table: t, deleted: total(t) - liveOf(t) }).toEqual({ table: t, deleted: first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE project_id = ?`, [p1])?.n });
    }
  });

  it('soft-deletes every photo and pdf belonging to the project and to the records on it', () => {
    deleteRecord('projects', p1);
    expect(livePhotos('projects', [p1])).toBe(0);
    expect(livePhotos('expenses', ids.e1)).toBe(0);
    expect(livePhotos('site_notes', ids.n1)).toBe(0);
    expect(livePhotos('tool_movements', ids.m1)).toBe(0);
  });

  it('touches nothing of any other project, nor the shared workers and tools', () => {
    const before = {
      p2: first('SELECT * FROM projects WHERE id = ?', [p2]),
      e2: all('SELECT * FROM expenses WHERE project_id = ? ORDER BY id', [p2]),
      n2: all('SELECT * FROM site_notes WHERE project_id = ? ORDER BY id', [p2]),
      w2: all('SELECT * FROM wage_entries WHERE project_id = ? ORDER BY id', [p2]),
      m2: all('SELECT * FROM tool_movements WHERE project_id = ? ORDER BY id', [p2]),
      pw2: all('SELECT * FROM project_workers WHERE project_id = ? ORDER BY id', [p2]),
      workers: all('SELECT * FROM workers ORDER BY id'),
      tools: all('SELECT * FROM tools ORDER BY id'),
      photos2: all("SELECT * FROM attachments WHERE (owner_table = 'projects' AND owner_id = ?) OR (owner_table = 'expenses' AND owner_id = ?) OR (owner_table = 'tools') ORDER BY id", [p2, ids.e2[0]]),
    };
    expect(before.photos2).toHaveLength(3);

    deleteRecord('projects', p1);

    expect(first('SELECT * FROM projects WHERE id = ?', [p2])).toEqual(before.p2);
    expect(all('SELECT * FROM expenses WHERE project_id = ? ORDER BY id', [p2])).toEqual(before.e2);
    expect(all('SELECT * FROM site_notes WHERE project_id = ? ORDER BY id', [p2])).toEqual(before.n2);
    expect(all('SELECT * FROM wage_entries WHERE project_id = ? ORDER BY id', [p2])).toEqual(before.w2);
    expect(all('SELECT * FROM tool_movements WHERE project_id = ? ORDER BY id', [p2])).toEqual(before.m2);
    expect(all('SELECT * FROM project_workers WHERE project_id = ? ORDER BY id', [p2])).toEqual(before.pw2);
    expect(all('SELECT * FROM workers ORDER BY id')).toEqual(before.workers);
    expect(all('SELECT * FROM tools ORDER BY id')).toEqual(before.tools);
    expect(
      all("SELECT * FROM attachments WHERE (owner_table = 'projects' AND owner_id = ?) OR (owner_table = 'expenses' AND owner_id = ?) OR (owner_table = 'tools') ORDER BY id", [p2, ids.e2[0]]),
    ).toEqual(before.photos2);
  });

  it('removes no row at all and no file from the phone', () => {
    const rows = allTotals();
    const names = files();
    expect(names.length).toBe(9);
    deleteRecord('projects', p1);
    expect(allTotals()).toEqual(rows);
    expect(files()).toEqual(names);
  });

  it('the totals now cover only what is left', () => {
    deleteRecord('projects', p1);
    expect(all('SELECT project_id, expense_cents, labour_cents FROM v_project_cost')).toEqual([{ project_id: p2, expense_cents: 70_000, labour_cents: 720_000 }]);
    // Nimal's balance is only what he earned on the culvert now; Sunil has nothing left
    expect(first('SELECT earned_cents, paid_cents, balance_cents FROM v_worker_balance WHERE worker_id = ?', [nimal])).toEqual({ earned_cents: 720_000, paid_cents: 0, balance_cents: 720_000 });
    expect(first('SELECT earned_cents, advance_cents, balance_cents FROM v_worker_balance WHERE worker_id = ?', [sunil])).toEqual({ earned_cents: 0, advance_cents: 0, balance_cents: 0 });
    expect(all('SELECT project_id FROM v_project_worker_balance GROUP BY project_id')).toEqual([{ project_id: p2 }]);
  });

  it('bumps the version of each deleted row by exactly one and stamps one deleted_at on all of them', () => {
    const before = new Map(all<{ id: string; version: number }>('SELECT id, version FROM expenses WHERE project_id = ?', [p1]).map((r) => [r.id, r.version]));
    deleteRecord('projects', p1);
    const after = all<{ id: string; version: number; deleted_at: string; updated_at: string }>('SELECT id, version, deleted_at, updated_at FROM expenses WHERE project_id = ?', [p1]);
    expect(after).toHaveLength(2);
    for (const r of after) {
      expect(r.version).toBe((before.get(r.id) ?? 0) + 1);
      expect(r.deleted_at).toBe(r.updated_at);
    }
    expect(first('SELECT version FROM projects WHERE id = ?', [p1])).toEqual({ version: 2 });
  });

  it('writes exactly one audit entry per row it soft-deleted', () => {
    const seq = first<{ s: number }>('SELECT MAX(seq) AS s FROM audit_log')?.s ?? 0;
    const live = Object.fromEntries(['projects', 'expenses', 'site_notes', 'wage_entries', 'tool_movements', 'project_workers', 'attachments'].map((t) => [t, liveOf(t)]));
    deleteRecord('projects', p1);
    const entries = all<{ table_name: string; row_id: string; action: string }>('SELECT table_name, row_id, action FROM audit_log WHERE seq > ?', [seq]);
    expect(entries.every((e) => e.action === 'delete')).toBe(true);
    expect(new Set(entries.map((e) => `${e.table_name}:${e.row_id}`)).size).toBe(entries.length); // none twice
    const deletedNow = Object.fromEntries(Object.keys(live).map((t) => [t, live[t] - liveOf(t)]));
    for (const [t, n] of Object.entries(deletedNow)) expect({ t, audit: entries.filter((e) => e.table_name === t).length }).toEqual({ t, audit: n });
    expect(deletedNow).toEqual({ projects: 1, expenses: 2, site_notes: 2, wage_entries: 4, tool_movements: 1, project_workers: 2, attachments: 6 });
  });

  it('leaves alone what was already deleted before: its deleted_at and version do not change', () => {
    deleteRecord('expenses', ids.e1[1]);
    const earlier = first<{ deleted_at: string; version: number }>('SELECT deleted_at, version FROM expenses WHERE id = ?', [ids.e1[1]]);
    clock.tick(60_000);
    deleteRecord('projects', p1);
    expect(first('SELECT deleted_at, version FROM expenses WHERE id = ?', [ids.e1[1]])).toEqual(earlier);
  });

  it('is all or nothing: if one step fails, nothing is deleted', () => {
    const mute = silenceConsoleError();
    getDb().execSync("CREATE TRIGGER fail_notes BEFORE UPDATE OF deleted_at ON site_notes BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END;");
    const rows = allTotals();
    const liveBefore = Object.fromEntries(DATA_TABLES.map((t) => [t, liveOf(t)]));
    const auditBefore = total('audit_log');

    expect(() => deleteRecord('projects', p1)).toThrow(/disk I\/O error/);

    expect(allTotals()).toEqual(rows);
    expect(Object.fromEntries(DATA_TABLES.map((t) => [t, liveOf(t)]))).toEqual(liveBefore);
    expect(total('audit_log')).toBe(auditBefore);
    getDb().execSync('DROP TRIGGER fail_notes');
    mute.mockRestore();

    deleteRecord('projects', p1); // and it works once the problem is gone
    expect(liveOf('projects', 'id = ?', [p1])).toBe(0);
  });

  it('deleting the project twice changes nothing the second time', () => {
    deleteRecord('projects', p1);
    const snapshot = all('SELECT * FROM projects ORDER BY id');
    const audit = total('audit_log');
    clock.tick(60_000);
    deleteRecord('projects', p1);
    expect(all('SELECT * FROM projects ORDER BY id')).toEqual(snapshot);
    expect(total('audit_log')).toBe(audit);
  });
});

describe('deleting a single record', () => {
  it('an expense: the expense and its photos go, the project total drops by its amount, the rest stays', () => {
    const [e, keep] = ids.e1;
    deleteRecord('expenses', e);
    expect(liveOf('expenses', 'project_id = ?', [p1])).toBe(1);
    expect(livePhotos('expenses', [e])).toBe(0);
    expect(first('SELECT expense_cents FROM v_project_cost WHERE project_id = ?', [p1])).toEqual({ expense_cents: 250_000 });
    expect(first('SELECT deleted_at FROM expenses WHERE id = ?', [keep])).toEqual({ deleted_at: null });
    expect(files().length).toBe(9); // the file itself is kept
  });

  it('a note and its photos', () => {
    deleteRecord('site_notes', ids.n1[0]);
    expect(liveOf('site_notes', 'project_id = ?', [p1])).toBe(1);
    expect(livePhotos('site_notes', ids.n1)).toBe(0);
  });

  it('a wage entry: the worker balance follows, other entries stay', () => {
    deleteRecord('wage_entries', ids.w1[2]); // the 200,000 payment to Nimal
    expect(first('SELECT paid_cents, balance_cents FROM v_worker_balance WHERE worker_id = ?', [nimal])).toEqual({ paid_cents: 0, balance_cents: 350_000 + 720_000 });
    expect(liveOf('wage_entries', 'project_id = ?', [p1])).toBe(3);
  });

  it('a worker: hidden from the lists, but the wages already paid still count in the project cost', () => {
    const labour = first('SELECT labour_cents, labour_paid_cents FROM v_project_cost WHERE project_id = ?', [p1]);
    deleteRecord('workers', sunil);
    expect(all('SELECT worker_id FROM v_worker_balance WHERE worker_id = ?', [sunil])).toEqual([]);
    expect(all('SELECT worker_id FROM v_project_worker_balance WHERE worker_id = ?', [sunil])).toEqual([]);
    expect(first('SELECT labour_cents, labour_paid_cents FROM v_project_cost WHERE project_id = ?', [p1])).toEqual(labour);
    expect(first('SELECT COUNT(*) AS n FROM wage_entries WHERE worker_id = ?', [sunil])).toEqual({ n: 2 });
  });

  it('an assignment: the worker leaves the project list, history stays', () => {
    const pw = first<{ id: string }>('SELECT id FROM project_workers WHERE project_id = ? AND worker_id = ?', [p1, sunil])?.id as string;
    deleteRecord('project_workers', pw);
    expect(all('SELECT worker_id FROM v_project_worker_balance WHERE project_id = ?', [p1]).map((r) => (r as { worker_id: string }).worker_id)).toEqual([nimal]);
    expect(liveOf('wage_entries', 'worker_id = ? AND project_id = ?', [sunil, p1])).toBe(2);
  });

  it('deleting the same record twice does not rewrite its history', () => {
    const e = ids.e1[1];
    deleteRecord('expenses', e);
    const row = first('SELECT * FROM expenses WHERE id = ?', [e]);
    const audit = total('audit_log');
    clock.tick(60_000);
    deleteRecord('expenses', e);
    expect(first('SELECT * FROM expenses WHERE id = ?', [e])).toEqual(row);
    expect(total('audit_log')).toBe(audit);
  });

  it('deleting an id that does not exist writes nothing', () => {
    const audit = total('audit_log');
    deleteRecord('expenses', 'not-a-real-id');
    expect(total('audit_log')).toBe(audit);
  });
});
