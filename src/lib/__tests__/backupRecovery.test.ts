/**
 * A damaged database file (a torn restore from Google backup, a full phone, a crash):
 * the app sets the file aside, starts a fresh database with the recovery flag, leaves the good
 * automatic snapshot alone, and the owner can bring the records back from it.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { all, closeDb, DB_NAME, first, getDb, getSetting, setSetting } from '@/db';
import { migrations, DATA_TABLES } from '@/db/schema';
import type { Attachment } from '@/db/types';
import { listAutoBackups, restoreNewestAutoBackup, runAutoBackupIfDue } from '@/lib/autoBackup';
import { verifyBackup } from '@/lib/backup';
import { readErrorLog } from '@/lib/errors';
import { addPhotos, fileFor, sha256 } from '@/lib/files';
import { queuePhotos, resetDb, seedDemo, silenceConsoleError } from '@/test-utils';

jest.setTimeout(120_000);

beforeEach(() => {
  resetDb({ fileDb: true });
});

const sqliteDir = () => new Directory(Paths.document, 'SQLite');
const dbFile = () => new File(sqliteDir(), DB_NAME);
const dump = () => Object.fromEntries(DATA_TABLES.map((t) => [t, all(`SELECT * FROM ${t} ORDER BY id`)]));
const quarantined = () => sqliteDir().list().filter((e) => e.name.includes('.corrupt-')).map((e) => e.name).sort();

const GARBAGE = new TextEncoder().encode('this is not a sqlite database, it is what a torn restore leaves behind. '.repeat(120));

/** The owner's database as it was when the last good snapshot was taken. */
async function ownerHasDataAndASnapshot() {
  seedDemo();
  queuePhotos(1);
  const project = first<{ id: string }>('SELECT id FROM projects LIMIT 1')?.id as string;
  await addPhotos('projects', project, 'gallery');
  expect(await runAutoBackupIfDue()).toBe('done');
  const snapshot = Array.from(listAutoBackups()[0].file.bytesSync());
  const before = dump();
  const photo = first<Attachment>('SELECT * FROM attachments') as Attachment;
  closeDb(); // the app is closed
  return { snapshot, before, photo };
}

function damage(kind: 'garbage' | 'truncated') {
  const f = dbFile();
  expect(f.exists).toBe(true);
  if (kind === 'garbage') f.writeSync(GARBAGE);
  else f.writeSync(f.bytesSync().slice(0, Math.floor(f.size / 2)));
}

