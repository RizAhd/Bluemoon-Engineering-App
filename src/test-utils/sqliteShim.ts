/**
 * Drop-in replacement for the parts of `expo-sqlite` the app uses, running on
 * Node's built-in `node:sqlite` so the real data layer works under Jest with
 * no device.
 *
 *   openDatabaseSync(name)   -> SQLiteDatabase
 *   db.execSync / runSync / getAllSync / getFirstSync / getEachSync
 *   db.withTransactionSync / isInTransactionSync / closeSync   (+ *Async twins)
 *
 * Where the data lives is decided by the active phone (see world.ts):
 *   - memory (default): one in-memory database per name. It survives
 *     `closeSync()` ("close the app, open it again" keeps the data) and is
 *     thrown away by the phone's reset.
 *   - file: a real file `<phone>/document/SQLite/<name>`, exactly where
 *     expo-sqlite puts it, so corrupt-file / restore tests can touch the file.
 *
 * Behaviour copied from expo-sqlite on purpose:
 *   - positional params as an array (or varargs), named params as an object;
 *     undefined -> NULL, booleans -> 1/0, JS integers bind as SQLite INTEGERs
 *   - getFirstSync returns `null` (never undefined) when there is no row
 *   - runSync returns `{ lastInsertRowId, changes }`
 *   - rows are plain objects keyed by column name
 *   - foreign keys are OFF until the app runs `PRAGMA foreign_keys = ON`
 *     (node:sqlite would switch them on by default)
 *   - withTransactionSync is BEGIN / task / COMMIT, ROLLBACK + rethrow on error
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { activeStorage, type PhoneStorage } from './world';

export type SQLiteBindValue = string | number | null | boolean | Uint8Array;
export type SQLiteBindParams = Record<string, SQLiteBindValue> | SQLiteBindValue[];
export interface SQLiteRunResult {
  lastInsertRowId: number;
  changes: number;
}

type Row = Record<string, unknown>;

function isArrayBuffer(v: unknown): v is ArrayBuffer {
  return Object.prototype.toString.call(v) === '[object ArrayBuffer]';
}

function toSql(v: unknown): SQLInputValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1n : 0n;
  if (typeof v === 'number') return Number.isSafeInteger(v) ? BigInt(v) : v;
  if (typeof v === 'bigint' || typeof v === 'string') return v;
  if (isArrayBuffer(v)) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  throw new TypeError(`Unsupported SQLite bind value: ${typeof v}`);
}

/** Same shape rules as expo-sqlite's normalizeParams. */
function bindArgs(params: unknown[]): SQLInputValue[] | [Record<string, SQLInputValue>] {
  let p: unknown = params.length > 1 ? params : params[0];
  if (p === null || p === undefined) p = [];
  if (typeof p !== 'object' || isArrayBuffer(p) || ArrayBuffer.isView(p)) p = [p];
  if (Array.isArray(p)) return p.map(toSql);
  const named: Record<string, SQLInputValue> = {};
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) named[k] = toSql(v);
  return [named];
}

function plain(row: unknown): Row {
  // node:sqlite rows have a null prototype; hand out ordinary objects like expo-sqlite does
  return { ...(row as Row) };
}

function openNode(location: string): DatabaseSync {
  return new DatabaseSync(location, { enableForeignKeyConstraints: false });
}

export class SQLiteDatabase {
  private closed = false;

  constructor(
    readonly databaseName: string,
    readonly databasePath: string,
    private readonly node: DatabaseSync,
    /** In-memory databases are shared with the phone and outlive this handle. */
    private readonly shared: boolean,
    private readonly storage: PhoneStorage,
  ) {}

  private db(): DatabaseSync {
    if (this.closed) throw new Error(`Cannot use the closed database "${this.databaseName}"`);
    return this.node;
  }

  execSync(source: string): void {
    this.db().exec(source);
  }

  runSync(source: string, ...params: unknown[]): SQLiteRunResult {
    const r = this.db().prepare(source).run(...(bindArgs(params) as SQLInputValue[]));
    return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
  }

