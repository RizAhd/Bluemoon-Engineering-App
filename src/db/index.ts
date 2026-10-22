import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { useMemo, useSyncExternalStore } from 'react';

import { nowIso } from '@/lib/dates';
import { reportError } from '@/lib/errors';

import { DATA_TABLES, DataTable, migrations } from './schema';

export const DB_NAME = 'bluemoon.db';

let db: SQLite.SQLiteDatabase | null = null;

/** A migration step failed on a database that opened fine. Each step is one transaction, so the file is untouched. */
export class MigrationError extends Error {}

/** Messages SQLite gives for a damaged file (as opposed to a step that simply could not run). */
const CORRUPTION = /malformed|not a database|corrupt|disk image/i;

function isMigrationFailure(e: unknown): boolean {
  // the message check keeps this working even where `instanceof` on a subclass of Error does not
  return e instanceof MigrationError || (e instanceof Error && /^Migration \d+ failed/.test(e.message));
}

function openAndMigrate(): SQLite.SQLiteDatabase {
  const opened = SQLite.openDatabaseSync(DB_NAME);
  try {
    opened.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    migrate(opened);
    return opened;
  } catch (e) {
    try {
      opened.closeSync();
    } catch {
      // already closed
    }
    throw e;
  }
}

/** Move a database that cannot be opened aside (kept for manual rescue) so a fresh one can start. */
function quarantineDatabase() {
  const dir = new Directory(Paths.document, 'SQLite');
  const stamp = Date.now();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      const f = new File(dir, DB_NAME + suffix);
      if (f.exists) f.move(new File(dir, `${DB_NAME}.corrupt-${stamp}${suffix}`));
    } catch (e) {
      reportError(e, 'db.quarantine');
    }
  }
}

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    try {
      db = openAndMigrate();
    } catch (e) {
      reportError(e, 'migrate');
      // A step that failed on a healthy file (a bug, a full disk) leaves every row where it was:
      // do not move the owner's data aside, report it and let the next start try again.
      if (isMigrationFailure(e) && !CORRUPTION.test((e as Error).message)) throw e;
      // Unreadable or corrupt file (e.g. a torn restore from Google backup): set it aside
      // and start empty so the app opens and the user can restore the newest automatic backup.
      quarantineDatabase();
      try {
        db = openAndMigrate();
        db.runSync(
          "INSERT INTO settings(key, value) VALUES ('recovered_from_corruption', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          [new Date().toISOString()],
        );
      } catch (e2) {
        db = null;
        reportError(e2, 'migrate');
        throw e2;
      }
    }
  }
  return db;
}

/** Close the connection so the file can be replaced (restore). The next getDb() reopens it. */
export function closeDb() {
  if (db) {
    db.closeSync();
    db = null;
    notify();
  }
}

function migrate(d: SQLite.SQLiteDatabase) {
  const row = d.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < migrations.length; v++) {
    try {
      d.withTransactionSync(() => {
        d.execSync(migrations[v]);
        d.execSync(`PRAGMA user_version = ${v + 1}`);
      });
    } catch (e) {
      throw new MigrationError(`Migration ${v + 1} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  COLUMNS_CACHE.clear();
}

// ---------------------------------------------------------------- transactions

let txDepth = 0;

/**
 * Run `fn` in one transaction. Nested calls join the outer transaction,
 * so domain functions can be combined without "transaction within a transaction".
 */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  if (txDepth > 0) {
    txDepth++;
    try {
      return fn();
    } finally {
      txDepth--;
    }
  }
  // Only a transaction that really began counts: if BEGIN fails (database busy), txDepth stays 0,
  // otherwise every later write would "join" a transaction that does not exist and lose atomicity.
  d.execSync('BEGIN IMMEDIATE');
  txDepth = 1;
  try {
    const out = fn();
    d.execSync('COMMIT');
    return out;
  } catch (e) {
    try {
      d.execSync('ROLLBACK');
    } catch {
      // SQLite already rolled back (e.g. disk full): keep the original error, not this one
    }
    throw e;
  } finally {
    txDepth = 0;
  }
}

// ---------------------------------------------------------------- change notification

let dataVersion = 0;
const listeners = new Set<() => void>();

export function notify() {
  dataVersion++;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Re-renders whenever anything is written through this module. */
export function useDataVersion() {
  return useSyncExternalStore(subscribe, () => dataVersion);
}

/** Live query: re-runs after every write. Data is small, so sync reads are fast. */
export function useQuery<T>(sql: string, params: SQLite.SQLiteBindValue[] = []): T[] {
  const v = useDataVersion();
  const key = JSON.stringify(params);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getDb().getAllSync<T>(sql, params), [sql, key, v]);
}

export function useFirst<T>(sql: string, params: SQLite.SQLiteBindValue[] = []): T | null {
  return useQuery<T>(sql, params)[0] ?? null;
}

export function all<T>(sql: string, params: SQLite.SQLiteBindValue[] = []): T[] {
  return getDb().getAllSync<T>(sql, params);
}

export function first<T>(sql: string, params: SQLite.SQLiteBindValue[] = []): T | null {
  return getDb().getFirstSync<T>(sql, params);
}

// ---------------------------------------------------------------- settings & device

export function getSetting(key: string): string | null {
  return first<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', [key])?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  getDb().runSync(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
  notify();
}

export function useSetting(key: string): string | null {
  return useFirst<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', [key])?.value ?? null;
}

/** A stable id for this install, written into every row and audit entry. */
export function deviceId(): string {
  let id = getSetting('device_id');
  if (!id) {
    id = Crypto.randomUUID();
    setSetting('device_id', id);
  }
  return id;
}

export function newId(): string {
  return Crypto.randomUUID();
}

// ---------------------------------------------------------------- the single write path

type Row = Record<string, SQLite.SQLiteBindValue>;

const COLUMNS_CACHE = new Map<string, string[]>();

function columnsOf(table: DataTable): string[] {
  let cols = COLUMNS_CACHE.get(table);
  if (!cols) {
    cols = getDb()
      .getAllSync<{ name: string }>(`PRAGMA table_info(${table})`)
      .map((c) => c.name);
    COLUMNS_CACHE.set(table, cols);
  }
  return cols;
}

function assertTable(table: string): asserts table is DataTable {
  if (!(DATA_TABLES as readonly string[]).includes(table)) throw new Error(`Unknown table ${table}`);
}

function audit(table: string, rowId: string, action: string, data: unknown) {
  getDb().runSync(
    'INSERT INTO audit_log(at, device_id, table_name, row_id, action, data) VALUES (?, ?, ?, ?, ?, ?)',
    [nowIso(), deviceId(), table, rowId, action, data === undefined ? null : JSON.stringify(data)],
  );
}

/**
 * Insert a new row or update an existing one. Bumps `version`, stamps times,
 * writes the audit log, all in one transaction. Returns the row id.
 */
export function save(table: DataTable, values: { [k: string]: SQLite.SQLiteBindValue | undefined }): string {
  assertTable(table);
  const d = getDb();
  const cols = columnsOf(table);
  const now = nowIso();
  const dev = deviceId();
  let id = typeof values.id === 'string' ? values.id : '';

  try {
    tx(() => {
      const existing = id
        ? d.getFirstSync<Row>(`SELECT * FROM ${table} WHERE id = ?`, [id])
        : null;

      if (existing) {
        const fields = Object.keys(values).filter(
          (k) => cols.includes(k) && !['id', 'created_at', 'version', 'device_id'].includes(k),
        );
        const sets = [...fields.map((f) => `${f} = ?`), 'updated_at = ?', 'version = version + 1', 'device_id = ?'];
        d.runSync(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, [
          ...fields.map((f) => values[f] ?? null),
          now,
          dev,
          id,
        ]);
        audit(table, id, 'update', values);
      } else {
        id = id || newId();
        const row: Row = { ...(values as Row), id, created_at: now, updated_at: now, version: 1, device_id: dev };
        const fields = Object.keys(row).filter((k) => cols.includes(k));
        d.runSync(
          `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
          fields.map((f) => row[f] ?? null),
        );
        audit(table, id, 'insert', row);
      }
    });
  } catch (e) {
    reportError(e, 'db.save', { table, id });
    throw e;
  }

  notify();
  return id;
}

