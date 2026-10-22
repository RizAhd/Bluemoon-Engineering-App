/**
 * Hand-off between two phones: collect a project on one, apply it on the other.
 * Counts, idempotency, newest-version-wins, deletions, ordering of parents and children.
 */
import { DATA_TABLES, type DataTable } from '@/db/schema';
import type { Attachment, ToolStatus } from '@/db/types';
import { addDays } from '@/lib/dates';
import { addPhotos } from '@/lib/files';
import { mainPhone, openSecondPhone, queuePhotos, resetDb, seedDemo, silenceConsoleError, transfer, type Phone } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(120_000);

const SCHOOL = 'Welimada Primary School Building';
const CULVERT = 'Badulla Culvert Repair';

let a: Phone; // the main phone, the sender
let b: Phone;
let clock: ReturnType<typeof useClock>;

beforeAll(() => {
  b = openSecondPhone();
});
afterAll(() => b.dispose());
beforeEach(() => {
  resetDb();
  b.resetDb();
  a = mainPhone();
  clock = useClock(new Date(2026, 9, 22, 12, 0, 0));
});
afterEach(() => clock.restore());

const idOf = (phone: Phone, name: string) => phone.db.first<{ id: string }>('SELECT id FROM projects WHERE name = ?', [name])?.id as string;

function dump(phone: Phone): Record<string, unknown[]> {
  return Object.fromEntries(DATA_TABLES.map((t) => [t, phone.db.all(`SELECT * FROM ${t} ORDER BY id`)]));
}
/** The rows of `from` that `of` also has: what the two phones have in common must be identical. */
function sharedRows(from: Phone, of: Phone): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const t of DATA_TABLES) {
    const ids = new Set(of.db.all<{ id: string }>(`SELECT id FROM ${t}`).map((r) => r.id));
    out[t] = from.db.all<{ id: string }>(`SELECT * FROM ${t} ORDER BY id`).filter((r) => ids.has(r.id));
  }
  return out;
}
const count = (phone: Phone, table: string, where = '1=1', params: string[] = []) =>
  phone.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params)?.n ?? 0;

