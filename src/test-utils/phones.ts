/**
 * "Phones": the real data layer (src/db, src/lib) bound to one device's storage.
 *
 *   mainPhone()        the phone every plain `import ... from '@/db'` in a test uses
 *   openPhone(opts)    a second, fully independent phone: its own copy of the app
 *                      modules (own connection, own caches) and its own storage
 *
 * A Phone's module members (`phone.repo.saveProject(...)`, `phone.bundle.applyBundle(...)`)
 * are wrapped so the call runs with that phone active: any database or file the
 * call opens belongs to that phone. Calls on different phones never share rows
 * or files. `await` one phone's async call before you use another phone.
 *
 * Test authors import from '@/test-utils' (index.ts), not from here.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { Directory } from './fakeFs';
import { newStorage, PhoneStorage, runAs, world } from './world';

interface Modules {
  db: typeof import('@/db');
  repo: typeof import('@/db/repo');
  files: typeof import('@/lib/files');
  bundle: typeof import('@/lib/bundle');
  backup: typeof import('@/lib/backup');
  autoBackup: typeof import('@/lib/autoBackup');
  errors: typeof import('@/lib/errors');
  demo: typeof import('@/lib/demoData');
  dates: typeof import('@/lib/dates');
  i18n: typeof import('@/i18n');
  /** Only loaded for a second phone when asked for (`openPhone({ pdf: true })`); always available on the main phone. */
  pdf: typeof import('@/lib/pdf');
}

/** Everything is required eagerly: a second phone's modules must be loaded inside its isolateModules block. */
function loadModules(withPdf: boolean): Modules {
  const mods = {
    db: require('@/db'),
    repo: require('@/db/repo'),
    files: require('@/lib/files'),
    bundle: require('@/lib/bundle'),
    backup: require('@/lib/backup'),
    autoBackup: require('@/lib/autoBackup'),
    errors: require('@/lib/errors'),
    demo: require('@/lib/demoData'),
    dates: require('@/lib/dates'),
    i18n: require('@/i18n'),
  } as Modules;
  if (withPdf) mods.pdf = require('@/lib/pdf');
  return mods;
}

/** Wrap a module's camelCase functions so each call runs with `storage` as the active phone. */
function bindToPhone<T extends object>(storage: PhoneStorage, mod: T): T {
  const wrapped = new Map<string, unknown>();
  return new Proxy(mod, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      // Exports starting with a capital are classes (ValidationError ...) and stay untouched.
      if (typeof value !== 'function' || typeof prop !== 'string' || !/^[a-z_$]/.test(prop)) return value;
      let fn = wrapped.get(prop);
      if (!fn) {
        fn = (...args: unknown[]) => runAs(storage, () => (value as (...a: unknown[]) => unknown).apply(target, args));
        wrapped.set(prop, fn);
      }
      return fn;
    },
  });
}

export interface ResetOptions {
  /** Keep the database in real files under document/SQLite instead of memory. Default false. */
  fileDb?: boolean;
}

export interface OpenPhoneOptions extends ResetOptions {
  /** Name shown in the temp folder, for debugging. */
  name?: string;
  /** Also load src/lib/pdf.ts for this phone (it pulls in pdf-lib, so it is opt-in). */
  pdf?: boolean;
}

export class Phone {
  readonly db: Modules['db'];
  readonly repo: Modules['repo'];
  readonly files: Modules['files'];
  readonly bundle: Modules['bundle'];
  readonly backup: Modules['backup'];
  readonly autoBackup: Modules['autoBackup'];
  readonly errors: Modules['errors'];
  readonly demo: Modules['demo'];
  readonly dates: Modules['dates'];
  readonly i18n: Modules['i18n'];
  private readonly getPdf: () => Modules['pdf'];
  private boundPdf: Modules['pdf'] | null = null;

  constructor(
    readonly storage: PhoneStorage,
    mods: Omit<Modules, 'pdf'>,
    loadPdf: () => Modules['pdf'],
  ) {
    const b = <T extends object>(m: T) => bindToPhone(storage, m);
    this.db = b(mods.db);
    this.repo = b(mods.repo);
    this.files = b(mods.files);
    this.bundle = b(mods.bundle);
    this.backup = b(mods.backup);
    this.autoBackup = b(mods.autoBackup);
    this.errors = b(mods.errors);
    this.demo = b(mods.demo);
    this.dates = b(mods.dates);
    this.i18n = b(mods.i18n);
    this.getPdf = () => (this.boundPdf ??= b(loadPdf()));
  }

  get id(): string {
    return this.storage.id;
  }

  /** src/lib/pdf.ts bound to this phone. Throws on a second phone opened without `pdf: true`. */
  get pdf(): Modules['pdf'] {
    return this.getPdf();
  }

