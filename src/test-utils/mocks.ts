/**
 * Factories for the native-module mocks installed by setup.ts. Each returns the
 * module object that `jest.mock('<name>', factory)` hands to the app.
 *
 * They are factories (not plain objects) so setup.ts can stay cheap: nothing
 * here is loaded until the app actually imports the mocked module.
 *
 * Mutable behaviour (what the camera returns, which file the user picks) lives
 * in world.ts and is driven through the helpers in `@/test-utils`.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Directory, File, Paths } from './fakeFs';
import { world } from './world';

type Bytes = ArrayBuffer | ArrayBufferView;

function toU8(data: Bytes): Uint8Array {
  return ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
}

// ---------------------------------------------------------------- expo-crypto

const ALGO: Record<string, string> = { 'SHA-1': 'sha1', 'SHA-256': 'sha256', 'SHA-384': 'sha384', 'SHA-512': 'sha512', MD5: 'md5' };

export function cryptoMock() {
  const CryptoDigestAlgorithm = {
    SHA1: 'SHA-1',
    SHA256: 'SHA-256',
    SHA384: 'SHA-384',
    SHA512: 'SHA-512',
    MD5: 'MD5',
  } as const;
  const CryptoEncoding = { HEX: 'hex', BASE64: 'base64' } as const;
  const hash = (algorithm: string) => {
    const name = ALGO[algorithm];
    if (!name) throw new Error(`Unsupported digest algorithm: ${algorithm}`);
    return createHash(name);
  };
  return {
    __esModule: true,
    CryptoDigestAlgorithm,
    CryptoEncoding,
    randomUUID: () => randomUUID(),
    getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)),
    getRandomBytesAsync: async (n: number) => new Uint8Array(randomBytes(n)),
    digest: async (algorithm: string, data: Bytes): Promise<ArrayBuffer> => {
      const out = hash(algorithm).update(toU8(data)).digest();
      return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
    },
    digestStringAsync: async (algorithm: string, data: string, options?: { encoding?: 'hex' | 'base64' }) =>
      hash(algorithm)
        .update(data, 'utf8')
        .digest(options?.encoding ?? 'hex'),
  };
}

// ---------------------------------------------------------------- expo-image-manipulator

/** "Compression" copies the bytes: the file is new, its content is predictable. */
export function imageManipulatorMock() {
  const SaveFormat = { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' } as const;
  const manipulate = (uri: string) => {
    const ctx = {
      operations: [] as unknown[],
      resize(o: unknown) {
        ctx.operations.push({ resize: o });
        return ctx;
      },
      rotate(o: unknown) {
        ctx.operations.push({ rotate: o });
        return ctx;
      },
      flip(o: unknown) {
        ctx.operations.push({ flip: o });
        return ctx;
      },
      crop(o: unknown) {
        ctx.operations.push({ crop: o });
        return ctx;
      },
      async renderAsync() {
        const source = new File(uri); // throws like the real thing when the file is gone
        const bytes = source.bytesSync();
        return {
          width: 1600,
          height: 1200,
          async saveAsync(opts?: { format?: string }) {
            const ext = opts?.format === 'png' ? 'png' : opts?.format === 'webp' ? 'webp' : 'jpg';
            const sub = new Directory(Paths.cache, 'ImageManipulator');
            if (!sub.exists) sub.create({ intermediates: true });
            const out = new File(Paths.cache, 'ImageManipulator', `${randomUUID()}.${ext}`);
            out.create();
            out.writeSync(bytes);
            return { uri: out.uri, width: 1600, height: 1200 };
          },
        };
      },
    };
    return ctx;
  };
  return { __esModule: true, ImageManipulator: { manipulate }, SaveFormat };
}

// ---------------------------------------------------------------- expo-image-picker

export function imagePickerMock() {
  const next = () => {
    const w = world();
    return w.picker.queue.length ? w.picker.queue.shift() : { canceled: true, assets: null };
  };
  const permission = () => {
    const granted = world().picker.cameraGranted;
    return { granted, status: granted ? 'granted' : 'denied', canAskAgain: true, expires: 'never' };
  };
  return {
    __esModule: true,
    MediaTypeOptions: { All: 'All', Images: 'Images', Videos: 'Videos' },
    requestCameraPermissionsAsync: jest.fn(async () => permission()),
    requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true, expires: 'never' })),
    launchCameraAsync: jest.fn(async (_options?: unknown) => next()),
    launchImageLibraryAsync: jest.fn(async (_options?: unknown) => next()),
    getPendingResultAsync: jest.fn(async () => world().picker.pending),
  };
}

// ---------------------------------------------------------------- expo-print

