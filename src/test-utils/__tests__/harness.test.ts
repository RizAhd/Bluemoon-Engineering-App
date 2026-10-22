/**
 * Proves the harness: the REAL data layer (src/db, src/lib) runs under Jest on
 * Node with no device. Every other data-layer test builds on what is shown here.
 */
import * as SQLite from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';

import { all, closeDb, DB_NAME, deviceId, first, getDb, getSetting, newId, save, setSetting } from '@/db';
import { saveProject, saveWorker, ValidationError } from '@/db/repo';
import { migrations } from '@/db/schema';
import type { Attachment } from '@/db/types';
import { listAutoBackups, runAutoBackupIfDue } from '@/lib/autoBackup';
import { seedDemoData } from '@/lib/demoData';
import { readErrorLog, reportError, showError } from '@/lib/errors';
import { addPhotos, attachmentsDir, fileFor, recoverPendingPhoto, sha256 } from '@/lib/files';
import {
  Directory,
  fakePhoto,
  File,
  mainPhone,
  mockAlert,
  openSecondPhone,
  Paths,
  queueFilePick,
  queuePhotos,
  resetDb,
  seedDemo,
  setCameraPermission,
  setPendingCameraResult,
  silenceConsoleError,
  transfer,
  type Phone,
} from '@/test-utils';

const SCHOOL = 'Welimada Primary School Building';

jest.setTimeout(60_000);

beforeEach(() => {
  resetDb();
});

function tableNames(type: 'table' | 'view' | 'index'): string[] {
  return all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name", [type]).map(
    (r) => r.name,
  );
}