describe.each(['garbage', 'truncated'] as const)('the database file is %s', (kind) => {
  it('is set aside and a fresh database starts with the recovery flag; the owner\'s file is kept untouched', async () => {
    await ownerHasDataAndASnapshot();
    damage(kind);
    const damaged = Array.from(dbFile().bytesSync());

    const mute = silenceConsoleError();
    expect(() => getDb()).not.toThrow();
    mute.mockRestore();

    // a clean new database, fully migrated
    expect(first<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(migrations.length);
    for (const t of DATA_TABLES) expect({ table: t, rows: first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n }).toEqual({ table: t, rows: 0 });
    expect(getSetting('recovered_from_corruption')).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // the damaged file is still there, byte for byte, under a new name
    const aside = quarantined();
    expect(aside).toHaveLength(1);
    expect(aside[0]).toMatch(/^bluemoon\.db\.corrupt-\d+$/);
    expect(Array.from(new File(sqliteDir(), aside[0]).bytesSync())).toEqual(damaged);
    expect(readErrorLog()).toContain('"context":"migrate"');
  });

  it('keeps the automatic snapshot safe: no new snapshot is written until the owner has chosen', async () => {
    const { snapshot } = await ownerHasDataAndASnapshot();
    damage(kind);
    const mute = silenceConsoleError();
    getDb();
    mute.mockRestore();

    expect(await runAutoBackupIfDue()).toBe('skipped');
    expect(await runAutoBackupIfDue(true)).toBe('skipped');
    expect(listAutoBackups()).toHaveLength(1);
    expect(Array.from(listAutoBackups()[0].file.bytesSync())).toEqual(snapshot);
  });

  it('restoring the newest snapshot brings every record back, the views included', async () => {
    const { before } = await ownerHasDataAndASnapshot();
    damage(kind);
    const mute = silenceConsoleError();
    getDb();
    mute.mockRestore();

    expect(await restoreNewestAutoBackup()).toBe(true);

    expect(dump()).toEqual(before);
    expect(first('SELECT expense_cents, labour_cents FROM v_project_cost WHERE name LIKE ?', ['Welimada%'])).toEqual({ expense_cents: 49_555_000, labour_cents: 6_180_000 });
    expect(first('SELECT COUNT(*) AS n FROM v_tool_status WHERE is_out = 1')).toEqual({ n: 2 });
  });

  it('the photos were never in the database, so they are still on the phone and match their restored rows', async () => {
    const { photo } = await ownerHasDataAndASnapshot();
    damage(kind);
    const mute = silenceConsoleError();
    getDb();
    mute.mockRestore();
    await restoreNewestAutoBackup();

    const restored = first<Attachment>('SELECT * FROM attachments WHERE id = ?', [photo.id]) as Attachment;
    expect(restored.sha256).toBe(photo.sha256);
    expect(fileFor(restored).exists).toBe(true);
    expect(await sha256(fileFor(restored))).toBe(restored.sha256);
  });

  it('after the owner clears the flag the daily backup runs again, with the restored records', async () => {
    const { before } = await ownerHasDataAndASnapshot();
    damage(kind);
    const mute = silenceConsoleError();
    getDb();
    mute.mockRestore();
    await restoreNewestAutoBackup();

    setSetting('recovered_from_corruption', null); // what the recovery prompt does after a restore
    expect(await runAutoBackupIfDue()).toBe('done');

    // the new snapshot is a good one
    const snapshot = listAutoBackups()[0].file.bytesSync();
    expect(snapshot.length).toBeGreaterThan(500);
    expect(await verifyBackup(snapshot)).toBe(true);
    expect(dump()).toEqual(before);
    expect(getSetting('auto_backup_error')).toBeNull();
  });

  it('closing and reopening the app after the recovery does not set anything else aside', async () => {
    await ownerHasDataAndASnapshot();
    damage(kind);
    const mute = silenceConsoleError();
    getDb();
    mute.mockRestore();
    const flag = getSetting('recovered_from_corruption');

    closeDb();
    getDb();
    closeDb();
    getDb();

    expect(quarantined()).toHaveLength(1);
    expect(getSetting('recovered_from_corruption')).toBe(flag); // still waiting for the owner's choice
  });
});

describe('when there is no snapshot', () => {
  it('a recovered phone starts empty, says so with the flag, and restoreNewestAutoBackup returns false', async () => {
    seedDemo();
    closeDb();
    damage('garbage');
    const mute = silenceConsoleError();
    getDb();
    mute.mockRestore();
    expect(getSetting('recovered_from_corruption')).not.toBeNull();
    expect(await restoreNewestAutoBackup()).toBe(false);
    expect(first('SELECT COUNT(*) AS n FROM projects')).toEqual({ n: 0 });
    expect(quarantined()).toHaveLength(1); // the owner's file can still be rescued by hand
  });
});

describe('a healthy database', () => {
  it('is never set aside: opening, closing and reopening it many times leaves no quarantine and no flag', () => {
    seedDemo();
    for (let i = 0; i < 4; i++) {
      closeDb();
      getDb();
    }
    expect(quarantined()).toEqual([]);
    expect(getSetting('recovered_from_corruption')).toBeNull();
    expect(first('SELECT COUNT(*) AS n FROM projects')).toEqual({ n: 3 });
  });
});
