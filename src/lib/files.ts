/**
 * Photos and PDFs live in the app's permanent documents folder (never the cache,
 * which Android may clear). Each file has an `attachments` row with its size and
 * SHA-256, so a backup or import can prove the file arrived intact.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { getDb, getSetting, newId, remove, save, setSetting } from '@/db';
import type { Attachment } from '@/db/types';

import { reportError } from './errors';

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.72;

export function attachmentsDir(): Directory {
  const dir = new Directory(Paths.document, 'attachments');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function fileFor(att: Pick<Attachment, 'file_name'>): File {
  return new File(attachmentsDir(), att.file_name);
}

export async function sha256(file: File): Promise<string> {
  return (await file.digest('SHA-256')).toLowerCase();
}

/** Shrink a camera photo to ~250 KB JPEG so storage and backups stay small. */
async function compress(uri: string, width?: number, height?: number): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  const longest = Math.max(width ?? 0, height ?? 0);
  if (!longest || longest > MAX_EDGE) {
    if ((width ?? 1) >= (height ?? 0)) ctx.resize({ width: MAX_EDGE });
    else ctx.resize({ height: MAX_EDGE });
  }
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return out.uri;
}

async function store(
  ownerTable: string,
  ownerId: string,
  sourceUri: string,
  kind: Attachment['kind'],
  ext: string,
  mime: string,
): Promise<string> {
  const id = newId();
  const fileName = `${id}.${ext}`;
  const dest = new File(attachmentsDir(), fileName);
  new File(sourceUri).copySync(dest);
  const hash = await sha256(dest);
  return save('attachments', {
    id,
    owner_table: ownerTable,
    owner_id: ownerId,
    kind,
    file_name: fileName,
    mime,
    size: dest.size ?? 0,
    sha256: hash,
  });
}

export type PhotoSource = 'camera' | 'gallery';

/** Take or pick photos, compress and attach them. Returns how many were added. */
export async function addPhotos(ownerTable: string, ownerId: string, source: PhotoSource): Promise<number> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('camera-permission');
  }
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.9,
    exif: false,
    allowsMultipleSelection: source === 'gallery',
    selectionLimit: 10,
  };
  // Android may destroy this activity while the camera app is open; remember the owner so
  // recoverPendingPhoto() can attach the photo after the restart.
  if (source === 'camera') setSetting('pending_camera', JSON.stringify({ table: ownerTable, id: ownerId }));
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (source === 'camera') setSetting('pending_camera', null);
  if (res.canceled) return 0;
  return storeAssets(ownerTable, ownerId, res.assets);
}

async function storeAssets(ownerTable: string, ownerId: string, assets: ImagePicker.ImagePickerAsset[]): Promise<number> {
  let n = 0;
  for (const asset of assets) {
    const small = await compress(asset.uri, asset.width, asset.height);
    await store(ownerTable, ownerId, small, 'photo', 'jpg', 'image/jpeg');
    n++;
  }
  return n;
}

/**
 * If the app was killed while the camera was open, attach the photo that was
 * taken to the record it was meant for. Returns how many photos were recovered.
 * A photo whose record no longer exists is stored but hidden (discardOrphans).
 */
export async function recoverPendingPhoto(): Promise<number> {
  const raw = getSetting('pending_camera');
  if (!raw) return 0;
  try {
    const pending = await ImagePicker.getPendingResultAsync();
    setSetting('pending_camera', null);
    if (!pending || !('assets' in pending) || pending.canceled || !pending.assets?.length) return 0;
    const owner = JSON.parse(raw) as { table: string; id: string };
    const n = await storeAssets(owner.table, owner.id, pending.assets);
    // A brand-new record that was never saved has no row: hide its photos again.
    discardOrphans(owner.table, owner.id);
    return n;
  } catch (e) {
    reportError(e, 'recoverPendingPhoto');
    return 0;
  }
}

/** Attach any file (e.g. a PDF someone sent) to a record. */
export async function addFile(ownerTable: string, ownerId: string, uri: string, mime: string): Promise<string> {
  const isPdf = mime === 'application/pdf' || uri.toLowerCase().endsWith('.pdf');
  return store(ownerTable, ownerId, uri, isPdf ? 'pdf' : 'file', isPdf ? 'pdf' : 'bin', isPdf ? 'application/pdf' : mime);
}

/** Save raw bytes (from an imported PDF or backup) as an attachment with a known id. */
export function writeAttachmentBytes(fileName: string, bytes: Uint8Array) {
  // Write under a temp name and rename, so a kill mid-write never leaves a truncated file.
  const tmp = new File(attachmentsDir(), `${fileName}.tmp`);
  if (tmp.exists) tmp.delete();
  tmp.create();
  tmp.writeSync(bytes);
  const f = new File(attachmentsDir(), fileName);
  if (f.exists) f.delete();
  tmp.moveSync(f);
}

export function removeAttachment(id: string) {
  remove('attachments', id);
}

/**
 * A new-record form attaches photos before the record itself is saved.
 * If the user backs out, hide those orphan photos again.
 */
export function discardOrphans(ownerTable: string, ownerId: string) {
  const exists = getDb().getFirstSync(`SELECT 1 AS ok FROM ${ownerTable} WHERE id = ?`, [ownerId]);
  if (exists) return;
  const rows = getDb().getAllSync<{ id: string }>(
    'SELECT id FROM attachments WHERE owner_table = ? AND owner_id = ? AND deleted_at IS NULL',
    [ownerTable, ownerId],
  );
  rows.forEach((r) => remove('attachments', r.id));
}
