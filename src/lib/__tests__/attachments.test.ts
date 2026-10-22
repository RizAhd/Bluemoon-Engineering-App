/**
 * Photos and PDFs: stored in the permanent documents folder with a row that records size and
 * SHA-256; taken with the camera or picked; recovered when Android killed the app; hidden, never
 * deleted, when the record they belong to goes away.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { all, first, getSetting, newId, setSetting } from '@/db';
import { saveExpense, saveProject } from '@/db/repo';
import type { Attachment } from '@/db/types';
import { readErrorLog } from '@/lib/errors';
import { addFile, addPhotos, attachmentsDir, discardOrphans, fileFor, recoverPendingPhoto, removeAttachment, sha256 } from '@/lib/files';
import {
  fakePhoto,
  queuePhotos,
  queuePickerCancel,
  resetDb,
  setCameraPermission,
  setPendingCameraResult,
  silenceConsoleError,
} from '@/test-utils';
import { resetPicker } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

let project: string;

beforeEach(() => {
  jest.clearAllMocks(); // forget the picker calls of earlier tests (implementations are kept)
  resetPicker();
  resetDb();
  project = saveProject({ name: 'Welimada school' });
});

const rows = (where = '1=1', params: string[] = []) => all<Attachment>(`SELECT * FROM attachments WHERE ${where} ORDER BY created_at, id`, params);
const liveFor = (table: string, id: string) => rows('owner_table = ? AND owner_id = ? AND deleted_at IS NULL', [table, id]);

describe('addPhotos', () => {
  it('stores each picked photo: a file in the documents folder and a row with its size and SHA-256', async () => {
    queuePhotos(3);
    expect(await addPhotos('projects', project, 'gallery')).toBe(3);
    const atts = liveFor('projects', project);
    expect(atts).toHaveLength(3);
    for (const att of atts) {
      expect(att).toMatchObject({ kind: 'photo', mime: 'image/jpeg', owner_table: 'projects', owner_id: project, version: 1 });
      expect(att.file_name).toMatch(/^[0-9a-f-]{36}\.jpg$/);
      expect(att.file_name.replace('.jpg', '')).toBe(att.id); // the file is named after its row
      const f = fileFor(att);
      expect(f.exists).toBe(true);
      expect(f.parentDirectory.uri).toBe(attachmentsDir().uri);
      expect(f.uri.startsWith(Paths.document.uri)).toBe(true);
      expect(att.size).toBe(f.size);
      expect(att.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(await sha256(f)).toBe(att.sha256);
    }
    expect(new Set(atts.map((a) => a.sha256)).size).toBe(3);
  });

  it('records the insert in the audit log', async () => {
    queuePhotos(1);
    await addPhotos('projects', project, 'gallery');
    const att = rows()[0];
    expect(all('SELECT table_name, action FROM audit_log WHERE row_id = ?', [att.id])).toEqual([{ table_name: 'attachments', action: 'insert' }]);
  });

  it('does not touch the original: the compressed copy is what is kept', async () => {
    const [asset] = queuePhotos(1);
    await addPhotos('projects', project, 'gallery');
    expect(new File(asset.uri).exists).toBe(true);
    expect(rows()[0].file_name).not.toBe(asset.fileName);
  });

  it('a cancelled picker adds nothing and leaves nothing behind', async () => {
    queuePickerCancel();
    expect(await addPhotos('projects', project, 'gallery')).toBe(0);
    queuePickerCancel();
    expect(await addPhotos('projects', project, 'camera')).toBe(0);
    expect(rows()).toEqual([]);
    expect(attachmentsDir().list()).toEqual([]);
    expect(getSetting('pending_camera')).toBeNull();
  });

  it('the camera is refused without permission: nothing stored, nothing pending, a message the app can translate', async () => {
    setCameraPermission(false);
    await expect(addPhotos('projects', project, 'camera')).rejects.toThrow('camera-permission');
    expect(getSetting('pending_camera')).toBeNull();
    expect(rows()).toEqual([]);
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('remembers which record the camera photo is for while the camera is open, and forgets once it is stored', async () => {
    let during: string | null = null;
    (ImagePicker.launchCameraAsync as jest.Mock).mockImplementationOnce(async () => {
      during = getSetting('pending_camera');
      return { canceled: false, assets: [fakePhoto()] };
    });
    expect(await addPhotos('expenses', 'some-expense-id', 'camera')).toBe(1);
    expect(JSON.parse(during as unknown as string)).toEqual({ table: 'expenses', id: 'some-expense-id' });
    expect(getSetting('pending_camera')).toBeNull();
  });

  it('the gallery asks for several photos, the camera for one', async () => {
    queuePickerCancel();
    await addPhotos('projects', project, 'gallery');
    expect((ImagePicker.launchImageLibraryAsync as jest.Mock).mock.calls.at(-1)?.[0]).toMatchObject({ allowsMultipleSelection: true, selectionLimit: 10, exif: false });
    queuePickerCancel();
    await addPhotos('projects', project, 'camera');
    expect((ImagePicker.launchCameraAsync as jest.Mock).mock.calls.at(-1)?.[0]).toMatchObject({ allowsMultipleSelection: false, exif: false });
  });

  it('a photo whose file has vanished fails loudly and stores no row', async () => {
    const [asset] = queuePhotos(1);
    new File(asset.uri).delete();
    await expect(addPhotos('projects', project, 'gallery')).rejects.toThrow();
    expect(rows()).toEqual([]);
    expect(attachmentsDir().list()).toEqual([]);
  });
});

describe('recoverPendingPhoto (Android killed the app while the camera was open)', () => {
  it('does nothing when no photo was pending', async () => {
    expect(await recoverPendingPhoto()).toBe(0);
    expect(rows()).toEqual([]);
  });

  it('attaches the photo that was taken to the record it was meant for', async () => {
    const expense = saveExpense({ project_id: project, day: '2026-10-20', category: 'materials', amount_cents: 1_000, method: 'cash' });
    setSetting('pending_camera', JSON.stringify({ table: 'expenses', id: expense }));
    setPendingCameraResult([fakePhoto(), fakePhoto()]);
    expect(await recoverPendingPhoto()).toBe(2);
    expect(liveFor('expenses', expense)).toHaveLength(2);
    expect(getSetting('pending_camera')).toBeNull();
    expect(await recoverPendingPhoto()).toBe(0); // only once
  });

  it('hides the photo again when the new record was never saved (and keeps the row for history)', async () => {
    const formId = newId();
    setSetting('pending_camera', JSON.stringify({ table: 'expenses', id: formId }));
    setPendingCameraResult([fakePhoto()]);
    expect(await recoverPendingPhoto()).toBe(1);
    expect(liveFor('expenses', formId)).toEqual([]);
    expect(rows('owner_id = ?', [formId])).toHaveLength(1);
  });

  it('a camera that was cancelled leaves nothing and clears the marker', async () => {
    setSetting('pending_camera', JSON.stringify({ table: 'projects', id: project }));
    setPendingCameraResult(null);
    expect(await recoverPendingPhoto()).toBe(0);
    expect(getSetting('pending_camera')).toBeNull();
  });

  it('an unreadable result is logged, returns 0, and does not crash the start of the app', async () => {
    setSetting('pending_camera', JSON.stringify({ table: 'projects', id: project }));
    const gone = fakePhoto();
    new File(gone.uri).delete();
    setPendingCameraResult([gone]);
    const mute = silenceConsoleError();
    expect(await recoverPendingPhoto()).toBe(0);
    mute.mockRestore();
    expect(readErrorLog()).toContain('recoverPendingPhoto');
    expect(getSetting('pending_camera')).toBeNull();
  });

  it('damaged marker text does not crash either', async () => {
    setSetting('pending_camera', '{not json');
    setPendingCameraResult([fakePhoto()]);
    const mute = silenceConsoleError();
    expect(await recoverPendingPhoto()).toBe(0);
    mute.mockRestore();
    expect(getSetting('pending_camera')).toBeNull();
  });
});

describe('addFile', () => {
  const source = (name: string, text = 'file contents') => {
    const f = new File(Paths.cache, name);
    f.create();
    f.writeSync(text);
    return f;
  };

  it('keeps a PDF as a pdf, by its mime type or by its extension', async () => {
    const a = await addFile('projects', project, source('quote.bin').uri, 'application/pdf');
    const b = await addFile('projects', project, source('Contract.PDF').uri, 'application/octet-stream');
    const [x, y] = [a, b].map((id) => first<Attachment>('SELECT * FROM attachments WHERE id = ?', [id]) as Attachment);
    expect(x).toMatchObject({ kind: 'pdf', mime: 'application/pdf', file_name: `${a}.pdf` });
    expect(y).toMatchObject({ kind: 'pdf', mime: 'application/pdf', file_name: `${b}.pdf` });
  });

  it('keeps anything else as a generic file with its own mime type', async () => {
    const id = await addFile('projects', project, source('sheet.xlsx', 'cells').uri, 'application/vnd.ms-excel');
    expect(first('SELECT kind, mime, file_name, size FROM attachments WHERE id = ?', [id])).toEqual({ kind: 'file', mime: 'application/vnd.ms-excel', file_name: `${id}.bin`, size: 5 });
  });

  it('copies the bytes exactly and leaves the source where it was', async () => {
    const src = source('letter.pdf', 'Dear Sir, ...');
    const id = await addFile('projects', project, src.uri, 'application/pdf');
    const att = first<Attachment>('SELECT * FROM attachments WHERE id = ?', [id]) as Attachment;
    expect(fileFor(att).textSync()).toBe('Dear Sir, ...');
    expect(await sha256(fileFor(att))).toBe(att.sha256);
    expect(src.exists).toBe(true);
  });

  it('a source that cannot be read stores no row', async () => {
    const mute = silenceConsoleError();
    await expect(addFile('projects', project, new File(Paths.cache, 'missing.pdf').uri, 'application/pdf')).rejects.toThrow();
    mute.mockRestore();
    expect(rows()).toEqual([]);
  });
});

describe('hiding and discarding', () => {
  it('discardOrphans hides the photos of a record that does not exist, and only those', async () => {
    const formId = newId();
    queuePhotos(2);
    await addPhotos('expenses', formId, 'gallery');
    queuePhotos(1);
    await addPhotos('projects', project, 'gallery');

    discardOrphans('expenses', formId);
    discardOrphans('projects', project); // exists: untouched

    expect(liveFor('expenses', formId)).toEqual([]);
    expect(liveFor('projects', project)).toHaveLength(1);
    expect(rows()).toHaveLength(3); // nothing removed
    for (const att of rows('owner_id = ?', [formId])) expect(fileFor(att).exists).toBe(true); // and the files stay
  });

  it('is harmless when run twice', async () => {
    const formId = newId();
    queuePhotos(1);
    await addPhotos('expenses', formId, 'gallery');
    discardOrphans('expenses', formId);
    const state = rows();
    discardOrphans('expenses', formId);
    expect(rows()).toEqual(state);
  });

  it('removeAttachment hides the photo from the record but keeps the row and the file', async () => {
    queuePhotos(1);
    await addPhotos('projects', project, 'gallery');
    const att = rows()[0];
    removeAttachment(att.id);
    expect(liveFor('projects', project)).toEqual([]);
    expect(first('SELECT deleted_at IS NOT NULL AS gone, version FROM attachments WHERE id = ?', [att.id])).toEqual({ gone: 1, version: 2 });
    expect(fileFor(att).exists).toBe(true);
  });
});

describe('the attachments folder', () => {
  it('is created on first use, lives in the documents folder and is not recreated over existing photos', async () => {
    expect(attachmentsDir().exists).toBe(true);
    expect(attachmentsDir().uri).toBe(new Directory(Paths.document, 'attachments').uri);
    queuePhotos(1);
    await addPhotos('projects', project, 'gallery');
    const before = attachmentsDir().list().map((e) => e.name);
    expect(attachmentsDir().list().map((e) => e.name)).toEqual(before);
    expect(before).toHaveLength(1);
  });
});
