/**
 * Shared state of the Jest harness: the "phones".
 *
 * A phone is one device's storage: its SQLite databases and its app-private
 * folders (document/, cache/). The sqlite shim and the fake file system both
 * ask `activeStorage()` where to read and write, so everything the app does on
 * the "active" phone lands in that phone's storage and nowhere else.
 *
 * Why this lives on `globalThis`: Jest hands every `jest.isolateModules` block
 * its own copies of the app modules, and a mock can be instantiated more than
 * once. A module-level variable would then split into several unrelated
 * copies. One object under a `Symbol.for` key on the test file's global is
 * the same everywhere inside one test file and never shared between files.
 *
 * Test authors do not use this file directly; they use `@/test-utils`.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export class PhoneStorage {
  /** true: databases are real files under document/SQLite. false (default): in memory. */
  fileDb = false;
  /**
   * In-memory databases by name. Like a file they survive `closeSync()` (so
   * "close the app, open it again" keeps the data) and they disappear on `reset()`.
   */
  readonly memoryDbs = new Map<string, DatabaseSync>();
  /** Every open node:sqlite connection of this phone, so reset() can close them all. */
  readonly connections = new Set<DatabaseSync>();
  private dir: string | null = null;

  constructor(readonly id: string) {}

  /** The temp directory holding this phone's files. Created on first use. */
  get root(): string {
    if (!this.dir) {
      const dir = mkdtempSync(join(tmpdir(), `bluemoon-${this.id.replace(/[^\w-]/g, '_')}-`));
      for (const sub of ['document', 'cache', 'bundle']) mkdirSync(join(dir, sub));
      this.dir = dir;
    }
    return this.dir;
  }

  get hasRoot(): boolean {
    return this.dir !== null && existsSync(this.dir);
  }

  get documentPath(): string {
    return join(this.root, 'document');
  }

  get cachePath(): string {
    return join(this.root, 'cache');
  }

  get bundlePath(): string {
    return join(this.root, 'bundle');
  }

  /** Close every connection and forget every in-memory database. Files stay. */
  closeDatabases(): void {
    for (const c of [...this.connections]) {
      try {
        c.close();
      } catch {
        // already closed
      }
    }
    this.connections.clear();
    for (const c of this.memoryDbs.values()) {
      try {
        c.close();
      } catch {
        // already closed
      }
    }
    this.memoryDbs.clear();
  }

  /** Factory reset: databases and files are gone, the next use starts empty. */
  reset(): void {
    this.closeDatabases();
    if (this.dir) {
      try {
        rmSync(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 });
      } catch {
        // a leftover temp folder is harmless; the OS cleans the temp directory
      }
      this.dir = null;
    }
  }

  /** reset() and leave the harness for good. */
  dispose(): void {
    this.reset();
    const w = world();
    w.storages.delete(this);
    if (w.active === this) w.active = w.main;
  }
}

/** Test doubles for the native pickers: what the next camera / gallery call returns. */
export interface PickerState {
  cameraGranted: boolean;
  /** One entry is consumed per launchCameraAsync / launchImageLibraryAsync call. Empty queue = user cancels. */
  queue: unknown[];
  /** What getPendingResultAsync() returns (a photo taken just before Android killed the app). */
  pending: unknown;
}

export interface World {
  seq: number;
  storages: Set<PhoneStorage>;
  /** The phone every plain `import ... from '@/db'` in a test talks to. */
  main: PhoneStorage;
  /** The phone new files / databases are created on right now. */
  active: PhoneStorage;
  picker: PickerState;
  /** Next File.pickFileAsync result (the document picker). null = user cancels. */
  nextFilePick: { uris: string[] } | null;
}

const KEY = Symbol.for('bluemoon.testHarness.world');

export function world(): World {
  const g = globalThis as unknown as Record<symbol, World | undefined>;
  let w = g[KEY];
  if (!w) {
    const main = new PhoneStorage('main');
    w = {
      seq: 0,
      storages: new Set([main]),
      main,
      active: main,
      picker: { cameraGranted: true, queue: [], pending: null },
      nextFilePick: null,
    };
    g[KEY] = w;
  }
  return w;
}

/** True once any test code touched the harness (lets teardown skip all work otherwise). */
export function worldExists(): boolean {
  return (globalThis as unknown as Record<symbol, unknown>)[KEY] !== undefined;
}

export function activeStorage(): PhoneStorage {
  return world().active;
}

export function newStorage(label: string): PhoneStorage {
  const w = world();
  const s = new PhoneStorage(`${label}${++w.seq}`);
  w.storages.add(s);
  return s;
}

function isPromiseLike(v: unknown): v is PromiseLike<unknown> {
  return typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';
}

/**
 * Run `fn` with `storage` as the active phone, then switch back.
 * For an async `fn` the phone stays active until the promise settles, so
 * `await` one phone's call before you use another phone.
 */
export function runAs<T>(storage: PhoneStorage, fn: () => T): T {
  const w = world();
  const prev = w.active;
  w.active = storage;
  let out: T;
  try {
    out = fn();
  } catch (e) {
    w.active = prev;
    throw e;
  }
  if (isPromiseLike(out)) {
    const restore = () => {
      w.active = prev;
    };
    return out.then(
      (v) => {
        restore();
        return v;
      },
      (e) => {
        restore();
        throw e;
      },
    ) as T;
  }
  w.active = prev;
  return out;
}

/** Delete every temp folder and close every database. Called after each test file. */
export function disposeAll(): void {
  if (!worldExists()) return;
  const w = world();
  for (const s of [...w.storages]) s.reset();
  w.storages = new Set([w.main]);
  w.active = w.main;
  w.picker.queue.length = 0;
  w.picker.pending = null;
  w.picker.cameraGranted = true;
  w.nextFilePick = null;
}
