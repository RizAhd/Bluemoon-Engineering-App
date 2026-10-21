/**
 * Photos and PDFs live in the app's permanent documents folder (never the cache,
 * which Android may clear). Each file has an `attachments` row with its size and
 * SHA-256, so a backup or import can prove the file arrived intact.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { getDb, newId, remove, save } from '@/db';
import type { Attachment } from '@/db/types';

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
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled) return 0;

  let n = 0;
  for (const asset of res.assets) {
    const small = await compress(asset.uri, asset.width, asset.height);
    await store(ownerTable, ownerId, small, 'photo', 'jpg', 'image/jpeg');
    n++;
  }
  return n;
}

/** Attach any file (e.g. a PDF someone sent) to a record. */
export async function addFile(ownerTable: string, ownerId: string, uri: string, mime: string): Promise<string> {
  const isPdf = mime === 'application/pdf' || uri.toLowerCase().endsWith('.pdf');
  return store(ownerTable, ownerId, uri, isPdf ? 'pdf' : 'file', isPdf ? 'pdf' : 'bin', isPdf ? 'application/pdf' : mime);
}

/** Save raw bytes (from an imported PDF or backup) as an attachment with a known id. */
export function writeAttachmentBytes(fileName: string, bytes: Uint8Array) {
  const f = new File(attachmentsDir(), fileName);
  if (f.exists) f.delete();
  f.create();
  f.writeSync(bytes);
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
