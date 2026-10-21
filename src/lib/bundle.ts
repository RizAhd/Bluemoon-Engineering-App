/**
 * A "bundle" is a set of rows plus the files they point to. It is what travels
 * inside an exported project PDF and inside a full backup. Rows keep their
 * UUIDs and versions, so importing the same bundle twice changes nothing.
 * Deleted rows travel too, so a deletion on one phone reaches the other.
 */
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { all, classifyRow, mergeRow, notify, tx, type MergeResult } from '@/db';
import { DATA_TABLES, type DataTable } from '@/db/schema';
import type { Attachment } from '@/db/types';

import { fileFor, writeAttachmentBytes } from './files';

export const BUNDLE_FORMAT = 'bluemoon-bundle';
export const BUNDLE_VERSION = 1;

type Row = Record<string, string | number | null>;

export interface Bundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  kind: 'project' | 'backup';
  exported_at: string;
  device_id: string;
  project_id?: string;
  project_name?: string;
  tables: Partial<Record<DataTable, Row[]>>;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Rows for one project and everything they refer to (workers, tools, photos). */
export function collectProject(projectId: string): Bundle['tables'] {
  const projects = all<Row>('SELECT * FROM projects WHERE id = ?', [projectId]);
  const expenses = all<Row>('SELECT * FROM expenses WHERE project_id = ?', [projectId]);
  const wages = all<Row>('SELECT * FROM wage_entries WHERE project_id = ?', [projectId]);
  const moves = all<Row>('SELECT * FROM tool_movements WHERE project_id = ?', [projectId]);
  const notes = all<Row>('SELECT * FROM site_notes WHERE project_id = ?', [projectId]);

  const workerIds = new Set<string>();
  wages.forEach((w) => workerIds.add(String(w.worker_id)));
  moves.forEach((m) => m.worker_id && workerIds.add(String(m.worker_id)));
  const toolIds = new Set(moves.map((m) => String(m.tool_id)));
  const workers = byIds('workers', workerIds);
  const tools = byIds('tools', toolIds);

  const owners: [string, Row[]][] = [
    ['projects', projects],
    ['expenses', expenses],
    ['tool_movements', moves],
    ['site_notes', notes],
    ['tools', tools],
  ];
  const attachments: Row[] = [];
  for (const [table, rows] of owners) {
    for (const r of rows) {
      attachments.push(...all<Row>('SELECT * FROM attachments WHERE owner_table = ? AND owner_id = ?', [table, String(r.id)]));
    }
  }

  return {
    projects,
    workers,
    tools,
    expenses,
    wage_entries: wages,
    tool_movements: moves,
    site_notes: notes,
    attachments,
  };
}

function byIds(table: 'workers' | 'tools', ids: Set<string>): Row[] {
  if (!ids.size) return [];
  const list = [...ids];
  return all<Row>(`SELECT * FROM ${table} WHERE id IN (${list.map(() => '?').join(',')})`, list);
}

/** Everything on the phone. */
export function collectAll(): Bundle['tables'] {
  const out: Bundle['tables'] = {};
  for (const t of DATA_TABLES) out[t] = all<Row>(`SELECT * FROM ${t}`);
  return out;
}

/** Live (not deleted) attachment files a bundle needs to carry. */
export function filesOf(tables: Bundle['tables']): Attachment[] {
  return ((tables.attachments ?? []) as unknown as Attachment[]).filter((a) => !a.deleted_at && fileFor(a).exists);
}

export function readFileBytes(att: Attachment): Uint8Array {
  return new File(fileFor(att).uri).bytesSync();
}

// ---------------------------------------------------------------- import

export interface ImportPlan {
  counts: Record<MergeResult, number>;
  perTable: Partial<Record<DataTable, Record<MergeResult, number>>>;
}

export function planImport(tables: Bundle['tables']): ImportPlan {
  const counts = { inserted: 0, updated: 0, skipped: 0 };
  const perTable: ImportPlan['perTable'] = {};
  for (const t of DATA_TABLES) {
    const rows = tables[t] ?? [];
    const c = { inserted: 0, updated: 0, skipped: 0 };
    for (const r of rows) c[classifyRow(t, r)]++;
    if (rows.length) perTable[t] = c;
    counts.inserted += c.inserted;
    counts.updated += c.updated;
    counts.skipped += c.skipped;
  }
  return { counts, perTable };
}

export class BundleFileError extends Error {}

/**
 * Write files first (each checked against its SHA-256), then merge all rows in
 * one transaction, parents before children. A bad file stops the import
 * before any row changes.
 */
export async function applyBundle(tables: Bundle['tables'], files: Map<string, Uint8Array>): Promise<ImportPlan> {
  const plan = planImport(tables);

  for (const a of (tables.attachments ?? []) as unknown as Attachment[]) {
    if (a.deleted_at) continue;
    const bytes = files.get(a.file_name);
    const have = fileFor(a);
    if (!bytes) {
      if (have.exists) continue; // already on this phone
      continue; // the sender had no copy either; the row still imports
    }
    const hash = await sha256Hex(bytes);
    if (hash !== a.sha256) throw new BundleFileError(a.file_name);
    if (!have.exists) writeAttachmentBytes(a.file_name, bytes);
  }

  tx(() => {
    for (const t of DATA_TABLES) for (const r of tables[t] ?? []) mergeRow(t, r);
  });
  notify();
  return plan;
}
