/**
 * The automatic daily backup: once a day, verified, pruned by name (not by the phone's clock),
 * paused after a recovery, and never able to destroy a good snapshot.
 */
import * as BackgroundTask from 'expo-background-task';
import { File } from 'expo-file-system';
import * as TaskManager from 'expo-task-manager';

import { all, closeDb, first, getDb, getSetting, setSetting } from '@/db';
import { saveExpense, saveProject } from '@/db/repo';
import {
  backupsDir,
  backupsSizeBytes,
  KEEP_DAYS,
  listAutoBackups,
  pruneAutoBackups,
  registerDailyBackupTask,
  restoreNewestAutoBackup,
  runAutoBackupIfDue,
} from '@/lib/autoBackup';
import * as backupModule from '@/lib/backup';
import { verifyBackup } from '@/lib/backup';
import { addDays } from '@/lib/dates';
import { resetDb, seedDemo } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(120_000);

const MB = 1024 * 1024;
let clock: ReturnType<typeof useClock>;

beforeEach(() => {
  resetDb();
  clock = useClock(new Date(2026, 9, 22, 12, 0, 0)); // local noon, so today() is 2026-10-22 in any time zone
});
afterEach(() => {
  jest.restoreAllMocks();
  clock.restore();
});

const TODAY = '2026-10-22';
const fileOf = (day: string) => new File(backupsDir(), `Bluemoon-auto-${day}.zip`);
const names = () => backupsDir().list().map((e) => e.name).sort();
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

/** Put a snapshot-looking file in the backups folder (not a real snapshot unless `bytes` is). */
function put(day: string, size = 64, bytes?: Uint8Array) {
  const f = fileOf(day);
  f.create();
  f.writeSync(bytes ?? new Uint8Array(size).fill(day.length));
  return f;
}

