/**
 * Copies of the backups outside the app: the owner's phone folder (picked once, kept 30 snapshots) and
 * Google Drive (signed in once, the day's snapshot uploaded once a day, 30 kept). Each copy is best effort:
 * a failure is recorded and tried again, and never stops the backup itself.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { getSetting, setSetting } from '@/db';
import { saveProject } from '@/db/repo';
import { backupsDir, mirrorTodaysSnapshot, runAutoBackupIfDue } from '@/lib/autoBackup';
import { connectDrive, disconnectDrive, DriveError, driveStatus, uploadSnapshotIfDue, uploadToDrive } from '@/lib/drive';
import { copyToPhoneFolder, folderName, FOLDER_KEEP, forgetPhoneFolder, phoneFolderStatus, pickPhoneFolder } from '@/lib/phoneFolder';
import { resetDb } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

// ---------------------------------------------------------------- Google sign-in, faked
const mockSignin = {
  configure: jest.fn(),
  hasPlayServices: jest.fn(async () => true),
  signIn: jest.fn(async () => ({ type: 'success', data: { user: { email: 'owner@gmail.com' } } })),
  signInSilently: jest.fn(async () => ({ type: 'success', data: { user: { email: 'owner@gmail.com' } } })),
  signOut: jest.fn(async () => null),
  hasPreviousSignIn: jest.fn(() => true),
  getCurrentUser: jest.fn(() => ({ user: { email: 'owner@gmail.com' } })),
  getTokens: jest.fn(async () => ({ accessToken: 'tok', idToken: '' })),
  clearCachedAccessToken: jest.fn(async () => null),
};
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: mockSignin,
  statusCodes: { SIGN_IN_CANCELLED: '12501', PLAY_SERVICES_NOT_AVAILABLE: '2', IN_PROGRESS: '12502' },
}));

// ---------------------------------------------------------------- the Drive REST API, faked
interface DriveFile {
  id: string;
  name: string;
  parent?: string;
  folder?: boolean;
  bytes?: number;
}
let drive: DriveFile[] = [];
let nextId = 1;
let offline = false;
const calls: string[] = [];

function reply(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status < 400,
    status,
    headers: { get: (k: string) => init.headers?.[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function query(url: string) {
  const q = decodeURIComponent(new URL(url).searchParams.get('q') ?? '');
  return drive.filter((f) => {
    const name = /name='([^']+)'/.exec(q)?.[1];
    const contains = /name contains '([^']+)'/.exec(q)?.[1];
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    if (q.includes("mimeType='application/vnd.google-apps.folder'") && !f.folder) return false;
    if (name && f.name !== name) return false;
    if (contains && !f.name.includes(contains)) return false;
    if (parent && f.parent !== parent) return false;
    return true;
  });
}

const pendingUploads = new Map<string, { name: string; parent: string }>();

global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  calls.push(`${method} ${url.split('?')[0]}`);
  if (offline) throw new TypeError('Network request failed');
  if (method === 'GET' && url.includes('/drive/v3/files?')) {
    let files = query(url);
    if (url.includes('orderBy=name%20desc') || url.includes('orderBy=name desc')) files = [...files].sort((a, b) => b.name.localeCompare(a.name));
    return reply({ files: files.map(({ id, name }) => ({ id, name })) });
  }
  if (method === 'POST' && url.includes('/drive/v3/files?fields=id')) {
    const meta = JSON.parse(String(init?.body)) as { name: string };
    const f = { id: `f${nextId++}`, name: meta.name, folder: true };
    drive.push(f);
    return reply({ id: f.id });
  }
  if (method === 'POST' && url.includes('uploadType=resumable')) {
    const meta = JSON.parse(String(init?.body)) as { name: string; parents: string[] };
    if (!drive.some((f) => f.folder && f.id === meta.parents[0])) return reply({ error: 'File not found' }, { status: 404 });
    const session = `https://upload.example/session/${nextId++}`;
    pendingUploads.set(session, { name: meta.name, parent: meta.parents[0] });
    return reply({}, { headers: { location: session } });
  }
  if (method === 'PUT' && pendingUploads.has(url)) {
    const up = pendingUploads.get(url)!;
    drive.push({ id: `f${nextId++}`, name: up.name, parent: up.parent, bytes: (init?.body as ArrayBuffer).byteLength });
    return reply({ id: 'x' });
  }
  if (method === 'DELETE') {
    const id = url.split('/files/')[1];
    drive = drive.filter((f) => f.id !== id);
    return reply({});
  }
  return reply({ error: 'unexpected' }, { status: 500 });
}) as typeof fetch;

let clock: ReturnType<typeof useClock>;
beforeEach(() => {
  resetDb();
  clock = useClock(new Date(2026, 9, 22, 12, 0, 0));
  drive = [];
  nextId = 1;
  offline = false;
  calls.length = 0;
  jest.clearAllMocks();
  saveProject({ name: 'Test project' }); // an empty phone is never copied out (see "an empty phone" below)
});
afterEach(() => clock.restore());

function phoneFolder(): Directory {
  const d = new Directory(Paths.document, 'external', 'Documents', 'Bluemoon');
  d.create({ intermediates: true, idempotent: true });
  return d;
}

// ---------------------------------------------------------------- phone folder

describe('the phone folder', () => {
  it('shows a picked SAF folder by its readable path', () => {
    expect(folderName('content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FBluemoon')).toBe('Documents/Bluemoon');
    expect(folderName('content://com.android.externalstorage.documents/tree/1A2B-3C4D%3ABackups')).toBe('1A2B-3C4D/Backups');
  });

  it('is remembered when picked, forgotten when asked, and a cancelled pick changes nothing', async () => {
    expect(await pickPhoneFolder()).toBe(false);
    expect(phoneFolderStatus().uri).toBeNull();
    (Directory as unknown as { nextPick: Directory }).nextPick = phoneFolder();
    expect(await pickPhoneFolder()).toBe(true);
    expect(phoneFolderStatus().uri).toBe(phoneFolder().uri);
    forgetPhoneFolder();
    expect(phoneFolderStatus().uri).toBeNull();
  });

  it('gets a copy of the day\'s snapshot once a day, replacing a file of the same name', async () => {
    (Directory as unknown as { nextPick: Directory }).nextPick = phoneFolder();
    await pickPhoneFolder();
    expect(await runAutoBackupIfDue()).toBe('done');
    expect((await mirrorTodaysSnapshot()).folder).toBe('done');
    const copy = new File(phoneFolder(), 'Bluemoon-auto-2026-10-22.zip');
    expect(copy.exists).toBe(true);
    expect(copy.bytesSync()).toEqual(new File(backupsDir(), 'Bluemoon-auto-2026-10-22.zip').bytesSync());
    expect((await mirrorTodaysSnapshot()).folder).toBe('skipped'); // already copied today
    expect(getSetting('backup_folder_at')).not.toBeNull();
  });

  it('choosing another folder forgets the copy stamp, so today\'s snapshot is copied into the new folder', async () => {
    const first = phoneFolder();
    (Directory as unknown as { nextPick: Directory }).nextPick = first;
    await pickPhoneFolder();
    await runAutoBackupIfDue();
    expect((await mirrorTodaysSnapshot()).folder).toBe('done');
    expect(getSetting('backup_folder_of')).not.toBeNull();
    const second = new Directory(Paths.document, 'external', 'Documents', 'Other');
    second.create({ intermediates: true, idempotent: true });
    (Directory as unknown as { nextPick: Directory }).nextPick = second;
    await pickPhoneFolder();
    expect(getSetting('backup_folder_of')).toBeNull();
    expect((await mirrorTodaysSnapshot()).folder).toBe('done');
    expect(new File(second, 'Bluemoon-auto-2026-10-22.zip').exists).toBe(true);
  });

  it('a copy that fails half way leaves the good copy of the same day in the folder', () => {
    const dir = phoneFolder();
    setSetting('backup_folder_uri', dir.uri);
    dir.createFile('Bluemoon-auto-2026-10-22.zip', null).writeSync(new Uint8Array([1, 2, 3]));
    const write = jest.spyOn(File.prototype, 'writeSync').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    expect(() => copyToPhoneFolder('Bluemoon-auto-2026-10-22.zip', new Uint8Array([9, 9]))).toThrow('disk full');
    write.mockRestore();
    const kept = dir.list().filter((e) => e.name === 'Bluemoon-auto-2026-10-22.zip');
    expect(kept).toHaveLength(1);
    expect(Array.from((kept[0] as File).bytesSync())).toEqual([1, 2, 3]);
    expect(phoneFolderStatus().error).toContain('disk full');
  });

  it('an empty phone copies nothing out: an empty snapshot must never replace a good one', async () => {
    resetDb();
    const dir = phoneFolder();
    setSetting('backup_folder_uri', dir.uri);
    dir.createFile('Bluemoon-auto-2026-10-22.zip', null).writeSync(new Uint8Array([1, 2, 3]));
    setSetting('drive_email', 'owner@gmail.com'); // connected, as far as the app can tell (no sign-in needed here)
    expect(await runAutoBackupIfDue()).toBe('done');
    expect(await mirrorTodaysSnapshot()).toEqual({ folder: 'skipped', drive: 'skipped' });
    expect(Array.from((dir.list()[0] as File).bytesSync())).toEqual([1, 2, 3]);
    expect(calls.filter((c) => c.startsWith('PUT'))).toHaveLength(0);
  });

  it('keeps the newest 30 snapshots and leaves other files (full backups) alone', () => {
    const dir = phoneFolder();
    setSetting('backup_folder_uri', dir.uri);
    for (let d = 1; d <= FOLDER_KEEP + 3; d++) {
      const f = dir.createFile(`Bluemoon-auto-2026-08-${String(d).padStart(2, '0')}.zip`, null);
      f.writeSync(new Uint8Array([d]));
    }
    dir.createFile('Bluemoon-backup-2026-08-01.zip', null).writeSync(new Uint8Array([1]));
    copyToPhoneFolder('Bluemoon-auto-2026-10-22.zip', new Uint8Array([9]));
    const names = dir.list().map((e) => e.name);
    expect(names.filter((n) => n.startsWith('Bluemoon-auto-'))).toHaveLength(FOLDER_KEEP);
    expect(names).toContain('Bluemoon-auto-2026-10-22.zip');
    expect(names).not.toContain('Bluemoon-auto-2026-08-01.zip');
    expect(names).toContain('Bluemoon-backup-2026-08-01.zip');
  });

  it('a folder that is gone records the problem, and the backup itself still succeeds', async () => {
    const dir = phoneFolder();
    setSetting('backup_folder_uri', dir.uri);
    dir.delete();
    expect(await runAutoBackupIfDue()).toBe('done');
    expect((await mirrorTodaysSnapshot()).folder).toBe('failed');
    expect(phoneFolderStatus().error).not.toBeNull();
    expect(new File(backupsDir(), 'Bluemoon-auto-2026-10-22.zip').exists).toBe(true);
  });
});

// ---------------------------------------------------------------- Google Drive

describe('Google Drive', () => {
  it('connects once and remembers the account; disconnect forgets it', async () => {
    expect(await connectDrive()).toBe(true);
    expect(mockSignin.configure).toHaveBeenCalledWith({ scopes: ['https://www.googleapis.com/auth/drive.file'] });
    expect(driveStatus().email).toBe('owner@gmail.com');
    await disconnectDrive();
    expect(driveStatus().email).toBeNull();
    expect(mockSignin.signOut).toHaveBeenCalled();
  });

  it('a cancelled sign-in is not an error; an unregistered app says "not set up"', async () => {
    mockSignin.signIn.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { code: '12501' }));
    expect(await connectDrive()).toBe(false);
    mockSignin.signIn.mockRejectedValueOnce(Object.assign(new Error('DEVELOPER_ERROR'), { code: '10' }));
    await expect(connectDrive()).rejects.toMatchObject({ reason: 'notSetUp' });
    expect(driveStatus().email).toBeNull();
  });

  it('uploads into its own folder (made once), and replaces an older file of the same name', async () => {
    await connectDrive();
    await uploadToDrive('Bluemoon-auto-2026-10-22.zip', new Uint8Array([1, 2, 3]));
    await uploadToDrive('Bluemoon-auto-2026-10-22.zip', new Uint8Array([1, 2, 3, 4]));
    const folders = drive.filter((f) => f.folder);
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe('Bluemoon Site Backups');
    const files = drive.filter((f) => !f.folder);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: 'Bluemoon-auto-2026-10-22.zip', parent: folders[0].id, bytes: 4 });
    expect(driveStatus().lastAt).not.toBeNull();
  });

  it('keeps the newest 30 snapshots on Drive', async () => {
    await connectDrive();
    await uploadToDrive('Bluemoon-auto-2026-01-01.zip', new Uint8Array([1])); // makes the folder
    const parent = drive.find((f) => f.folder)!.id;
    for (let d = 1; d <= 31; d++) drive.push({ id: `old${d}`, name: `Bluemoon-auto-2026-08-${String(d).padStart(2, '0')}.zip`, parent });
    await uploadToDrive('Bluemoon-auto-2026-10-22.zip', new Uint8Array([1]));
    const left = drive.filter((f) => !f.folder).map((f) => f.name);
    expect(left).toHaveLength(30);
    expect(left).toContain('Bluemoon-auto-2026-10-22.zip');
    expect(left).not.toContain('Bluemoon-auto-2026-01-01.zip');
  });

  it('with no internet records it and tries again next time; once up, not again the same day', async () => {
    await connectDrive();
    expect(await runAutoBackupIfDue()).toBe('done');
    offline = true;
    expect((await mirrorTodaysSnapshot()).drive).toBe('failed');
    expect(driveStatus().error).toContain('offline');
    offline = false;
    expect((await mirrorTodaysSnapshot()).drive).toBe('done');
    expect(driveStatus().error).toBeNull();
    const uploads = calls.filter((c) => c.startsWith('PUT')).length;
    expect((await mirrorTodaysSnapshot()).drive).toBe('skipped');
    expect(calls.filter((c) => c.startsWith('PUT')).length).toBe(uploads);
  });

  it('a Drive folder that was deleted is made again, and the upload goes through', async () => {
    await connectDrive();
    await uploadToDrive('Bluemoon-auto-2026-10-21.zip', new Uint8Array([1]));
    const gone = drive.find((f) => f.folder)!.id;
    drive = drive.filter((f) => !f.folder); // the owner deleted the folder in Drive
    await uploadToDrive('Bluemoon-auto-2026-10-22.zip', new Uint8Array([2]));
    const folders = drive.filter((f) => f.folder);
    expect(folders).toHaveLength(1);
    expect(folders[0].id).not.toBe(gone);
    expect(drive.find((f) => f.name === 'Bluemoon-auto-2026-10-22.zip')?.parent).toBe(folders[0].id);
    expect(driveStatus().error).toBeNull();
  });

  it('"Drive is full" is its own message and does not ask the owner to sign in again', async () => {
    await connectDrive();
    (global.fetch as jest.Mock).mockResolvedValueOnce(reply({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, { status: 403 }));
    await expect(uploadToDrive('a.zip', new Uint8Array([1]))).rejects.toMatchObject({ reason: 'quota' });
    expect(driveStatus().error).toContain('quota');
    expect(mockSignin.clearCachedAccessToken).not.toHaveBeenCalled();
  });

  it('is skipped entirely while not connected', async () => {
    expect(await uploadSnapshotIfDue('2026-10-22', 'x.zip', () => new Uint8Array([1]))).toBe('skipped');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('a refused token is reported as "denied", so the owner is asked to connect again', async () => {
    await connectDrive();
    (global.fetch as jest.Mock).mockResolvedValueOnce(reply({}, { status: 401 }));
    await expect(uploadToDrive('a.zip', new Uint8Array([1]))).rejects.toBeInstanceOf(DriveError);
    expect(driveStatus().error).toContain('denied');
    expect(mockSignin.clearCachedAccessToken).toHaveBeenCalledWith('tok');
  });
});