/** Writes a valid one-page A4 PDF (with a line of text) into the cache; the html it was asked to render is in `mock.calls`. */
export function printMock() {
  return {
    __esModule: true,
    printToFileAsync: jest.fn(async (_options?: { html?: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PDFDocument, StandardFonts } = require('pdf-lib') as typeof import('pdf-lib');
      const doc = await PDFDocument.create();
      const page = doc.addPage([595, 842]);
      // a page needs content before pdf-lib can embed it onto a letterhead
      page.drawText('expo-print test page', { x: 50, y: 780, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
      const bytes = await doc.save();
      const printDir = new Directory(Paths.cache, 'Print');
      if (!printDir.exists) printDir.create({ intermediates: true });
      const out = new File(printDir, `${randomUUID()}.pdf`);
      out.create();
      out.writeSync(bytes);
      return { uri: out.uri, numberOfPages: 1 };
    }),
    printAsync: jest.fn(async () => undefined),
    selectPrinterAsync: jest.fn(async () => undefined),
  };
}

// ---------------------------------------------------------------- expo-asset

/**
 * jest-expo turns every require('picture.png') into the number 1, so a bundled picture cannot be
 * told apart. The one asset the data layer loads is the PDF letterhead, so every asset
 * resolves to a copy of assets/brand/letterhead.jpeg placed in the phone's cache.
 */
export function assetMock() {
  return {
    __esModule: true,
    Asset: {
      fromModule(_moduleRef: unknown) {
        const asset = {
          name: 'letterhead',
          type: 'jpeg',
          hash: null as string | null,
          uri: '',
          localUri: null as string | null,
          async downloadAsync() {
            const source = resolve(__dirname, '../../assets/brand/letterhead.jpeg');
            const bytes = existsSync(source) ? readFileSync(source) : Buffer.alloc(2048, 7);
            const dir = new Directory(Paths.cache, 'ExponentAsset');
            if (!dir.exists) dir.create({ intermediates: true });
            const file = new File(dir, 'letterhead.jpeg');
            if (!file.exists) file.create();
            file.writeSync(new Uint8Array(bytes));
            asset.uri = file.uri;
            asset.localUri = file.uri;
            return asset;
          },
        };
        return asset;
      },
    },
  };
}

// ---------------------------------------------------------------- small no-op modules

export function hapticsMock() {
  return {
    __esModule: true,
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
    NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
    impactAsync: jest.fn(async () => undefined),
    notificationAsync: jest.fn(async () => undefined),
    selectionAsync: jest.fn(async () => undefined),
  };
}

export function localizationMock() {
  const locale = {
    languageCode: 'en',
    languageTag: 'en-US',
    regionCode: 'US',
    languageScriptCode: null,
    textDirection: 'ltr',
    digitGroupingSeparator: ',',
    decimalSeparator: '.',
    measurementSystem: 'metric',
    currencyCode: 'LKR',
    currencySymbol: 'Rs',
    languageCurrencyCode: 'LKR',
    languageCurrencySymbol: 'Rs',
    temperatureUnit: 'celsius',
  };
  const calendar = { calendar: 'gregory', uses24hourClock: false, firstWeekday: 1, timeZone: 'Asia/Colombo' };
  return {
    __esModule: true,
    // plain functions, not jest.fn: i18n must keep working even if a test calls jest.resetAllMocks()
    getLocales: () => [locale],
    getCalendars: () => [calendar],
    useLocales: () => [locale],
    useCalendars: () => [calendar],
  };
}

export function applicationMock() {
  return {
    __esModule: true,
    applicationName: 'Bluemoon Site',
    applicationId: 'lk.bluemoonengineering.site',
    nativeApplicationVersion: '1.0.0',
    nativeBuildVersion: '1',
    getInstallationTimeAsync: jest.fn(async () => new Date(0)),
  };
}

export function sharingMock() {
  return {
    __esModule: true,
    shareAsync: jest.fn(async (_url?: string, _options?: unknown) => undefined),
    isAvailableAsync: jest.fn(async () => true),
    useIncomingShare: jest.fn(() => ({
      sharedPayloads: [],
      resolvedSharedPayloads: [],
      isResolving: false,
      error: null,
      clearSharedPayloads: jest.fn(),
      refreshSharedPayloads: jest.fn(),
    })),
  };
}

/** Defined tasks are kept in `__tasks` so a test can run the daily-backup task body itself. */
export function taskManagerMock() {
  const tasks = new Map<string, (body: unknown) => unknown>();
  const registered = new Set<string>();
  return {
    __esModule: true,
    __tasks: tasks,
    defineTask: jest.fn((name: string, fn: (body: unknown) => unknown) => {
      tasks.set(name, fn);
    }),
    isTaskDefined: jest.fn((name: string) => tasks.has(name)),
    isTaskRegisteredAsync: jest.fn(async (name: string) => registered.has(name)),
    isAvailableAsync: jest.fn(async () => true),
    unregisterTaskAsync: jest.fn(async (name: string) => {
      registered.delete(name);
    }),
    __register: (name: string) => registered.add(name),
  };
}

export function backgroundTaskMock() {
  const BackgroundTaskStatus = { Restricted: 1, Available: 2 } as const;
  const BackgroundTaskResult = { Success: 1, Failed: 2 } as const;
  return {
    __esModule: true,
    BackgroundTaskStatus,
    BackgroundTaskResult,
    getStatusAsync: jest.fn(async () => BackgroundTaskStatus.Available),
    registerTaskAsync: jest.fn(async (_name: string, _options?: unknown) => undefined),
    unregisterTaskAsync: jest.fn(async (_name: string) => undefined),
    triggerTaskWorkerForTestingAsync: jest.fn(async () => true),
  };
}