describe('runAutoBackupIfDue', () => {
  it('writes today\'s snapshot, checks it by reading it back, and notes when it did so', async () => {
    seedDemo();
    expect(await runAutoBackupIfDue()).toBe('done');

    expect(names()).toEqual([`Bluemoon-auto-${TODAY}.zip`]);
    expect(await verifyBackup(fileOf(TODAY).bytesSync())).toBe(true);
    expect(getSetting('auto_backup_day')).toBe(TODAY);
    expect(getSetting('auto_backup_at')).toBe(new Date().toISOString());
    expect(getSetting('auto_backup_error')).toBeNull();
    const [only] = listAutoBackups();
    expect(only).toMatchObject({ day: TODAY });
    expect(only.size).toBeGreaterThan(500);
  });

  it('calling again with nothing new (the app opens many times) does not write again', async () => {
    seedDemo();
    await runAutoBackupIfDue();
    const before = fileOf(TODAY).bytesSync();
    for (let i = 0; i < 3; i++) expect(await runAutoBackupIfDue()).toBe('skipped');
    expect(Array.from(fileOf(TODAY).bytesSync())).toEqual(Array.from(before));
    expect(names()).toHaveLength(1);
  });

  it("a record added later the same day is in today's snapshot by the next run, written once", async () => {
    seedDemo();
    await runAutoBackupIfDue();
    saveProject({ name: 'Added later today' });
    expect(await runAutoBackupIfDue()).toBe('done');
    expect(await runAutoBackupIfDue()).toBe('skipped');
    expect(names()).toHaveLength(1); // still one file for the day, now with the new project
    expect(await verifyBackup(fileOf(TODAY).bytesSync())).toBe(true);
  });

  it('the next day writes a new file and keeps the old one', async () => {
    seedDemo();
    await runAutoBackupIfDue();
    clock.set(new Date(2026, 9, 23, 7, 0, 0));
    saveProject({ name: 'Added overnight' });
    expect(await runAutoBackupIfDue()).toBe('done');
    expect(names()).toEqual(['Bluemoon-auto-2026-10-22.zip', 'Bluemoon-auto-2026-10-23.zip']);
    expect(listAutoBackups().map((b) => b.day)).toEqual(['2026-10-23', '2026-10-22']); // newest first
  });

  it('a forced run replaces today\'s snapshot with the current records', async () => {
    seedDemo();
    await runAutoBackupIfDue();
    const sizeBefore = fileOf(TODAY).size;
    for (let i = 0; i < 30; i++) saveProject({ name: `Extra ${i}` });
    expect(await runAutoBackupIfDue(true)).toBe('done');
    expect(names()).toHaveLength(1);
    expect(fileOf(TODAY).size).toBeGreaterThan(sizeBefore);
    expect(await verifyBackup(fileOf(TODAY).bytesSync())).toBe(true);
  });

  it('a file for today that this install did not write (came back with Google backup) is replaced, not trusted', async () => {
    seedDemo();
    put(TODAY, 40, new TextEncoder().encode('an old half-restored file'));
    expect(getSetting('auto_backup_day')).toBeNull();
    expect(await runAutoBackupIfDue()).toBe('done');
    expect(await verifyBackup(fileOf(TODAY).bytesSync())).toBe(true);
  });

  it('is off when the owner turned it off, unless forced', async () => {
    seedDemo();
    setSetting('auto_backup', 'off');
    expect(await runAutoBackupIfDue()).toBe('skipped');
    expect(names()).toEqual([]);
    expect(await runAutoBackupIfDue(true)).toBe('done');
    expect(names()).toHaveLength(1);
  });

  it('is paused while the database was recovered from corruption, even when forced: an empty snapshot must not replace a good one', async () => {
    seedDemo();
    await runAutoBackupIfDue();
    const good = Array.from(fileOf(TODAY).bytesSync());
    setSetting('recovered_from_corruption', new Date().toISOString());
    setSetting('auto_backup_day', null);
    for (const force of [false, true]) expect(await runAutoBackupIfDue(force)).toBe('skipped');
    expect(Array.from(fileOf(TODAY).bytesSync())).toEqual(good);

    clock.set(new Date(2026, 9, 23, 7, 0, 0));
    expect(await runAutoBackupIfDue()).toBe('skipped');
    expect(names()).toEqual([`Bluemoon-auto-${TODAY}.zip`]);

    setSetting('recovered_from_corruption', null); // the owner chose
    expect(await runAutoBackupIfDue()).toBe('done');
    expect(names()).toHaveLength(2);
  });

  it('two calls at the same time share one run and write one file', async () => {
    seedDemo();
    const p1 = runAutoBackupIfDue();
    const p2 = runAutoBackupIfDue();
    expect(p2).toBe(p1);
    expect(await Promise.all([p1, p2])).toEqual(['done', 'done']);
    expect(names()).toHaveLength(1);
  });

  describe('when the check fails', () => {
    it('the snapshot is not kept, the failure is recorded, and the next try starts clean', async () => {
      seedDemo();
      jest.spyOn(backupModule, 'verifyBackup').mockResolvedValue(false);
      expect(await runAutoBackupIfDue()).toBe('failed');
      expect(names()).toEqual([]);
      expect(getSetting('auto_backup_error')).toBe(`${new Date().toISOString()} snapshot failed verification`);
      expect(getSetting('auto_backup_day')).toBeNull();

      jest.restoreAllMocks();
      expect(await runAutoBackupIfDue()).toBe('done');
      expect(getSetting('auto_backup_error')).toBeNull();
    });

    it('a file that was written but reads back wrong never replaces today\'s good snapshot', async () => {
      seedDemo();
      await runAutoBackupIfDue();
      const good = Array.from(fileOf(TODAY).bytesSync());
      saveProject({ name: 'More data' });

      const real = backupModule.verifyBackup;
      jest.spyOn(backupModule, 'verifyBackup').mockImplementationOnce(real).mockResolvedValueOnce(false); // in memory fine, on disk bad
      expect(await runAutoBackupIfDue(true)).toBe('failed');

      expect(getSetting('auto_backup_error')).toContain('written file failed verification');
      expect(Array.from(fileOf(TODAY).bytesSync())).toEqual(good);
      expect(names()).toContain(`Bluemoon-auto-${TODAY}.tmp`); // the half-trusted file is left for the next run to clean

      jest.restoreAllMocks();
      expect(await runAutoBackupIfDue(true)).toBe('done');
      expect(names()).toEqual([`Bluemoon-auto-${TODAY}.zip`]); // no stray .tmp any more
    });

    it('the daily task reports Failed to the system so it is retried, and Success otherwise', async () => {
      seedDemo();
      const body = (TaskManager as unknown as { __tasks: Map<string, () => Promise<number>> }).__tasks.get('bluemoon-daily-backup');
      expect(body).toBeDefined();
      jest.spyOn(backupModule, 'verifyBackup').mockResolvedValue(false);
      expect(await body?.()).toBe(BackgroundTask.BackgroundTaskResult.Failed);
      jest.restoreAllMocks();
      expect(await body?.()).toBe(BackgroundTask.BackgroundTaskResult.Success);
    });
  });
});

