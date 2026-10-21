import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { useMemo, useSyncExternalStore } from 'react';

import { nowIso } from '@/lib/dates';

import { DATA_TABLES, DataTable, migrations } from './schema';

export const DB_NAME = 'bluemoon.db';

let db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync(DB_NAME);
    db.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    migrate(db);
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
    d.withTransactionSync(() => {
      d.execSync(migrations[v]);
      d.execSync(`PRAGMA user_version = ${v + 1}`);
    });
  }
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
  txDepth = 1;
  d.execSync('BEGIN IMMEDIATE');
  try {
    const out = fn();
    d.execSync('COMMIT');
    return out;
  } catch (e) {
    d.execSync('ROLLBACK');
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
export function save(table: DataTable, values: Row & { id?: string }): string {
  assertTable(table);
  const d = getDb();
  const cols = columnsOf(table);
  const now = nowIso();
  const dev = deviceId();
  let id = values.id ?? '';

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
      const row: Row = { ...values, id, created_at: now, updated_at: now, version: 1, device_id: dev };
      const fields = Object.keys(row).filter((k) => cols.includes(k));
      d.runSync(
        `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
        fields.map((f) => row[f] ?? null),
      );
      audit(table, id, 'insert', row);
    }
  });

  notify();
  return id;
}

/** Soft delete. The row stays for history and can be restored. */
export function remove(table: DataTable, id: string) {
  assertTable(table);
  const d = getDb();
  const now = nowIso();
  tx(() => {
    d.runSync(
      `UPDATE ${table} SET deleted_at = ?, updated_at = ?, version = version + 1, device_id = ? WHERE id = ?`,
      [now, now, deviceId(), id],
    );
    audit(table, id, 'delete', null);
  });
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

export function mergeRow(table: DataTable, incoming: Row): MergeResult {
  const what = classifyRow(table, incoming);
  if (what === 'skipped') return what;
  const d = getDb();
  const cols = columnsOf(table);
  const id = String(incoming.id);
  const fields = Object.keys(incoming).filter((k) => cols.includes(k));

  if (what === 'inserted') {
    d.runSync(
      `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
      fields.map((f) => incoming[f] ?? null),
    );
    audit(table, id, 'import-insert', incoming);
    return 'inserted';
  }

  const sets = fields.filter((f) => f !== 'id');
  d.runSync(`UPDATE ${table} SET ${sets.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, [
    ...sets.map((f) => incoming[f] ?? null),
    id,
  ]);
  audit(table, id, 'import-update', incoming);
  return 'updated';
}