describe('handing one project over', () => {
  it('inserts the project and everything it refers to, and reports the counts per table', async () => {
    seedDemo();
    const school = idOf(a, SCHOOL);

    const plan = await transfer(a, b, { projectId: school });

    expect(plan.badFiles).toEqual([]);
    expect(plan.counts).toEqual({ inserted: 50, updated: 0, skipped: 0 });
    expect(Object.fromEntries(Object.entries(plan.perTable).map(([t, c]) => [t, c.inserted]))).toEqual({
      projects: 1,
      workers: 5, // the five who worked or were assigned; Saman works on another project
      tools: 3, // drill, mixer, ladder
      project_workers: 5,
      expenses: 9,
      wage_entries: 21, // 18 days of work + 2 payments + 1 advance
      tool_movements: 4,
      site_notes: 2,
    });
    // what B now has is exactly the school's rows, and nothing of the culvert
    expect(b.db.all('SELECT name FROM projects')).toEqual([{ name: SCHOOL }]);
    expect(count(b, 'workers')).toBe(5);
    expect(b.db.all("SELECT name FROM workers WHERE name = 'Saman Kumara'")).toEqual([]);
  });

  it('the other phone then shows the same money', async () => {
    seedDemo();
    const school = idOf(a, SCHOOL);
    await transfer(a, b, { projectId: school });

    const same = (sql: string) => {
      const onB = b.db.all(sql, [school]);
      expect(onB.length).toBeGreaterThan(0);
      expect(onB).toEqual(a.db.all(sql, [school]));
    };
    same('SELECT * FROM v_project_cost WHERE project_id = ?');
    same('SELECT * FROM v_project_worker_balance WHERE project_id = ? ORDER BY worker_id');
    same('SELECT * FROM v_wage_day WHERE project_id = ? ORDER BY worker_id, day');
    same('SELECT * FROM v_worker_balance WHERE worker_id IN (SELECT worker_id FROM project_workers WHERE project_id = ?) ORDER BY worker_id');
    same('SELECT * FROM v_tool_status WHERE tool_id IN (SELECT tool_id FROM tool_movements WHERE project_id = ?) ORDER BY tool_id');
  });

  it('rows arrive byte for byte: ids, versions, timestamps and the sender\'s device id are kept', async () => {
    seedDemo();
    const school = idOf(a, SCHOOL);
    await transfer(a, b, { projectId: school });
    const onA = dump(a);
    const onB = dump(b);
    for (const t of ['projects', 'expenses', 'site_notes', 'project_workers', 'wage_entries', 'tool_movements', 'tools', 'workers'] as DataTable[]) {
      const ids = new Set((onB[t] as { id: string }[]).map((r) => r.id));
      expect({ table: t, rows: (onA[t] as { id: string }[]).filter((r) => ids.has(r.id)) }).toEqual({ table: t, rows: onB[t] });
    }
    expect(b.db.deviceId()).not.toBe(a.db.deviceId());
    expect(b.db.all('SELECT DISTINCT device_id FROM expenses')).toEqual([{ device_id: a.db.deviceId() }]);
  });

  it('is recorded in the other phone\'s audit log as an import', async () => {
    seedDemo();
    await transfer(a, b, { projectId: idOf(a, SCHOOL) });
    expect(b.db.all('SELECT action, COUNT(*) AS n FROM audit_log GROUP BY action')).toEqual([{ action: 'import-insert', n: 50 }]);
    expect(b.db.all("SELECT device_id FROM audit_log GROUP BY device_id")).toEqual([{ device_id: b.db.deviceId() }]);
  });

  it('planImport tells the same story before anything is written', async () => {
    seedDemo();
    const tables = a.bundle.collectProject(idOf(a, SCHOOL));
    const preview = b.bundle.planImport(JSON.parse(JSON.stringify(tables)));
    expect(count(b, 'projects')).toBe(0);
    expect(preview.counts).toEqual({ inserted: 50, updated: 0, skipped: 0 });
    const plan = await transfer(a, b, { projectId: idOf(a, SCHOOL) });
    expect(plan.counts).toEqual(preview.counts);
  });

  it('merges into a phone that already has its own projects without touching them', async () => {
    seedDemo();
    const mine = b.repo.saveProject({ name: 'Only on B' });
    b.repo.saveExpense({ project_id: mine, day: '2026-10-20', category: 'fuel', amount_cents: 5_000, method: 'cash' });
    const before = b.db.all('SELECT * FROM projects WHERE id = ?', [mine]);
    await transfer(a, b, { projectId: idOf(a, CULVERT) });
    expect(b.db.all('SELECT name FROM projects ORDER BY name')).toEqual([{ name: CULVERT }, { name: 'Only on B' }]);
    expect(b.db.all('SELECT * FROM projects WHERE id = ?', [mine])).toEqual(before);
    expect(b.db.first('SELECT expense_cents FROM v_project_cost WHERE project_id = ?', [mine])).toEqual({ expense_cents: 5_000 });
  });

  it('the culvert is 13 rows: the project, 2 workers, 2 assignments, 3 expenses, 4 wages, 1 note', async () => {
    seedDemo();
    const plan = await transfer(a, b, { projectId: idOf(a, CULVERT) });
    expect(plan.counts.inserted).toBe(13);
    expect(count(b, 'tools')).toBe(0);
  });
});

describe('handing it over again', () => {
  it('changes nothing: every row is reported as skipped and nothing is written', async () => {
    seedDemo();
    const school = idOf(a, SCHOOL);
    await transfer(a, b, { projectId: school });
    const state = dump(b);
    const audit = count(b, 'audit_log');

    const again = await transfer(a, b, { projectId: school });

    expect(again.counts).toEqual({ inserted: 0, updated: 0, skipped: 50 });
    expect(dump(b)).toEqual(state);
    expect(count(b, 'audit_log')).toBe(audit);
  });

  it('a whole-phone transfer twice is also a no-op the second time', async () => {
    seedDemo();
    const first = await transfer(a, b);
    expect(first.counts.inserted).toBe(65); // 3 projects, 6 workers, 5 tools, 7 assignments, 12 expenses, 25 wages, 4 movements, 3 notes
    const state = dump(b);
    const second = await transfer(a, b);
    expect(second.counts.inserted + second.counts.updated).toBe(0);
    expect(second.counts.skipped).toBe(first.counts.inserted);
    expect(dump(b)).toEqual(state);
    expect(dump(b)).toEqual(dump(a));
  });
});

