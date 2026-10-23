/**
 * Google Drive backup.
 *
 * The owner signs in with their Google account once (Settings → Backup → Google Drive). The app asks only for
 * the `drive.file` permission: it can see and change the files it made itself, nothing else in the Drive.
 * Every daily snapshot (and every full backup) is then uploaded to a "Bluemoon Site Backups" folder whenever
 * there is internet; with no signal it simply tries again the next time the app opens. The 30 newest
 * snapshots are kept on Drive; full backups are never deleted by the app.
 *
 * Sign-in needs the app registered in the owner's Google Cloud project (an Android OAuth client with this
 * package name and the signing key's SHA-1). Until that is done, Connect answers with "not set up yet".
 */
import { getSetting, setSetting } from '@/db';
import { nowIso } from '@/lib/dates';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
export const DRIVE_FOLDER = 'Bluemoon Site Backups';
/** Snapshots kept on Drive. */
export const DRIVE_KEEP = 30;
const AUTO_PREFIX = 'Bluemoon-auto-';

type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');

/** The native module, or null where it is not built in (Expo Go, tests without a mock). */
function google(): GoogleSignInModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-google-signin/google-signin') as GoogleSignInModule;
  } catch {
    return null;
  }
}

let configured = false;
function client() {
  const g = google();
  if (!g) throw new DriveError('unavailable');
  if (!configured) {
    g.GoogleSignin.configure({ scopes: [SCOPE] });
    configured = true;
  }
  return g;
}

/** Why a Drive step failed, in words the screen can show. */
export class DriveError extends Error {
  constructor(public reason: 'unavailable' | 'notSetUp' | 'cancelled' | 'noPlayServices' | 'offline' | 'denied' | 'failed', detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
  }
}

export interface DriveStatus {
  email: string | null;
  lastAt: string | null;
  error: string | null;
}

export function driveStatus(): DriveStatus {
  return { email: getSetting('drive_email'), lastAt: getSetting('drive_last_at'), error: getSetting('drive_error') };
}

export const driveConnected = () => !!getSetting('drive_email');

