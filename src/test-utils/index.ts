/**
 * The test harness API. Import everything from '@/test-utils'.
 *
 *   resetDb()            fresh database + empty files on the main phone (call in beforeEach)
 *   seedDemo()           the demo data set on the main phone
 *   openSecondPhone()    an independent second phone (own database, own files)
 *   transfer(a, b, ...)  carry a project / everything from one phone to another
 *   mainPhone()          the main phone as a Phone object (same API as a second phone)
 *
 * Camera / gallery / document-picker doubles:
 *   fakePhoto(), queuePhotos(n), setCameraPermission(false), queueFilePick(uri)
 *
 * The native modules are replaced by setup.ts (wired in package.json), so a
 * test file needs no jest.mock() of its own. See the header of setup.ts.
 */
import { randomBytes } from 'node:crypto';

import { File, Paths } from './fakeFs';
import { mainPhone, type Phone } from './phones';
import { world } from './world';

export { Directory, File, Paths } from './fakeFs';
export {
  mainPhone,
  openPhone,
  openSecondPhone,
  Phone,
  resetDb,
  seedDemo,
  transfer,
  type OpenPhoneOptions,
  type ResetOptions,
} from './phones';

export interface FakePhotoAsset {
  uri: string;
  width: number;
  height: number;
  type: 'image';
  mimeType: 'image/jpeg';
  fileName: string;
  fileSize: number;
}

/**
 * Write a fake camera photo into a phone's cache and describe it like
 * expo-image-picker does. Every call has different bytes (so a different SHA-256)
 * unless you pass `bytes`.
 */
export function fakePhoto(options: { phone?: Phone; bytes?: Uint8Array } = {}): FakePhotoAsset {
  const phone = options.phone ?? mainPhone();
  return phone.run(() => {
    const dir = Paths.cache;
    const bytes = options.bytes ?? new Uint8Array(randomBytes(48));
    const file = new File(dir, `IMG_${Date.now()}_${randomBytes(4).toString('hex')}.jpg`);
    file.create();
    file.writeSync(bytes);
    return { uri: file.uri, width: 4000, height: 3000, type: 'image', mimeType: 'image/jpeg', fileName: file.name, fileSize: file.size };
  });
}

/** The next camera / gallery call returns `count` new photos (on `phone`, default main). */
export function queuePhotos(count = 1, options: { phone?: Phone } = {}): FakePhotoAsset[] {
  const assets = Array.from({ length: count }, () => fakePhoto({ phone: options.phone }));
  world().picker.queue.push({ canceled: false, assets });
  return assets;
}

/** The next camera / gallery call is cancelled by the user. (This is also what an empty queue does.) */
export function queuePickerCancel(): void {
  world().picker.queue.push({ canceled: true, assets: null });
}

/** The user allows or refuses the camera permission prompt. */
export function setCameraPermission(granted: boolean): void {
  world().picker.cameraGranted = granted;
}

/** Android killed the app while the camera was open: this is what getPendingResultAsync() returns. */
export function setPendingCameraResult(assets: FakePhotoAsset[] | null): void {
  world().picker.pending = assets ? { canceled: false, assets } : null;
}

/** The next File.pickFileAsync() returns these files (a .zip backup or a PDF the user chose). */
export function queueFilePick(...uris: string[]): void {
  world().nextFilePick = { uris };
}

/** Mute console.error (reportError logs there in dev builds). Restore with the returned spy's mockRestore(). */
export function silenceConsoleError() {
  return jest.spyOn(console, 'error').mockImplementation(() => undefined);
}

/** Replace Alert.alert with a spy that does nothing, so showError() / guard() can be asserted on. */
export function mockAlert() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Alert } = require('react-native') as typeof import('react-native');
  return jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
}