describe('newer versions win', () => {
  let school: string;
  let expenseId: string;
  let oldCents: number;
  beforeEach(async () => {
    seedDemo();
    school = idOf(a, SCHOOL);
    await transfer(a, b, { projectId: school });
    expenseId = a.db.first<{ id: string }>('SELECT id FROM expenses WHERE project_id = ? ORDER BY day, id LIMIT 1', [school])?.id as string;
    oldCents = a.db.first<{ amount_cents: number }>('SELECT amount_cents FROM expenses WHERE id = ?', [expenseId])?.amount_cents as number;
    clock.tick(60_000);
  });

  const amount = (phone: Phone) => phone.db.first<{ amount_cents: number; version: number }>('SELECT amount_cents, version FROM expenses WHERE id = ?', [expenseId]);
  const edit = (phone: Phone, cents: number) =>
    phone.repo.saveExpense({ id: expenseId, project_id: school, day: '2026-10-01', category: 'materials', amount_cents: cents, method: 'bank' });

  it('an edit made on the sender reaches the other phone as one updated row', async () => {
    edit(a, 777_700);
    const plan = await transfer(a, b, { projectId: school });
    expect(plan.counts).toEqual({ inserted: 0, updated: 1, skipped: 49 });
    expect(plan.perTable.expenses).toEqual({ inserted: 0, updated: 1, skipped: 8 });
    expect(amount(b)).toEqual({ amount_cents: 777_700, version: 2 });
    expect(b.db.first('SELECT expense_cents FROM v_project_cost WHERE project_id = ?', [school])).toEqual({ expense_cents: 49_555_000 - oldCents + 777_700 });
  });

  it('an older copy never overwrites a newer one', async () => {
    edit(b, 123_400); // B edited it (version 2); A still has version 1
    const plan = await transfer(a, b, { projectId: school });
    expect(plan.counts).toEqual({ inserted: 0, updated: 0, skipped: 50 });
    expect(amount(b)).toEqual({ amount_cents: 123_400, version: 2 });
  });

  it('the row with more edits wins, whichever way it travels', async () => {
    edit(a, 111_100);
    clock.tick(1_000);
    edit(a, 222_200); // version 3 on A
    clock.tick(1_000);
    edit(b, 999_900); // version 2 on B, and later in time
    await transfer(a, b, { projectId: school });
    expect(amount(b)).toEqual({ amount_cents: 222_200, version: 3 });
    await transfer(b, a, { projectId: school });
    expect(amount(a)).toEqual({ amount_cents: 222_200, version: 3 });
  });

  it('the same version edited on both phones: the later edit wins on both, and they end identical', async () => {
    edit(a, 111_100); // version 2 at t+0
    clock.tick(5_000);
    edit(b, 222_200); // version 2 at t+5s: later
    await transfer(a, b, { projectId: school });
    await transfer(b, a, { projectId: school });
    expect(amount(a)).toEqual({ amount_cents: 222_200, version: 2 });
    expect(amount(b)).toEqual({ amount_cents: 222_200, version: 2 });
    expect(sharedRows(a, b)).toEqual(dump(b));
  });

  it('edits to different rows on the two phones all survive the exchange', async () => {
    const [e1, e2] = a.db.all<{ id: string }>('SELECT id FROM expenses WHERE project_id = ? ORDER BY day, id LIMIT 2', [school]).map((r) => r.id);
    a.repo.saveExpense({ id: e1, project_id: school, day: '2026-10-01', category: 'materials', amount_cents: 10_100, method: 'cash' });
    b.repo.saveExpense({ id: e2, project_id: school, day: '2026-10-01', category: 'food', amount_cents: 20_200, method: 'cash' });
    b.repo.saveNote({ project_id: school, day: '2026-10-23', body: 'Added on B' });
    a.repo.saveNote({ project_id: school, day: '2026-10-23', body: 'Added on A' });
    await transfer(a, b, { projectId: school });
    await transfer(b, a, { projectId: school });
    for (const phone of [a, b]) {
      expect(phone.db.first('SELECT amount_cents FROM expenses WHERE id = ?', [e1])).toEqual({ amount_cents: 10_100 });
      expect(phone.db.first('SELECT amount_cents FROM expenses WHERE id = ?', [e2])).toEqual({ amount_cents: 20_200 });
      expect(phone.db.all('SELECT body FROM site_notes WHERE project_id = ? AND day = ? ORDER BY body', [school, '2026-10-23'])).toEqual([{ body: 'Added on A' }, { body: 'Added on B' }]);
    }
    expect(sharedRows(a, b)).toEqual(dump(b));
  });

  it('a new row added on the sender arrives as inserted; the rest is skipped', async () => {
    a.repo.saveExpense({ project_id: school, day: '2026-10-22', category: 'other', amount_cents: 4_200, method: 'cash' });
    const plan = await transfer(a, b, { projectId: school });
    expect(plan.counts).toEqual({ inserted: 1, updated: 0, skipped: 50 });
    expect(count(b, 'expenses')).toBe(10);
  });
});