describe('pruneAutoBackups', () => {
  it(`keeps the newest ${KEEP_DAYS} by name and removes the rest`, () => {
    for (const d of days('2026-09-01', 40)) put(d);
    expect(listAutoBackups()).toHaveLength(40);
    expect(pruneAutoBackups()).toBe(40 - KEEP_DAYS);
    const kept = listAutoBackups().map((b) => b.day);
    expect(kept).toHaveLength(KEEP_DAYS);
    expect(kept).toEqual(days('2026-09-01', 40).slice(-KEEP_DAYS).reverse());
  });

  it('does nothing when there are fewer than the limit', () => {
    for (const d of days('2026-10-01', 10)) put(d);
    expect(pruneAutoBackups()).toBe(0);
    expect(names()).toHaveLength(10);
  });

  it('goes by the date in the name, not by when the file was written', () => {
    // written newest first, so file times run the opposite way to the names
    for (const d of days('2026-09-01', 30).reverse()) put(d);
    pruneAutoBackups();
    expect(listAutoBackups().map((b) => b.day)).toEqual(days('2026-09-01', 30).slice(-KEEP_DAYS).reverse());
  });

  it('a phone clock that jumps far forward does not wipe the older snapshots', async () => {
    seedDemo();
    for (const d of days('2026-10-01', 10)) put(d);
    clock.set(new Date(2028, 0, 15, 12, 0, 0)); // 15 months later, in one step
    expect(await runAutoBackupIfDue()).toBe('done');
    // all ten old ones are far older than 25 days by the clock, and all are still there
    expect(listAutoBackups().map((b) => b.day)).toEqual(['2028-01-15', ...days('2026-10-01', 10).reverse()]);
  });

  it('a clock that jumps forward keeps counting the newest 25 by name: 24 old ones and the new one', async () => {
    seedDemo();
    for (const d of days('2026-09-20', 30)) put(d);
    clock.set(new Date(2030, 5, 1, 12, 0, 0));
    expect(await runAutoBackupIfDue()).toBe('done');
    const kept = listAutoBackups().map((b) => b.day);
    expect(kept).toHaveLength(KEEP_DAYS);
    expect(kept[0]).toBe('2030-06-01');
    expect(kept.slice(1)).toEqual(days('2026-09-20', 30).slice(-(KEEP_DAYS - 1)).reverse());
  });

  it('keeps pruning on a normal day: a skipped run still tidies up', async () => {
    seedDemo();
    await runAutoBackupIfDue();
    for (const d of days('2026-08-01', 30)) put(d);
    expect(await runAutoBackupIfDue()).toBe('skipped');
    expect(listAutoBackups()).toHaveLength(KEEP_DAYS);
    expect(listAutoBackups()[0].day).toBe(TODAY);
  });

  describe('the size cap (8 MB in total)', () => {
    it('removes the oldest ones once the newest ones add up to more than the cap', () => {
      for (const d of days('2026-10-01', 12)) put(d, MB);
      const removed = pruneAutoBackups();
      expect(removed).toBe(4); // eight 1 MB files = exactly the cap
      expect(listAutoBackups().map((b) => b.day)).toEqual(days('2026-10-01', 12).slice(-8).reverse());
      expect(backupsSizeBytes()).toBe(8 * MB);
    });

    it('always keeps the newest 3, however big they are', () => {
      for (const d of days('2026-10-01', 5)) put(d, 9 * MB);
      pruneAutoBackups();
      expect(listAutoBackups().map((b) => b.day)).toEqual(days('2026-10-01', 5).slice(-3).reverse());
    });

    it('a single huge snapshot is never removed', () => {
      put('2026-10-20', 20 * MB);
      expect(pruneAutoBackups()).toBe(0);
      expect(names()).toHaveLength(1);
    });
  });

  it('removes stray .tmp files left by an interrupted run, and leaves other files alone', () => {
    put('2026-10-20');
    const stray = new File(backupsDir(), 'Bluemoon-auto-2026-10-21.tmp');
    stray.create();
    stray.writeSync('half');
    for (const other of ['notes.txt', 'Bluemoon-auto-2026-1-1.zip', 'Bluemoon-auto-2026-10-19.zip.bak', 'bluemoon-auto-2026-10-18.zip']) {
      const f = new File(backupsDir(), other);
      f.create();
      f.writeSync('keep me');
    }
    expect(pruneAutoBackups()).toBe(1);
    expect(names()).toEqual(['Bluemoon-auto-2026-1-1.zip', 'Bluemoon-auto-2026-10-19.zip.bak', 'Bluemoon-auto-2026-10-20.zip', 'bluemoon-auto-2026-10-18.zip', 'notes.txt']);
  });

  it('a file that cannot be deleted is skipped; the rest are still tidied and nothing throws', () => {
    for (const d of days('2026-09-01', 30)) put(d);
    const real = File.prototype.delete;
    let first1 = true;
    jest.spyOn(File.prototype, 'delete').mockImplementation(function (this: File) {
      if (first1) {
        first1 = false;
        throw new Error('EACCES: permission denied');
      }
      return real.call(this);
    });
    expect(() => pruneAutoBackups()).not.toThrow();
    expect(listAutoBackups().length).toBe(KEEP_DAYS + 1); // one of the five old ones survived
  });
});