  /** Run any code with this phone active (e.g. `phone.run(() => new File(Paths.document, 'x'))`). */
  run<T>(fn: () => T): T {
    return runAs(this.storage, fn);
  }

  /** This phone's permanent app folder (what `Paths.document` returns while it is active). */
  get documentDir(): Directory {
    return new Directory(this.storage.documentPath);
  }

  /** This phone's cache folder (`Paths.cache`). */
  get cacheDir(): Directory {
    return new Directory(this.storage.cachePath);
  }

  /** Create the realistic demo data (3 projects, workers, wages, expenses, tools, notes). */
  seedDemo(): { created: boolean } {
    return this.demo.seedDemoData();
  }

  /**
   * Factory reset: close the app's connection, forget the database, delete every file.
   * The next data call opens a fresh database and runs the migrations again.
   */
  resetDb(options: ResetOptions = {}): void {
    runAs(this.storage, () => {
      try {
        this.db.closeDb();
      } catch {
        // nothing was open
      }
    });
    this.storage.reset();
    this.storage.fileDb = !!options.fileDb;
  }

  /** Delete every file of this phone (photos, backups, error log) but keep the database. */
  resetFiles(): void {
    for (const dir of [this.documentDir, this.cacheDir]) {
      if (!dir.exists) continue;
      for (const entry of dir.list()) {
        // in file-db mode the live database must stay
        if (entry.name === 'SQLite' && this.storage.fileDb) continue;
        if (entry instanceof Directory) entry.delete();
        else entry.delete();
      }
    }
  }

  /** Close the app's connection like quitting the app. The data stays; the next call reopens it. */
  restartApp(): void {
    runAs(this.storage, () => this.db.closeDb());
  }

  /** Free this phone's temp folder and databases. Second phones should call this in afterEach/afterAll. */
  dispose(): void {
    runAs(this.storage, () => {
      try {
        this.db.closeDb();
      } catch {
        // nothing was open
      }
    });
    if (this.storage === world().main) this.storage.reset();
    else this.storage.dispose();
  }
}

let main: Phone | null = null;

/** The phone behind the test's own `import ... from '@/db'`. Created on first use. */
export function mainPhone(): Phone {
  if (!main) {
    // Same registry as the test file, so these are the very modules the test imported.
    main = new Phone(world().main, loadModules(false), () => require('@/lib/pdf'));
  }
  return main;
}

/**
 * A second phone with its own copy of the data layer and its own storage.
 * Rows and files written on one phone are invisible to the other until you
 * move a bundle across with `transfer()`.
 */
export function openPhone(options: OpenPhoneOptions = {}): Phone {
  const storage = newStorage(options.name ?? 'phone');
  storage.fileDb = !!options.fileDb;
  let mods: Modules | undefined;
  jest.isolateModules(() => {
    mods = loadModules(!!options.pdf);
  });
  if (!mods) throw new Error('openPhone: the data layer failed to load');
  const loaded = mods;
  return new Phone(storage, loaded, () => {
    if (!loaded.pdf) throw new Error('This phone was opened without pdf: true. Use openPhone({ pdf: true }).');
    return loaded.pdf;
  });
}

/** The second phone for import / merge tests. Same as openPhone(). */
export function openSecondPhone(options: OpenPhoneOptions = {}): Phone {
  return openPhone({ name: 'second', ...options });
}

/** Wipe the main phone (database and files). Call in `beforeEach`. */
export function resetDb(options: ResetOptions = {}): void {
  mainPhone().resetDb(options);
}

/** Demo data on the main phone. A second call returns `{ created: false }`. */
export function seedDemo(): { created: boolean } {
  return mainPhone().seedDemo();
}

// ---------------------------------------------------------------- hand-off between phones

type Tables = ReturnType<Modules['bundle']['collectProject']>;

/**
 * What the PDF / backup hand-off does, without the container: collect a project
 * (or everything, with no projectId) on `from`, carry its rows and photo files
 * across, and apply them on `to`. Returns the import plan of `to`.
 */
export async function transfer(from: Phone, to: Phone, options: { projectId?: string } = {}) {
  const tables: Tables = options.projectId ? from.bundle.collectProject(options.projectId) : from.bundle.collectAll();
  const files = new Map<string, Uint8Array>();
  for (const att of from.bundle.filesOf(tables)) files.set(att.file_name, from.bundle.readFileBytes(att));
  // JSON round trip: the bundle travels as text, so nothing live may leak across phones
  const wire = JSON.parse(JSON.stringify(tables)) as Tables;
  return to.bundle.applyBundle(wire, files);
}