describe('deletions travel too', () => {
  let school: string;
  beforeEach(async () => {
    seedDemo();
    school = idOf(a, SCHOOL);
    await transfer(a, b, { projectId: school });
    clock.tick(60_000);
  });

  it('a deleted expense is deleted on the other phone, and its total drops', async () => {
    const e = a.db.first<{ id: string; amount_cents: number }>('SELECT id, amount_cents FROM expenses WHERE project_id = ? ORDER BY amount_cents DESC LIMIT 1', [school]);
    a.repo.deleteRecord('expenses', e?.id as string);
    const plan = await transfer(a, b, { projectId: school });
    expect(plan.counts.updated).toBe(1);
    expect(b.db.first('SELECT deleted_at IS NOT NULL AS gone FROM expenses WHERE id = ?', [e?.id as string])).toEqual({ gone: 1 });
    expect(b.db.first('SELECT expense_cents FROM v_project_cost WHERE project_id = ?', [school])).toEqual({ expense_cents: 49_555_000 - (e?.amount_cents as number) });
    expect(count(b, 'expenses')).toBe(9); // the row itself is kept
  });

  it('a deleted project arrives with everything on it deleted', async () => {
    a.repo.deleteRecord('projects', school);
    const plan = await transfer(a, b, { projectId: school });
    expect(plan.counts.inserted).toBe(0);
    expect(plan.counts.updated).toBe(1 + 9 + 2 + 21 + 4 + 5); // project, expenses, notes, wages, movements, assignments
    expect(b.db.all('SELECT * FROM v_project_cost')).toEqual([]);
    expect(count(b, 'expenses', 'deleted_at IS NULL')).toBe(0);
    expect(count(b, 'wage_entries', 'deleted_at IS NULL')).toBe(0);
    expect(count(b, 'projects')).toBe(1); // still a row: nothing was hard-deleted
  });

  it('an old live copy cannot bring a deleted row back', async () => {
    const e = a.db.first<{ id: string }>('SELECT id FROM expenses WHERE project_id = ? LIMIT 1', [school])?.id as string;
    a.repo.deleteRecord('expenses', e); // version 2, deleted, on A only
    // B still has the live version 1 and sends its copy to A
    const plan = await transfer(b, a, { projectId: school });
    expect(plan.counts).toEqual({ inserted: 0, updated: 0, skipped: 50 });
    expect(a.db.first('SELECT deleted_at IS NOT NULL AS gone FROM expenses WHERE id = ?', [e])).toEqual({ gone: 1 });
    // and when A's copy reaches B the deletion arrives
    await transfer(a, b, { projectId: school });
    expect(b.db.first('SELECT deleted_at IS NOT NULL AS gone FROM expenses WHERE id = ?', [e])).toEqual({ gone: 1 });
  });

  it('an assignment removed on the sender is removed on the other phone, wage history stays', async () => {
    const nimal = a.db.first<{ id: string }>("SELECT id FROM workers WHERE name LIKE 'Nimal%'")?.id as string;
    a.repo.unassignWorker(school, nimal);
    await transfer(a, b, { projectId: school });
    expect(b.db.all('SELECT worker_id FROM v_project_worker_balance WHERE project_id = ? AND worker_id = ?', [school, nimal])).toEqual([]);
    expect(count(b, 'wage_entries', 'worker_id = ? AND deleted_at IS NULL', [nimal])).toBe(6); // 5 days of work and 1 payment
  });
});