function translate(e: unknown): DriveError {
  if (e instanceof DriveError) return e;
  const g = google();
  const code = (e as { code?: string | number } | null)?.code;
  if (g) {
    if (code === g.statusCodes.SIGN_IN_CANCELLED) return new DriveError('cancelled');
    if (code === g.statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return new DriveError('noPlayServices');
  }
  // DEVELOPER_ERROR (10): this package + signing key is not registered as an OAuth client yet
  if (code === '10' || code === 10 || /DEVELOPER_ERROR/.test(String((e as Error)?.message))) return new DriveError('notSetUp');
  if (/network|Network request failed|timeout/i.test(String((e as Error)?.message))) return new DriveError('offline');
  return new DriveError('failed', e instanceof Error ? e.message : String(e));
}

/** Opens Google's account chooser; on success the account is remembered. Returns false when the owner backs out. */
export async function connectDrive(): Promise<boolean> {
  try {
    const g = client();
    await g.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await g.GoogleSignin.signIn();
    if (res.type !== 'success') return false;
    setSetting('drive_email', res.data.user.email);
    setSetting('drive_error', null);
    setSetting('drive_folder_id', null);
    return true;
  } catch (e) {
    const err = translate(e);
    if (err.reason === 'cancelled') return false;
    throw err;
  }
}

export async function disconnectDrive() {
  try {
    const g = google();
    if (g) await g.GoogleSignin.signOut();
  } catch {
    // signed out locally either way
  }
  for (const k of ['drive_email', 'drive_last_at', 'drive_error', 'drive_folder_id', 'drive_auto_day']) setSetting(k, null);
}

async function token(): Promise<string> {
  const g = client();
  if (!g.GoogleSignin.hasPreviousSignIn()) throw new DriveError('denied');
  if (!g.GoogleSignin.getCurrentUser()) {
    const res = await g.GoogleSignin.signInSilently();
    if (res.type !== 'success') throw new DriveError('denied');
  }
  return (await g.GoogleSignin.getTokens()).accessToken;
}

async function call(url: string, init: RequestInit, auth: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${auth}` } });
  } catch (e) {
    throw new DriveError('offline', e instanceof Error ? e.message : String(e));
  }
  if (res.status === 401 || res.status === 403) {
    // an expired token: let Google mint a new one next time
    try {
      await client().GoogleSignin.clearCachedAccessToken(auth);
    } catch {
      // ignore
    }
    throw new DriveError('denied', `${res.status}`);
  }
  if (!res.ok) throw new DriveError('failed', `${res.status} ${await res.text().catch(() => '')}`.trim());
  return res;
}

const q = (s: string) => encodeURIComponent(s);

/** The app's backup folder on Drive, created the first time. */
async function folderId(auth: string): Promise<string> {
  const known = getSetting('drive_folder_id');
  if (known) return known;
  const search = `name='${DRIVE_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const found = (await (await call(`${API}/files?q=${q(search)}&fields=files(id)&spaces=drive`, { method: 'GET' }, auth)).json()) as { files: { id: string }[] };
  let id = found.files[0]?.id;
  if (!id) {
    const made = await call(
      `${API}/files?fields=id`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder' }) },
      auth,
    );
    id = ((await made.json()) as { id: string }).id;
  }
  setSetting('drive_folder_id', id);
  return id;
}

/**
 * Uploads `bytes` as `name` into the backup folder (a resumable upload: Drive gives a session address, the
 * bytes go to it in one PUT), replacing an older file of the same name. Records the time, or the error.
 */
export async function uploadToDrive(name: string, bytes: Uint8Array, mime = 'application/zip'): Promise<void> {
  try {
    const auth = await token();
    const parent = await folderId(auth);
    const existing = (await (
      await call(`${API}/files?q=${q(`name='${name}' and '${parent}' in parents and trashed=false`)}&fields=files(id)`, { method: 'GET' }, auth)
    ).json()) as { files: { id: string }[] };

    const session = await call(
      `${UPLOAD}?uploadType=resumable`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(bytes.byteLength) },
        body: JSON.stringify({ name, parents: [parent] }),
      },
      auth,
    );
    const where = session.headers.get('location') ?? session.headers.get('Location');
    if (!where) throw new DriveError('failed', 'no upload session');
    const body = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
    await call(where, { method: 'PUT', headers: { 'Content-Type': mime }, body: body as ArrayBuffer }, auth);

    // the new copy is safely up: only now remove the older one of the same name
    for (const f of existing.files) await call(`${API}/files/${f.id}`, { method: 'DELETE' }, auth).catch(() => undefined);
    setSetting('drive_last_at', nowIso());
    setSetting('drive_error', null);
    if (name.startsWith(AUTO_PREFIX)) await trimDrive(auth, parent).catch(() => undefined);
  } catch (e) {
    const err = translate(e);
    setSetting('drive_error', `${nowIso()} ${err.reason}`);
    throw err;
  }
}

/** Keeps the newest DRIVE_KEEP snapshots in the folder. */
async function trimDrive(auth: string, parent: string) {
  const list = (await (
    await call(`${API}/files?q=${q(`'${parent}' in parents and name contains '${AUTO_PREFIX}' and trashed=false`)}&orderBy=name desc&fields=files(id,name)&pageSize=200`, { method: 'GET' }, auth)
  ).json()) as { files: { id: string; name: string }[] };
  for (const f of list.files.slice(DRIVE_KEEP)) await call(`${API}/files/${f.id}`, { method: 'DELETE' }, auth).catch(() => undefined);
}

/** Uploads today's snapshot once a day while Drive is connected. Never throws; returns what happened. */
export async function uploadSnapshotIfDue(day: string, name: string, read: () => Uint8Array): Promise<'done' | 'skipped' | 'failed'> {
  if (!driveConnected()) return 'skipped';
  if (getSetting('drive_auto_day') === day) return 'skipped';
  try {
    await uploadToDrive(name, read());
    setSetting('drive_auto_day', day);
    return 'done';
  } catch {
    return 'failed';
  }
}