/**
 * Soft delete. The row stays for history and can be restored.
 * A row that is already deleted, or does not exist, is left exactly as it is (no new
 * deleted_at, no version bump, no audit entry): a double tap must not rewrite history.
 */
export function remove(table: DataTable, id: string) {
  assertTable(table);
  const d = getDb();
  const now = nowIso();
  try {
    tx(() => {
      const res = d.runSync(
        `UPDATE ${table} SET deleted_at = ?, updated_at = ?, version = version + 1, device_id = ? WHERE id = ? AND deleted_at IS NULL`,
        [now, now, deviceId(), id],
      );
      if (res.changes > 0) audit(table, id, 'delete', null);
    });
  } catch (e) {
    reportError(e, 'db.remove', { table, id });
    throw e;
  }
  notify();
}

/**
 * Merge a row that came from another phone (PDF hand-off or backup).
 * Keeps whichever copy has the higher version; on a tie, the later update.
 * Returns what happened so the import screen can report it.
 */
export type MergeResult = 'inserted' | 'updated' | 'skipped';

/** What mergeRow would do, without writing. Used for the import preview. */
export function classifyRow(table: DataTable, incoming: Row): MergeResult {
  assertTable(table);
  const id = String(incoming.id ?? '');
  if (!id) return 'skipped';
  const existing = getDb().getFirstSync<{ version: number; updated_at: string }>(
    `SELECT version, updated_at FROM ${table} WHERE id = ?`,
    [id],
  );
  if (!existing) return 'inserted';
  const inV = Number(incoming.version ?? 0);
  const newer =
    inV > existing.version || (inV === existing.version && String(incoming.updated_at ?? '') > existing.updated_at);
  return newer ? 'updated' : 'skipped';
}

/** Import audit entries keep only the row's identity, not a full copy (keeps the DB small). */
function slim(r: Row) {
  return { id: r.id, version: r.version ?? null };
}

export function mergeRow(table: DataTable, incoming: Row): MergeResult {
  const what = classifyRow(table, incoming);
  if (what === 'skipped') return what;
  const d = getDb();
  const cols = columnsOf(table);
  const id = String(incoming.id);
  const fields = Object.keys(incoming).filter((k) => cols.includes(k));

  try {
    if (what === 'inserted') {
      d.runSync(
        `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
        fields.map((f) => incoming[f] ?? null),
      );
      audit(table, id, 'import-insert', slim(incoming));
      return 'inserted';
    }

    const sets = fields.filter((f) => f !== 'id');
    d.runSync(`UPDATE ${table} SET ${sets.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, [
      ...sets.map((f) => incoming[f] ?? null),
      id,
    ]);
    audit(table, id, 'import-update', slim(incoming));
    return 'updated';
  } catch (e) {
    reportError(e, 'db.mergeRow', { table, id });
    throw e;
  }
}