describe('parents before children', () => {
  it('the order of the tables inside the bundle does not matter: workers, tools and projects are written before what refers to them', async () => {
    seedDemo();
    const tables = a.bundle.collectProject(idOf(a, SCHOOL));
    // hostile ordering: children first, and the rows of each table reversed
    const reversed = Object.fromEntries(
      Object.entries(JSON.parse(JSON.stringify(tables)) as Record<string, unknown[]>)
        .reverse()
        .map(([t, rows]) => [t, [...rows].reverse()]),
    );
    expect(Object.keys(reversed)[0]).toBe('attachments');
    const plan = await b.bundle.applyBundle(reversed as never, new Map());
    expect(plan.counts.inserted).toBe(50);
    expect(b.db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(b.db.first<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(1);
  });

  it('project_workers refer to a project and a worker that come in the same bundle', async () => {
    seedDemo();
    await transfer(a, b, { projectId: idOf(a, CULVERT) });
    expect(
      b.db.all('SELECT pw.id FROM project_workers pw JOIN projects p ON p.id = pw.project_id JOIN workers w ON w.id = pw.worker_id'),
    ).toHaveLength(2);
  });

  it('a child whose parent is nowhere is refused, and the import stops without writing any of its rows', async () => {
    seedDemo();
    const tables = JSON.parse(JSON.stringify(a.bundle.collectProject(idOf(a, SCHOOL)))) as Record<string, Record<string, unknown>[]>;
    tables.workers = tables.workers.filter((w) => !String(w.name).startsWith('Nimal')); // the parent of his wage entries is missing
    const mute = silenceConsoleError();
    await expect(b.bundle.applyBundle(tables as never, new Map())).rejects.toThrow(/FOREIGN KEY|constraint/i);
    mute.mockRestore();
    for (const t of DATA_TABLES) expect({ table: t, rows: count(b, t) }).toEqual({ table: t, rows: 0 });
    expect(b.db.first<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(1);
  });

  it('one bad row among good ones rolls the whole import back', async () => {
    seedDemo();
    const tables = JSON.parse(JSON.stringify(a.bundle.collectProject(idOf(a, SCHOOL)))) as Record<string, Record<string, unknown>[]>;
    tables.site_notes[1].body = '   '; // the last table that is merged before the failure
    const mute = silenceConsoleError();
    await expect(b.bundle.applyBundle(tables as never, new Map())).rejects.toThrow(/constraint/i);
    mute.mockRestore();
    expect(count(b, 'projects')).toBe(0);
    expect(count(b, 'expenses')).toBe(0);
    expect(count(b, 'audit_log')).toBe(0);
    // and a corrected bundle imports fine afterwards
    tables.site_notes[1].body = 'Rain stopped work';
    expect((await b.bundle.applyBundle(tables as never, new Map())).counts.inserted).toBe(50);
  });
});

describe('a tool that was used on two projects', () => {
  let p1: string;
  let p2: string;
  let tool: string;

  beforeEach(() => {
    p1 = a.repo.saveProject({ name: 'Project one' });
    p2 = a.repo.saveProject({ name: 'Project two (confidential)' });
    const w = a.repo.saveWorker({ name: 'Nimal', daily_rate_cents: 350_000 });
    tool = a.repo.saveTool({ name: 'Concrete mixer' });
    const day = (n: number) => addDays('2026-10-22', -n);
    clock.tick(1);
    a.repo.moveTool({ tool_id: tool, kind: 'issue', project_id: p1, worker_id: w, day: day(5) });
    clock.tick(1);
    a.repo.moveTool({ tool_id: tool, kind: 'return', project_id: p1, worker_id: w, day: day(4) });
    clock.tick(1);
    a.repo.moveTool({ tool_id: tool, kind: 'issue', project_id: p2, worker_id: w, day: day(2) }); // now out on the other project
  });

  it('can be handed over with the first project even though the second project stays behind', async () => {
    const plan = await transfer(a, b, { projectId: p1 });

    expect(plan.counts.inserted).toBe(1 + 1 + 1 + 3); // project, worker, tool, its three movements
    expect(b.db.all('SELECT name FROM projects')).toEqual([{ name: 'Project one' }]); // nothing of project two is revealed
    expect(count(b, 'tool_movements')).toBe(3);
  });

  it('the other phone sees the tool as out, exactly as the sender does', async () => {
    await transfer(a, b, { projectId: p1 });
    const status = (phone: Phone) => phone.db.first<ToolStatus>('SELECT * FROM v_tool_status WHERE tool_id = ?', [tool]);
    expect(status(b)).toEqual(status(a));
    expect(status(b)).toMatchObject({ is_out: 1, last_kind: 'issue', project_id: p2 });
  });

  it('when the second project follows, everything lines up and no row was written twice', async () => {
    await transfer(a, b, { projectId: p1 });
    const plan = await transfer(a, b, { projectId: p2 });
    expect(plan.perTable.tool_movements).toEqual({ inserted: 0, updated: 0, skipped: 3 });
    expect(plan.perTable.projects).toEqual({ inserted: 1, updated: 0, skipped: 0 });
    expect(b.db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(dump(b)).toEqual(dump(a));
  });

  it('while the project is missing, the dangling reference is the only thing the check reports', async () => {
    await transfer(a, b, { projectId: p1 });
    const violations = b.db.all<{ table: string; parent: string }>('PRAGMA foreign_key_check');
    expect(violations.every((v) => v.table === 'tool_movements' && v.parent === 'projects')).toBe(true);
    // the other phone can keep working: it can issue and return the tool
    const w = b.db.first<{ id: string }>('SELECT id FROM workers')?.id as string;
    b.repo.moveTool({ tool_id: tool, kind: 'return', worker_id: w, day: '2026-10-22' });
    expect(b.db.first('SELECT is_out FROM v_tool_status WHERE tool_id = ?', [tool])).toEqual({ is_out: 0 });
  });
});

describe('photos in a hand-over', () => {
  it('travel with their rows, and importing again does not write them twice', async () => {
    const p = a.repo.saveProject({ name: 'With photos' });
    const e = a.repo.saveExpense({ project_id: p, day: '2026-10-20', category: 'materials', amount_cents: 100_000, method: 'cash' });
    queuePhotos(2);
    await addPhotos('expenses', e, 'gallery');
    queuePhotos(1);
    await addPhotos('projects', p, 'gallery');

    const plan = await transfer(a, b, { projectId: p });
    expect(plan.badFiles).toEqual([]);
    expect(plan.perTable.attachments).toEqual({ inserted: 3, updated: 0, skipped: 0 });
    for (const att of b.db.all<Attachment>('SELECT * FROM attachments')) {
      const f = b.files.fileFor(att);
      expect({ name: att.file_name, exists: f.exists, size: f.size }).toEqual({ name: att.file_name, exists: true, size: att.size });
      expect(await b.files.sha256(f)).toBe(att.sha256);
    }
    const again = await transfer(a, b, { projectId: p });
    expect(again.counts.inserted + again.counts.updated).toBe(0);
  });

  it('a photo deleted on the sender is not carried (its row says deleted; no file moves)', async () => {
    const p = a.repo.saveProject({ name: 'P' });
    queuePhotos(1);
    await addPhotos('projects', p, 'gallery');
    const att = a.db.first<Attachment>('SELECT * FROM attachments') as Attachment;
    a.files.removeAttachment(att.id);
    await transfer(a, b, { projectId: p });
    expect(b.db.first('SELECT deleted_at IS NOT NULL AS gone FROM attachments WHERE id = ?', [att.id])).toEqual({ gone: 1 });
    expect(b.files.fileFor(att).exists).toBe(false);
  });
});

describe('empty and partial bundles', () => {
  it('an empty bundle does nothing', async () => {
    const plan = await b.bundle.applyBundle({}, new Map());
    expect(plan).toEqual({ counts: { inserted: 0, updated: 0, skipped: 0 }, perTable: {}, badFiles: [] });
  });

  it('a bundle with only some tables imports them', async () => {
    const id = a.repo.saveProject({ name: 'Just a project' });
    const tables = a.bundle.collectProject(id);
    const plan = await b.bundle.applyBundle({ projects: JSON.parse(JSON.stringify(tables.projects)) }, new Map());
    expect(plan.counts.inserted).toBe(1);
  });

  it('the project id of a project that does not exist collects nothing', () => {
    const tables = a.bundle.collectProject('no-such-project');
    expect(Object.values(tables).every((rows) => rows?.length === 0)).toBe(true);
  });
});
