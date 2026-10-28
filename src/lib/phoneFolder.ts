/**
 * Backups in a folder the owner can see.
 *
 * The automatic snapshots live in the app's private folder (gone if the app is uninstalled). Here the owner
 * picks a folder on the phone once — Documents/Bluemoon, an SD card, any folder the Files app shows — and every
 * snapshot and full backup is also copied there. Android keeps the permission across restarts; files in that
 * folder survive uninstalling the app and can be copied to a computer with a cable.
 */
import { Directory, File } from 'expo-file-system';

import { getSetting, setSetting } from '@/db';
import { nowIso } from '@/lib/dates';

const KEY = 'backup_folder_uri';
/** Snapshots kept in the folder; full backups are never deleted by the app. */
export const FOLDER_KEEP = 30;
const AUTO = /^Bluemoon-auto-\d{4}-\d{2}-\d{2}\.zip$/;

export interface PhoneFolderStatus {
  uri: string | null;
  /** Readable folder name ("Documents/Bluemoon"), or null when none is chosen. */
  name: string | null;
  lastAt: string | null;
  error: string | null;
}

/** "content://…/tree/primary%3ADocuments%2FBluemoon" → "Documents/Bluemoon"; an SD card keeps its volume id. */
export function folderName(uri: string): string {
  const tree = uri.split('/tree/')[1] ?? uri;
  let path: string;
  try {
    path = decodeURIComponent(tree.split('/document/')[0]);
  } catch {
    path = tree;
  }
  const [volume, rest] = path.includes(':') ? [path.slice(0, path.indexOf(':')), path.slice(path.indexOf(':') + 1)] : ['', path];
  const shown = (rest || volume).replace(/\/+$/, '');
  return volume && volume !== 'primary' && shown ? `${volume}/${shown}` : shown || uri;
}

export function phoneFolderStatus(): PhoneFolderStatus {
  const uri = getSetting(KEY);
  return { uri, name: uri ? folderName(uri) : null, lastAt: getSetting('backup_folder_at'), error: getSetting('backup_folder_error') };
}

/** Opens Android's folder picker; the chosen folder is remembered. Returns false when the owner backs out. */
export async function pickPhoneFolder(): Promise<boolean> {
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    return false; // cancelled
  }
  if (!dir?.uri) return false;
  setSetting(KEY, dir.uri);
  // a new folder has none of today's copies yet, so today's snapshot must be copied again
  setSetting('backup_folder_of', null);
  setSetting('backup_folder_error', null);
  return true;
}

export function forgetPhoneFolder() {
  setSetting(KEY, null);
  setSetting('backup_folder_of', null);
  setSetting('backup_folder_at', null);
  setSetting('backup_folder_error', null);
}

/**
 * Writes `bytes` as `name` into the chosen folder (replacing a file of that name), then trims old snapshots.
 * Returns false when no folder is chosen; throws (and records the reason) when the folder can no longer be written,
 * e.g. it was deleted or the SD card removed.
 */
export function copyToPhoneFolder(name: string, bytes: Uint8Array, mime = 'application/zip'): boolean {
  const uri = getSetting(KEY);
  if (!uri) return false;
  // What was in the folder under this name is kept in memory until the new copy is complete and checked: a write that
  // fails half way must not cost the good copy that was there.
  let before: Uint8Array | null = null;
  let created: File | null = null;
  try {
    const dir = new Directory(uri);
    const old = dir.list().filter((e): e is File => e instanceof File && e.name === name);
    before = old.length ? old[0].bytesSync() : null;
    old.forEach((f) => f.delete());
    created = dir.createFile(name, mime);
    created.writeSync(bytes);
    if (typeof created.size === 'number' && created.size !== bytes.length) throw new Error('The copy in the folder is incomplete');
    setSetting('backup_folder_at', nowIso());
    setSetting('backup_folder_error', null);
    trimFolder(dir);
    return true;
  } catch (e) {
    try {
      created?.delete();
    } catch {
      // nothing half written to remove
    }
    try {
      if (before) new Directory(uri).createFile(name, mime).writeSync(before);
    } catch {
      // the folder cannot be written at all: the error below says so
    }
    setSetting('backup_folder_error', `${nowIso()} ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}

/** Copies a file that is already on disk (a full-backup part) into the folder. */
export function copyFileToPhoneFolder(source: File, name = source.name): boolean {
  return copyToPhoneFolder(name, source.bytesSync(), name.endsWith('.zip') ? 'application/zip' : 'application/octet-stream');
}

function trimFolder(dir: Directory) {
  try {
    const autos = dir
      .list()
      .filter((e): e is File => e instanceof File && AUTO.test(e.name))
      .sort((a, b) => b.name.localeCompare(a.name));
    autos.slice(FOLDER_KEEP).forEach((f) => {
      try {
        f.delete();
      } catch {
        // an old copy that will not go is no reason to fail today's backup
      }
    });
  } catch {
    // ignore
  }
}
