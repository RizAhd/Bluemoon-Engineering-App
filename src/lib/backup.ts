/**
 * Full backup to a file the user saves to Google Drive (or anywhere) from the
 * share sheet.
 *
 * Format: one or more .zip parts. Every part holds all rows (data.json, a few
 * MB) with its SHA-256, plus a slice of the photos. Parts are capped at ~40 MB
 * so a phone never has to hold a huge file in memory.
 *
 * Restore MERGES (newer version wins, nothing is deleted), so restoring is
 * always safe: on a new phone it brings everything back, on an old phone it
 * only fills in what is missing. Parts can be restored in any order.
 */
import { File, Paths } from 'expo-file-system';
import JSZip from 'jszip';

import { deviceId, setSetting } from '@/db';
import type { Attachment } from '@/db/types';
import { nowIso } from '@/lib/dates';
import { reportError } from '@/lib/errors';

import { applyBundle, BUNDLE_FORMAT, BUNDLE_VERSION, collectAll, filesOf, readFileBytes, sha256Hex, type Bundle, type ImportPlan } from './bundle';
import { fileFor, sha256 } from './files';
import { decodeUtf8, encodeUtf8 } from './utf8';

const PART_LIMIT = 40 * 1024 * 1024;
const MANIFEST = 'bluemoon-backup.json';

interface Manifest {
  format: 'bluemoon-backup';
  version: number;
  created_at: string;
  device_id: string;
  part: number;
  parts: number;
  data_sha256: string;
}

export async function makeBackup(onProgress?: (part: number, parts: number) => void): Promise<File[]> {
  const tables = collectAll();
  const bundle: Bundle = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    kind: 'backup',
    exported_at: nowIso(),
    device_id: deviceId(),
    tables,
  };
  const data = encodeUtf8(JSON.stringify(bundle));
  const dataHash = await sha256Hex(data);

  // Split photos into parts by size.
  // Skip files whose bytes no longer match their row, so one bad photo cannot poison every backup.
  const files: Attachment[] = [];
  for (const f of filesOf(tables)) {
    if ((await sha256(fileFor(f))) === f.sha256) files.push(f);
    else reportError(new Error('attachment does not match its hash'), 'makeBackup', { file: f.file_name });
  }
  const groups: Attachment[][] = [[]];
  let size = data.byteLength;
  for (const f of files) {
    if (size + f.size > PART_LIMIT && groups[groups.length - 1].length) {
      groups.push([]);
      size = data.byteLength;
    }
    groups[groups.length - 1].push(f);
    size += f.size;
  }

  const stamp = nowIso().slice(0, 16).replace(/[:T]/g, '-');
  const out: File[] = [];
  for (let i = 0; i < groups.length; i++) {
    onProgress?.(i + 1, groups.length);
    const zip = new JSZip();
    const manifest: Manifest = {
      format: 'bluemoon-backup',
      version: BUNDLE_VERSION,
      created_at: bundle.exported_at,
      device_id: bundle.device_id,
      part: i + 1,
      parts: groups.length,
      data_sha256: dataHash,
    };
    zip.file(MANIFEST, JSON.stringify(manifest, null, 2));
    zip.file('data.json', data);
    for (const att of groups[i]) zip.file(`attachments/${att.file_name}`, readFileBytes(att));

    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
    const suffix = groups.length > 1 ? `-part${i + 1}of${groups.length}` : '';
    const file = new File(Paths.cache, `Bluemoon-backup-${stamp}${suffix}.zip`);
    if (file.exists) file.delete();
    file.create();
    file.writeSync(bytes);
    out.push(file);
  }
  return out;
}

/**
 * All records, no photos, compressed. Used for the daily automatic backup:
 * small enough to keep 25 days of them and to fit Android's Google backup.
 */
export async function dataSnapshot(): Promise<Uint8Array> {
  const bundle: Bundle = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    kind: 'backup',
    exported_at: nowIso(),
    device_id: deviceId(),
    tables: collectAll(),
  };
  const data = encodeUtf8(JSON.stringify(bundle));
  const manifest: Manifest = {
    format: 'bluemoon-backup',
    version: BUNDLE_VERSION,
    created_at: bundle.exported_at,
    device_id: bundle.device_id,
    part: 1,
    parts: 1,
    data_sha256: await sha256Hex(data),
  };
  const zip = new JSZip();
  zip.file(MANIFEST, JSON.stringify(manifest, null, 2));
  zip.file('data.json', data);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** Re-open a written backup and check its data against the stored SHA-256. */
export async function verifyBackup(bytes: Uint8Array): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const manifest: Manifest = JSON.parse((await zip.file(MANIFEST)?.async('string')) ?? '{}');
    const data = await zip.file('data.json')?.async('uint8array');
    return !!data && (await sha256Hex(data)) === manifest.data_sha256;
  } catch {
    return false;
  }
}

export function markBackedUp() {
  setSetting('last_backup_at', nowIso());
}

export class BackupError extends Error {}

/** Restore one backup part. Returns what changed. */
export async function restorePart(uri: string): Promise<{ plan: ImportPlan; photos: number; part: number; parts: number }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await new File(uri).bytes());
  } catch {
    throw new BackupError('not-zip');
  }
  const mf = zip.file(MANIFEST);
  if (!mf) throw new BackupError('not-backup');
  const manifest: Manifest = JSON.parse(await mf.async('string'));
  if (manifest.format !== 'bluemoon-backup') throw new BackupError('not-backup');
  if (manifest.version > BUNDLE_VERSION) throw new BackupError('newer');

  const files = new Map<string, Uint8Array>();
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir && entry.name.startsWith('attachments/')) {
      files.set(entry.name.slice('attachments/'.length), await entry.async('uint8array'));
    }
  }

  const dataEntry = zip.file('data.json');
  if (!dataEntry) throw new BackupError('damaged');
  const data = await dataEntry.async('uint8array');
  if ((await sha256Hex(data)) !== manifest.data_sha256) throw new BackupError('damaged');
  const bundle: Bundle = JSON.parse(decodeUtf8(data));
  const plan = await applyBundle(bundle.tables, files);
  return { plan, photos: files.size, part: manifest.part, parts: manifest.parts };
}