describe('listAutoBackups and backupsSizeBytes', () => {
  it('lists only files named Bluemoon-auto-YYYY-MM-DD.zip, newest first, with their size', () => {
    put('2026-10-20', 10);
    put('2026-10-22', 30);
    put('2026-10-21', 20);
    new File(backupsDir(), 'random.zip').create();
    expect(listAutoBackups().map((b) => [b.day, b.size])).toEqual([
      ['2026-10-22', 30],
      ['2026-10-21', 20],
      ['2026-10-20', 10],
    ]);
    expect(backupsSizeBytes()).toBe(60);
  });

  it('creates the backups folder when it is not there', () => {
    expect(backupsDir().exists).toBe(true);
    expect(listAutoBackups()).toEqual([]);
    expect(backupsSizeBytes()).toBe(0);
  });
});

describe('restoreNewestAutoBackup', () => {
  it('says so when there is nothing to restore', async () => {
    expect(await restoreNewestAutoBackup()).toBe(false);
  });

  it('brings back the records of the newest snapshot, not an older one', async () => {
    const p = saveProject({ name: 'Day one project' });
    await runAutoBackupIfDue();
    clock.set(new Date(2026, 9, 23, 7, 0, 0));
    saveExpense({ project_id: p, day: '2026-10-23', category: 'fuel', amount_cents: 12_300, method: 'cash' });
    const second = saveProject({ name: 'Day two project' });
    await runAutoBackupIfDue();

    resetDbKeepingBackups();
    expect(all('SELECT id FROM projects')).toEqual([]);
    expect(await restoreNewestAutoBackup()).toBe(true);

    expect(all<{ name: string }>('SELECT name FROM projects ORDER BY name').map((r) => r.name)).toEqual(['Day one project', 'Day two project']);
    expect(first('SELECT id FROM projects WHERE id = ?', [second])).toEqual({ id: second });
    expect(first('SELECT expense_cents FROM v_project_cost WHERE project_id = ?', [p])).toEqual({ expense_cents: 12_300 });
  });

  it('restoring twice is harmless', async () => {
    seedDemo();
    await runAutoBackupIfDue();
    const state = all('SELECT * FROM expenses ORDER BY id');
    await restoreNewestAutoBackup();
    await restoreNewestAutoBackup();
    expect(all('SELECT * FROM expenses ORDER BY id')).toEqual(state);
  });
});

/** Empty the database but keep the files (the backups folder), like losing the database file alone. */
function resetDbKeepingBackups() {
  const d = getDb();
  d.execSync('PRAGMA foreign_keys = OFF');
  for (const t of ['attachments', 'site_notes', 'tool_movements', 'wage_entries', 'expenses', 'project_workers', 'tools', 'workers', 'estimate_payments', 'estimate_items', 'estimates', 'projects']) d.execSync(`DELETE FROM ${t}`);
  d.execSync('PRAGMA foreign_keys = ON');
  closeDb();
}

describe('registerDailyBackupTask', () => {
  const register = BackgroundTask.registerTaskAsync as jest.Mock;
  const status = BackgroundTask.getStatusAsync as jest.Mock;

  beforeEach(() => {
    register.mockClear();
    status.mockClear();
  });

  it('is defined at start-up so Android can run it with the app closed', () => {
    expect((TaskManager as unknown as { __tasks: Map<string, unknown> }).__tasks.has('bluemoon-daily-backup')).toBe(true);
  });

  it('registers it every 12 hours at the earliest', async () => {
    await registerDailyBackupTask();
    expect(register).toHaveBeenCalledWith('bluemoon-daily-backup', { minimumInterval: 12 * 60 });
  });

  it('does nothing when background work is not available on this phone', async () => {
    status.mockResolvedValueOnce(BackgroundTask.BackgroundTaskStatus.Restricted);
    await registerDailyBackupTask();
    expect(register).not.toHaveBeenCalled();
  });

  it('does not register twice', async () => {
    (TaskManager as unknown as { __register: (n: string) => void }).__register('bluemoon-daily-backup');
    await registerDailyBackupTask();
    expect(register).not.toHaveBeenCalled();
  });

  it('never throws: the backup on app open still runs if background work cannot be set up', async () => {
    status.mockRejectedValueOnce(new Error('boom'));
    await expect(registerDailyBackupTask()).resolves.toBeUndefined();
  });
});
