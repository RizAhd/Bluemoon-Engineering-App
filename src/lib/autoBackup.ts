/**
 * Automatic daily backup.
 *
 * Once a day a compressed snapshot of every record is written to the app's
 * own `backups/` folder and checked by re-reading it. Snapshots older than
 * KEEP_DAYS are deleted. It runs:
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
import { addDays, nowIso, today } from '@/lib/dates';

import { dataSnapshot, verifyBackup } from './backup';

export const KEEP_DAYS = 25;
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

/** Delete snapshots older than KEEP_DAYS. Always keeps the newest one. */
export function pruneAutoBackups(): number {
  const cutoff = addDays(today(), -KEEP_DAYS);
  const all = listAutoBackups();
  let removed = 0;
  all.slice(1).forEach((b) => {
    if (b.day < cutoff) {
      b.file.delete();
      removed++;
    }
  });
  return removed;
}

let running: Promise<'done' | 'skipped' | 'failed'> | null = null;

/** Write today's snapshot unless it already exists. Safe to call often. */
export function runAutoBackupIfDue(force = false): Promise<'done' | 'skipped' | 'failed'> {
  if (running) return running;
  running = (async () => {
    try {
      getDb();
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
      tmp.move(target);

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
