/**
 * Automatic daily backup.
 *
 * Once a day a compressed snapshot of every record is written to the app's
 * own `backups/` folder and checked by re-reading it. Snapshots older than
 * KEEP_DAYS (or beyond a size cap) are deleted. It runs:
 *   - when the app opens or comes back to the front (reliable), and
 *   - from an Android WorkManager background task (best effort; Android picks
 *     the time, usually when the phone is idle).
 *
 * The `backups/` folder and the database are also included in Android's own
 * Google backup (see plugins/withBackupRules.js), so the records survive a
 * lost phone when the app is reinstalled with the same Google account.
 */
import * as BackgroundTask from 'expo-background-task';
import { Directory, File, Paths } from 'expo-file-system';
import * as TaskManager from 'expo-task-manager';

import { getDb, getSetting, setSetting } from '@/db';
import { nowIso, today } from '@/lib/dates';

import { dataSnapshot, restorePart, verifyBackup } from './backup';

export const KEEP_DAYS = 25;
const MAX_BYTES = 8 * 1024 * 1024;
const MIN_KEEP = 3;
const TASK = 'bluemoon-daily-backup';
const PREFIX = 'Bluemoon-auto-';
const NAME = /^Bluemoon-auto-(\d{4}-\d{2}-\d{2})\.zip$/;

export interface AutoBackupFile {
  day: string;
  file: File;
  size: number;
}

export function backupsDir(): Directory {
  const dir = new Directory(Paths.document, 'backups');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function listAutoBackups(): AutoBackupFile[] {
  const out: AutoBackupFile[] = [];
  for (const entry of backupsDir().list()) {
    if (!(entry instanceof File)) continue;
    const m = NAME.exec(entry.name);
    if (m) out.push({ day: m[1], file: entry, size: entry.size ?? 0 });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day));
}

/** Keep the newest KEEP_DAYS snapshots (by name, not by clock) within MAX_BYTES; always keep the newest 3. */
export function pruneAutoBackups(): number {
  let removed = 0;
  const kill = (f: File) => {
    try {
      f.delete();
      removed++;
    } catch {
      // a failed delete must not fail the backup
    }
  };
  try {
    // Stray temp files from an interrupted run.
    for (const entry of backupsDir().list()) if (entry instanceof File && entry.name.endsWith('.tmp')) kill(entry);

    const all = listAutoBackups(); // newest first
    all.slice(KEEP_DAYS).forEach((b) => kill(b.file));
    let total = 0;
    all.slice(0, KEEP_DAYS).forEach((b, i) => {
      total += b.size;
      if (i >= MIN_KEEP && total > MAX_BYTES) kill(b.file);
    });
  } catch {
    // ignore
  }
  return removed;
}

/** Total size of the snapshots folder (Android's cloud backup quota is 25 MB). */
export function backupsSizeBytes(): number {
  return listAutoBackups().reduce((n, b) => n + b.size, 0);
}

/**
 * Restore the newest automatic snapshot (after a database was lost or reset).
 * Snapshots contain records only, not photos. Returns false when there is none.
 */
export async function restoreNewestAutoBackup(): Promise<boolean> {
  const newest = listAutoBackups()[0];
  if (!newest) return false;
  await restorePart(newest.file.uri);
  return true;
}

let running: Promise<'done' | 'skipped' | 'failed'> | null = null;

/** Write today's snapshot unless it already exists. Safe to call often. */
export function runAutoBackupIfDue(force = false): Promise<'done' | 'skipped' | 'failed'> {
  if (running) return running;
  running = (async () => {
    try {
      getDb();
      // After a corrupt database was set aside the app starts empty: writing a snapshot now
      // would overwrite today's good one with an empty one. Wait until the owner has chosen.
      if (getSetting('recovered_from_corruption')) return 'skipped';
      if (getSetting('auto_backup') === 'off' && !force) return 'skipped';
      const day = today();
      const target = new File(backupsDir(), `${PREFIX}${day}.zip`);
      if (!force && target.exists && getSetting('auto_backup_day') === day) {
        pruneAutoBackups();
        return 'skipped';
      }

      const bytes = await dataSnapshot();
      if (!(await verifyBackup(bytes))) throw new Error('snapshot failed verification');

      // Write to a temp name first, then swap, so a crash never leaves a half file.
      const tmp = new File(backupsDir(), `${PREFIX}${day}.tmp`);
      if (tmp.exists) tmp.delete();
      tmp.create();
      tmp.writeSync(bytes);
      if (!(await verifyBackup(tmp.bytesSync()))) throw new Error('written file failed verification');
      if (target.exists) target.delete();
      tmp.moveSync(target);

      setSetting('auto_backup_day', day);
      setSetting('auto_backup_at', nowIso());
      setSetting('auto_backup_error', null);
      pruneAutoBackups();
      return 'done';
    } catch (e) {
      try {
        setSetting('auto_backup_error', `${nowIso()} ${e instanceof Error ? e.message : String(e)}`);
      } catch {
        // the database itself is unavailable; nothing more we can record
      }
      return 'failed';
    } finally {
      running = null;
    }
  })();
  return running;
}

// The task must be defined at module top level so Android can start it with the app closed.
TaskManager.defineTask(TASK, async () => {
  const res = await runAutoBackupIfDue();
  return res === 'failed' ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
});

export async function registerDailyBackupTask() {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(TASK)) return;
    // Every 12 hours at the earliest; the snapshot itself is once per day.
    await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 12 * 60 });
  } catch {
    // Background work is a bonus; the on-open backup still runs.
  }
}