describe('sqlite shim', () => {
  it('is what the app gets for expo-sqlite', () => {
    const db = SQLite.openDatabaseSync('scratch.db');
    db.execSync('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER, data BLOB)');
    expect(db.runSync('INSERT INTO t(name, qty) VALUES (?, ?)', ['bolt', 3])).toEqual({ lastInsertRowId: 1, changes: 1 });
    expect(db.getFirstSync('SELECT name, qty FROM t WHERE id = ?', [1])).toEqual({ name: 'bolt', qty: 3 });
    expect(db.getAllSync('SELECT name FROM t')).toEqual([{ name: 'bolt' }]);
  });

  it('returns null, not undefined, when there is no row', () => {
    const db = SQLite.openDatabaseSync('scratch.db');
    db.execSync('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    expect(db.getFirstSync('SELECT * FROM t')).toBeNull();
    expect(db.getAllSync('SELECT * FROM t')).toEqual([]);
  });

  it('binds like expo-sqlite: null, numbers, strings, undefined as NULL, booleans as 1/0, named params', () => {
    const db = SQLite.openDatabaseSync('scratch.db');
    db.execSync('CREATE TABLE t (a, b, c, d, e TEXT)');
    db.runSync('INSERT INTO t VALUES (?, ?, ?, ?, ?)', [null, 12.5, 'x', true, 5]);
    db.runSync('INSERT INTO t(a, b) VALUES (?, ?)', [undefined as unknown as null, false]);
    db.runSync('INSERT INTO t(a) VALUES ($a)', { $a: 'named' });
    expect(db.getAllSync('SELECT a, b, c, d, e, typeof(e) AS te FROM t ORDER BY rowid')).toEqual([
      { a: null, b: 12.5, c: 'x', d: 1, e: '5', te: 'text' },
      { a: null, b: 0, c: null, d: null, e: null, te: 'null' },
      { a: 'named', b: null, c: null, d: null, e: null, te: 'null' },
    ]);
  });

  it('keeps whole numbers as SQLite integers (money is whole cents)', () => {
    const db = SQLite.openDatabaseSync('scratch.db');
    db.execSync('CREATE TABLE t (v)');
    db.runSync('INSERT INTO t VALUES (?)', [18_500_000_00]);
    expect(db.getFirstSync('SELECT v, typeof(v) AS ty FROM t')).toEqual({ v: 18_500_000_00, ty: 'integer' });
  });

  it('reads PRAGMA user_version, table_info and foreign_keys', () => {
    const db = SQLite.openDatabaseSync('scratch.db');
    expect(db.getFirstSync<{ user_version: number }>('PRAGMA user_version')).toEqual({ user_version: 0 });
    db.execSync('PRAGMA user_version = 7');
    expect(db.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(7);

    db.execSync('CREATE TABLE parent (id TEXT PRIMARY KEY NOT NULL); CREATE TABLE child (id TEXT, pid TEXT NOT NULL REFERENCES parent(id))');
    const cols = db.getAllSync<{ name: string; type: string; notnull: number; pk: number }>('PRAGMA table_info(parent)');
    expect(cols).toEqual([{ cid: 0, name: 'id', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 }]);

    // off until the app switches it on, as on a phone
    expect(db.getFirstSync<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(0);
    db.runSync("INSERT INTO child VALUES ('c1', 'nobody')");
    db.execSync('PRAGMA foreign_keys = ON');
    expect(db.getFirstSync<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(1);
    expect(() => db.runSync("INSERT INTO child VALUES ('c2', 'nobody')")).toThrow(/FOREIGN KEY/);
  });

  it('withTransactionSync commits, and rolls back and rethrows on error', () => {
    const db = SQLite.openDatabaseSync('scratch.db');
    db.execSync('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    db.withTransactionSync(() => db.runSync('INSERT INTO t VALUES (1)'));
    expect(() =>
      db.withTransactionSync(() => {
        db.runSync('INSERT INTO t VALUES (2)');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.getAllSync('SELECT id FROM t')).toEqual([{ id: 1 }]);
    expect(db.isInTransactionSync()).toBe(false);
  });

  it('rejects use after closeSync, and an in-memory database survives it', () => {
    const db = SQLite.openDatabaseSync('scratch.db');
    db.execSync('CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1)');
    db.closeSync();
    expect(() => db.getAllSync('SELECT * FROM t')).toThrow(/closed/);
    expect(SQLite.openDatabaseSync('scratch.db').getAllSync('SELECT * FROM t')).toEqual([{ id: 1 }]);
  });

  it('file mode keeps the database in document/SQLite and survives restarting the app', () => {
    resetDb({ fileDb: true });
    saveProject({ name: 'On disk' });
    const file = new File(Paths.document, 'SQLite', DB_NAME);
    expect(file.exists).toBe(true);
    expect(file.size).toBeGreaterThan(0);
    closeDb();
    expect(all('SELECT name FROM projects')).toEqual([{ name: 'On disk' }]);
  });
});

describe('fake file system', () => {
  it('creates, writes, reads, hashes, copies, moves, lists and deletes', async () => {
    const dir = new Directory(Paths.document, 'docs');
    dir.create();
    const f = new File(dir, 'a.txt');
    expect(f.exists).toBe(false);
    expect(f.size).toBe(0);
    f.create();
    f.writeSync('Bluemoon');
    expect(f.exists).toBe(true);
    expect(f.size).toBe(8);
    expect(f.textSync()).toBe('Bluemoon');
    expect(Array.from(f.bytesSync())).toEqual(Array.from(new TextEncoder().encode('Bluemoon')));
    expect(await f.digest('SHA-256')).toBe('48d2ccc8fc161fa27c91721022023e4ca5bb6ae80d1ef111f509b976c950c093');

    const copy = new File(dir, 'b.txt');
    f.copySync(copy);
    expect(copy.textSync()).toBe('Bluemoon');
    expect(() => f.copySync(copy)).toThrow(/already exists/);

    const moved = new File(dir, 'c.txt');
    copy.moveSync(moved);
    expect(copy.name).toBe('c.txt'); // a moved File points at its new place
    expect(new File(dir, 'b.txt').exists).toBe(false);

    expect(dir.list().map((e) => e.name)).toEqual(['a.txt', 'c.txt']);
    expect(f.parentDirectory.uri).toBe(dir.uri);
    expect(f.uri.startsWith('file:///')).toBe(true);

    moved.delete();
    expect(() => moved.delete()).toThrow(/no such file/);
    expect(() => f.create()).toThrow(/already exists/);
  });

  it('File.pickFileAsync returns the queued file, and cancels when nothing is queued', async () => {
    expect(await File.pickFileAsync({ multipleFiles: true })).toEqual({ canceled: true, result: null });
    const asset = fakePhoto();
    queueFilePick(asset.uri);
    const picked = await File.pickFileAsync({ multipleFiles: true });
    expect(picked.canceled).toBe(false);
    expect(picked.result?.map((f) => f.uri)).toEqual([asset.uri]);
    expect((await File.pickFileAsync()).canceled).toBe(true); // the queue is used up
  });

  it('keeps each phone in its own folders', () => {
    expect(Paths.document.path).toBe(mainPhone().documentDir.path);
    expect(Paths.cache.path).not.toBe(Paths.document.path);
    expect(Paths.document.exists).toBe(true);
  });
});

describe('the real data layer', () => {
  it('runs migrations 1 and 2 on a fresh database', () => {
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    const d = getDb();
    expect(d.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(migrations.length);

    expect(tableNames('table')).toEqual(
      expect.arrayContaining([
        'attachments',
        'audit_log',
        'expenses',
        'project_workers', // migration 2
        'projects',
        'settings',
        'site_notes',
        'tool_movements',
        'tools',
        'wage_entries',
        'workers',
      ]),
    );
    expect(tableNames('index')).toEqual(expect.arrayContaining(['ix_expenses_project_day', 'ix_pw_project', 'ix_wage_worker_project_day']));
    const pw = d.getAllSync<{ name: string }>('PRAGMA table_info(project_workers)').map((c) => c.name);
    expect(pw).toEqual(expect.arrayContaining(['project_id', 'worker_id', 'rate_cents', 'version', 'deleted_at']));

    // the app switches foreign keys on when it opens the database
    expect(d.getFirstSync<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(1);
  });

  it('creates every view', () => {
    getDb();
    expect(tableNames('view')).toEqual(
      expect.arrayContaining(['v_project_cost', 'v_project_worker_balance', 'v_tool_status', 'v_wage_day', 'v_worker_balance']),
    );
    for (const view of tableNames('view')) expect(() => all(`SELECT * FROM ${view}`)).not.toThrow();
  });

  it('upgrades a database that is still at version 1', () => {
    const old = SQLite.openDatabaseSync(DB_NAME);
    old.withTransactionSync(() => {
      old.execSync(migrations[0]);
      old.execSync('PRAGMA user_version = 1');
    });
    old.runSync(
      "INSERT INTO projects(id, created_at, updated_at, version, device_id, name) VALUES ('p1', 't', 't', 1, 'old-phone', 'Existing job')",
    );
    old.closeSync();

    expect(first<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(migrations.length);
    expect(all('SELECT name FROM projects')).toEqual([{ name: 'Existing job' }]);
    expect(tableNames('table')).toContain('project_workers');
  });

  it('enforces the schema rules through the validated writes', () => {
    expect(() => saveProject({ name: '   ' })).toThrow(ValidationError);
    const id = saveProject({ name: 'Check' });
    expect(first('SELECT version FROM projects WHERE id = ?', [id])).toEqual({ version: 1 });
    saveProject({ id, name: 'Check 2' });
    expect(first('SELECT name, version FROM projects WHERE id = ?', [id])).toEqual({ name: 'Check 2', version: 2 });
    expect(all('SELECT action FROM audit_log WHERE row_id = ? ORDER BY seq', [id])).toEqual([{ action: 'insert' }, { action: 'update' }]);
    const mute = silenceConsoleError();
    expect(() => save('expenses', { project_id: id, day: '2026-01-01', category: 'fuel', amount_cents: 0, method: 'cash' })).toThrow(/constraint/i);
    mute.mockRestore();
  });

  it('seedDemoData creates the demo set, and a second call returns created:false', () => {
    expect(seedDemoData()).toEqual({ created: true });
    const counts = () =>
      Object.fromEntries(
        ['projects', 'workers', 'project_workers', 'wage_entries', 'expenses', 'tools', 'tool_movements', 'site_notes'].map((t) => [
          t,
          first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n,
        ]),
      );
    const afterFirst = counts();
    expect(afterFirst).toMatchObject({ projects: 3, workers: 6, project_workers: 7, expenses: 12, tools: 5, tool_movements: 4, site_notes: 3 });
    expect(afterFirst.wage_entries).toBeGreaterThan(10);

    expect(seedDemoData()).toEqual({ created: false });
    expect(counts()).toEqual(afterFirst);

    // totals come from the views, in whole cents: Rs 495,550.00 spent on the school
    expect(first('SELECT expense_cents FROM v_project_cost WHERE name = ?', [SCHOOL])).toEqual({ expense_cents: 49_555_000 });
    expect(all('SELECT name FROM v_tool_status WHERE is_out = 1 ORDER BY name')).toEqual([{ name: 'Concrete mixer' }, { name: 'Hilti drill' }]);
  });

  it('seedDemo() and resetDb() work on the main phone', () => {
    expect(seedDemo().created).toBe(true);
    expect(seedDemo().created).toBe(false);
    const oldDevice = deviceId();
    resetDb();
    expect(all('SELECT id FROM projects')).toEqual([]);
    expect(first<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(migrations.length);
    expect(deviceId()).not.toBe(oldDevice); // a reset phone is a new install
    expect(seedDemo().created).toBe(true);
  });

  it('keeps data when the app is restarted', () => {
    const id = saveProject({ name: 'Survivor' });
    mainPhone().restartApp();
    expect(first('SELECT name FROM projects WHERE id = ?', [id])).toEqual({ name: 'Survivor' });
  });

  it('writes the error log into the phone documents folder', () => {
    const mute = silenceConsoleError();
    reportError(new Error('disk on fire'), 'test.context');
    mute.mockRestore();
    expect(readErrorLog()).toContain('disk on fire');
    expect(new File(Paths.document, 'errors.log').exists).toBe(true);

    const mute2 = silenceConsoleError();
    const alert = mockAlert();
    showError(new Error('SQLITE constraint'), 'test.show', (k) => k);
    expect(alert).toHaveBeenCalledWith('errorTitle', expect.stringContaining('dbError'));
    alert.mockRestore();
    mute2.mockRestore();
  });

  it('sets a corrupt database file aside and starts a fresh one (file mode)', () => {
    resetDb({ fileDb: true });
    const dir = new Directory(Paths.document, 'SQLite');
    dir.create({ intermediates: true, idempotent: true });
    const bad = new File(dir, DB_NAME);
    bad.create();
    bad.writeSync('this is not a sqlite database. '.repeat(100));

    const mute = silenceConsoleError();
    getDb();
    mute.mockRestore();

    expect(getSetting('recovered_from_corruption')).not.toBeNull();
    expect(dir.list().map((e) => e.name).some((n) => n.startsWith(`${DB_NAME}.corrupt-`))).toBe(true);
    expect(tableNames('table')).toContain('projects');
  });
});

describe('photos, backups and hand-off on the main phone', () => {
  it('attaches a picked photo: compressed copy in documents, row with size and SHA-256', async () => {
    const project = saveProject({ name: 'With photo' });
    queuePhotos(1);
    expect(await addPhotos('projects', project, 'gallery')).toBe(1);

    const att = first<Attachment>('SELECT * FROM attachments');
    expect(att).not.toBeNull();
    const file = fileFor(att as Attachment);
    expect(file.parentDirectory.uri).toBe(attachmentsDir().uri);
    expect(file.exists).toBe(true);
    expect(file.size).toBe(att?.size);
    expect(await sha256(file)).toBe(att?.sha256);
  });

  it('refuses the camera when the permission is denied', async () => {
    setCameraPermission(false);
    await expect(addPhotos('projects', 'p', 'camera')).rejects.toThrow('camera-permission');
  });

  it('recovers a photo taken just before Android killed the app', async () => {
    const project = saveProject({ name: 'Camera job' });
    setSetting('pending_camera', JSON.stringify({ table: 'projects', id: project }));
    setPendingCameraResult([fakePhoto()]);
    expect(await recoverPendingPhoto()).toBe(1);
    expect(all('SELECT owner_id FROM attachments')).toEqual([{ owner_id: project }]);
    expect(getSetting('pending_camera')).toBeNull();
  });

  it('a cancelled picker adds nothing', async () => {
    const project = saveProject({ name: 'No photo' });
    expect(await addPhotos('projects', project, 'gallery')).toBe(0);
    expect(all('SELECT id FROM attachments')).toEqual([]);
  });

  it('runs the daily backup task body registered with expo-task-manager', async () => {
    seedDemo();
    const tasks = (TaskManager as unknown as { __tasks: Map<string, () => Promise<number>> }).__tasks;
    const body = tasks.get('bluemoon-daily-backup');
    expect(body).toBeDefined();
    expect(await body?.()).toBe(1); // BackgroundTaskResult.Success
    expect(listAutoBackups()).toHaveLength(1);
  });

  it('writes the automatic backup and a full backup zip', async () => {
    seedDemo();
    expect(await runAutoBackupIfDue()).toBe('done');
    expect(listAutoBackups()).toHaveLength(1);
    expect(getSetting('auto_backup_error')).toBeNull();

    const zips = await mainPhone().backup.makeBackup();
    expect(zips).toHaveLength(1);
    expect(zips[0].exists).toBe(true);
  });
});

describe('two independent phones', () => {
  let b: Phone;

  beforeAll(() => {
    b = openSecondPhone({ pdf: true });
  });
  beforeEach(() => {
    b.resetDb();
  });
  afterAll(() => {
    b.dispose();
  });

  it('do not share rows', () => {
    const a1 = saveProject({ name: 'Only on phone A' });
    const b1 = b.repo.saveProject({ name: 'Only on phone B' });

    expect(all('SELECT name FROM projects')).toEqual([{ name: 'Only on phone A' }]);
    expect(b.db.all('SELECT name FROM projects')).toEqual([{ name: 'Only on phone B' }]);
    expect(first('SELECT id FROM projects WHERE id = ?', [b1])).toBeNull();
    expect(b.db.first('SELECT id FROM projects WHERE id = ?', [a1])).toBeNull();

    // separate modules, connections and identities
    expect(b.db.getDb()).not.toBe(getDb());
    expect(b.db.deviceId()).not.toBe(deviceId());
    expect(b.db.newId()).not.toBe(newId());

    // a write on one phone does not touch the other's workers either
    saveWorker({ name: 'Nimal', daily_rate_cents: 350_000 });
    expect(b.db.all('SELECT id FROM workers')).toEqual([]);
  });

  it('do not share files', () => {
    expect(b.documentDir.path).not.toBe(mainPhone().documentDir.path);
    const mute = silenceConsoleError();
    reportError(new Error('only A'), 'a');
    mute.mockRestore();
    expect(readErrorLog()).toContain('only A');
    expect(b.errors.readErrorLog()).toBe('');
    expect(b.run(() => new File(Paths.document, 'errors.log').exists)).toBe(false);
  });

  it('each phone can be file-backed at its own path', () => {
    const c = openSecondPhone({ name: 'filephone', fileDb: true });
    try {
      c.repo.saveProject({ name: 'Persisted on C' });
      expect(c.run(() => new File(Paths.document, 'SQLite', DB_NAME).exists)).toBe(true);
      expect(new File(Paths.document, 'SQLite', DB_NAME).exists).toBe(false); // main is in memory
    } finally {
      c.dispose();
    }
  });

  it('merge a project by hand-off, and importing it again changes nothing', async () => {
    seedDemo();
    const school = first<{ id: string }>('SELECT id FROM projects WHERE name = ?', [SCHOOL])?.id as string;

    const plan = await transfer(mainPhone(), b, { projectId: school });
    expect(plan.counts.inserted).toBeGreaterThan(0);
    expect(plan.badFiles).toEqual([]);
    expect(b.db.all('SELECT name FROM projects')).toEqual([{ name: SCHOOL }]);
    expect(b.db.all('SELECT id FROM expenses')).toHaveLength(9);
    expect(b.db.first('SELECT expense_cents FROM v_project_cost')).toEqual({ expense_cents: 49_555_000 });

    const again = await transfer(mainPhone(), b, { projectId: school });
    expect(again.counts.inserted).toBe(0);
    expect(again.counts.updated).toBe(0);
    expect(again.counts.skipped).toBe(plan.counts.inserted);
  });

  it('carry photos with their SHA-256', async () => {
    const project = saveProject({ name: 'Photo job' });
    queuePhotos(2);
    expect(await addPhotos('projects', project, 'gallery')).toBe(2);

    const plan = await transfer(mainPhone(), b, { projectId: project });
    expect(plan.badFiles).toEqual([]);
    const rows = b.db.all<Attachment>('SELECT * FROM attachments ORDER BY created_at');
    expect(rows).toHaveLength(2);
    for (const att of rows) {
      const f = b.files.fileFor(att);
      expect(f.exists).toBe(true);
      expect(f.uri.startsWith(b.documentDir.uri)).toBe(true);
      expect(await b.files.sha256(f)).toBe(att.sha256);
    }
  });

  it('hand a project over as a PDF with its photo, and import it on the other phone', async () => {
    const project = saveProject({ name: 'PDF job', client: 'RDA' });
    queuePhotos(1);
    await addPhotos('projects', project, 'gallery');
    const photo = first<Attachment>('SELECT * FROM attachments') as Attachment;

    const pdf = await mainPhone().pdf.exportProjectPdf(project, { includePhotos: true });
    expect(pdf.exists).toBe(true);
    expect(pdf.name).toMatch(/^Bluemoon-PDF-job-.*\.pdf$/);

    const read = await b.pdf.readProjectPdf(pdf.bytesSync());
    if (read.status !== 'ok') throw new Error(`PDF was not readable: ${read.status}`);
    expect(read.bundle.project_name).toBe('PDF job');
    expect(read.files.has(photo.file_name)).toBe(true);

    const plan = await b.bundle.applyBundle(read.bundle.tables, read.files);
    expect(plan.badFiles).toEqual([]);
    expect(b.db.all('SELECT name, client FROM projects')).toEqual([{ name: 'PDF job', client: 'RDA' }]);
    const landed = b.db.first<Attachment>('SELECT * FROM attachments') as Attachment;
    expect(await b.files.sha256(b.files.fileFor(landed))).toBe(photo.sha256);
  });

  it('exports a PDF on the company letterhead (bundled picture comes from the asset mock)', async () => {
    const project = saveProject({ name: 'Letterhead job' });
    const notices: string[] = [];
    const pdf = await mainPhone().pdf.exportProjectPdf(project, { includePhotos: false, letterhead: true, onNotice: (n) => notices.push(n) });
    expect(notices).toEqual([]);
    expect((await b.pdf.readProjectPdf(pdf.bytesSync())).status).toBe('ok');
  });

  it('restore a full backup made on the other phone', async () => {
    seedDemo();
    const [zip] = await mainPhone().backup.makeBackup();
    const res = await b.backup.restorePart(zip.uri);
    expect(res.parts).toBe(1);
    expect(b.db.all('SELECT id FROM projects')).toHaveLength(3);
    expect(b.db.first('SELECT expense_cents FROM v_project_cost WHERE name = ?', [SCHOOL])).toEqual({ expense_cents: 49_555_000 });
  });

  it('merge keeps the newer version of a row edited on both phones', async () => {
    const id = saveProject({ name: 'Shared job' });
    await transfer(mainPhone(), b, { projectId: id });
    b.repo.saveProject({ id, name: 'Edited on B' }); // version 2 on B
    await transfer(b, mainPhone(), { projectId: id });
    expect(first('SELECT name, version FROM projects WHERE id = ?', [id])).toEqual({ name: 'Edited on B', version: 2 });
  });
});