  getAllSync<T = Row>(source: string, ...params: unknown[]): T[] {
    return this.db()
      .prepare(source)
      .all(...(bindArgs(params) as SQLInputValue[]))
      .map(plain) as T[];
  }

  getFirstSync<T = Row>(source: string, ...params: unknown[]): T | null {
    const row = this.db()
      .prepare(source)
      .get(...(bindArgs(params) as SQLInputValue[]));
    return row === undefined ? null : (plain(row) as T);
  }

  *getEachSync<T = Row>(source: string, ...params: unknown[]): IterableIterator<T> {
    const it = this.db()
      .prepare(source)
      .iterate(...(bindArgs(params) as SQLInputValue[]));
    for (const row of it) yield plain(row) as T;
  }

  withTransactionSync(task: () => void): void {
    try {
      this.execSync('BEGIN');
      task();
      this.execSync('COMMIT');
    } catch (e) {
      this.execSync('ROLLBACK');
      throw e;
    }
  }

  isInTransactionSync(): boolean {
    return this.db().isTransaction;
  }

  closeSync(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.shared) {
      // closing a connection abandons its open transaction; the data itself stays
      try {
        if (this.node.isTransaction) this.node.exec('ROLLBACK');
      } catch {
        // nothing to roll back
      }
      return;
    }
    try {
      this.node.close();
    } finally {
      this.storage.connections.delete(this.node);
    }
  }

  // Promise twins. The work is synchronous; only the return type differs.
  async execAsync(source: string): Promise<void> {
    this.execSync(source);
  }
  async runAsync(source: string, ...params: unknown[]): Promise<SQLiteRunResult> {
    return this.runSync(source, ...params);
  }
  async getAllAsync<T = Row>(source: string, ...params: unknown[]): Promise<T[]> {
    return this.getAllSync<T>(source, ...params);
  }
  async getFirstAsync<T = Row>(source: string, ...params: unknown[]): Promise<T | null> {
    return this.getFirstSync<T>(source, ...params);
  }
  async closeAsync(): Promise<void> {
    this.closeSync();
  }
  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    try {
      this.execSync('BEGIN');
      await task();
      this.execSync('COMMIT');
    } catch (e) {
      this.execSync('ROLLBACK');
      throw e;
    }
  }
}

function sqliteDir(storage: PhoneStorage, directory?: string): string {
  return directory ?? join(storage.documentPath, 'SQLite');
}

export function openDatabaseSync(databaseName: string, _options?: unknown, directory?: string): SQLiteDatabase {
  const storage = activeStorage();

  if (databaseName === ':memory:') {
    // a private scratch database, as in expo-sqlite
    const node = openNode(':memory:');
    storage.connections.add(node);
    return new SQLiteDatabase(databaseName, ':memory:', node, false, storage);
  }

  if (!storage.fileDb) {
    let node = storage.memoryDbs.get(databaseName);
    if (!node) {
      node = openNode(':memory:');
      storage.memoryDbs.set(databaseName, node);
    } else {
      // a new connection starts with foreign keys off; the app switches them on itself
      node.exec('PRAGMA foreign_keys = OFF');
    }
    return new SQLiteDatabase(databaseName, `memory:${databaseName}`, node, true, storage);
  }

  const dir = sqliteDir(storage, directory);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, databaseName);
  const node = openNode(file);
  storage.connections.add(node);
  return new SQLiteDatabase(databaseName, file, node, false, storage);
}

export async function openDatabaseAsync(databaseName: string, options?: unknown, directory?: string): Promise<SQLiteDatabase> {
  return openDatabaseSync(databaseName, options, directory);
}

export function deleteDatabaseSync(databaseName: string, directory?: string): void {
  const storage = activeStorage();
  const mem = storage.memoryDbs.get(databaseName);
  if (mem) {
    try {
      mem.close();
    } catch {
      // already closed
    }
    storage.memoryDbs.delete(databaseName);
  }
  const base = join(sqliteDir(storage, directory), databaseName);
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(base + suffix, { force: true });
}

export async function deleteDatabaseAsync(databaseName: string, directory?: string): Promise<void> {
  deleteDatabaseSync(databaseName, directory);
}
