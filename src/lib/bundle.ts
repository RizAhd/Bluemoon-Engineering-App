/**
 * A "bundle" is a set of rows plus the files they point to. It is what travels
 * inside an exported project PDF and inside a full backup. Rows keep their
 * UUIDs and versions, so importing the same bundle twice changes nothing.
 * Deleted rows travel too, so a deletion on one phone reaches the other.
 */
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { all, classifyRow, getDb, mergeRow, notify, tx, type MergeResult } from '@/db';
import { DATA_TABLES, type DataTable } from '@/db/schema';
import type { Attachment, Estimate, EstimateItem } from '@/db/types';

import { reportError } from './errors';
import { estimateSums } from './estimate';
import { fileFor, isSafeFileName, writeAttachmentBytes } from './files';

export const BUNDLE_FORMAT = 'bluemoon-bundle';
export const BUNDLE_VERSION = 1;

type Row = Record<string, string | number | null>;

export interface Bundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  kind: 'project' | 'backup' | 'estimate';
  exported_at: string;
  device_id: string;
  project_id?: string;
  project_name?: string;
  /** Set when kind is 'estimate'. */
  estimate_id?: string;
  estimate_number?: string;
  tables: Partial<Record<DataTable, Row[]>>;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * One estimate with its lines and stages, the deleted ones too (a removed line must reach the other
 * phone). Nothing else travels with it: a project it was turned into has its own bundle.
 */
export function collectEstimate(estimateId: string): Bundle['tables'] {
  return {
    estimates: all<Row>('SELECT * FROM estimates WHERE id = ?', [estimateId]),
    estimate_items: estimateChildren('estimate_items', [estimateId]),
    estimate_payments: estimateChildren('estimate_payments', [estimateId]),
  };
}

function estimateChildren(table: 'estimate_items' | 'estimate_payments', estimateIds: string[]): Row[] {
  if (!estimateIds.length) return [];
  return all<Row>(
    `SELECT * FROM ${table} WHERE estimate_id IN (${estimateIds.map(() => '?').join(',')}) ORDER BY estimate_id, position, created_at, id`,
    estimateIds,
  );
}

/** Rows for one project and everything they refer to (workers, tools, photos). */
export function collectProject(projectId: string): Bundle['tables'] {
  const projects = all<Row>('SELECT * FROM projects WHERE id = ?', [projectId]);
  const expenses = all<Row>('SELECT * FROM expenses WHERE project_id = ?', [projectId]);
  const wages = all<Row>('SELECT * FROM wage_entries WHERE project_id = ?', [projectId]);
  const assignments = all<Row>('SELECT * FROM project_workers WHERE project_id = ?', [projectId]);
  const projectMoves = all<Row>('SELECT * FROM tool_movements WHERE project_id = ?', [projectId]);
  // v_tool_status uses each tool's latest movement, so carry the tool's whole history.
  const moves = allMovesOfTools(new Set(projectMoves.map((m) => String(m.tool_id))));
  const notes = all<Row>('SELECT * FROM site_notes WHERE project_id = ?', [projectId]);
  // the estimate this project came from, with its lines and stages
  const estimates = all<Row>('SELECT * FROM estimates WHERE project_id = ?', [projectId]);
  const estimateIds = estimates.map((e) => String(e.id));

  const workerIds = new Set<string>();
  wages.forEach((w) => workerIds.add(String(w.worker_id)));
  assignments.forEach((a) => workerIds.add(String(a.worker_id)));
  moves.forEach((m) => m.worker_id && workerIds.add(String(m.worker_id)));
  const toolIds = new Set(moves.map((m) => String(m.tool_id)));
  const workers = byIds('workers', workerIds);
  const tools = byIds('tools', toolIds);

  const owners: [string, Row[]][] = [
    ['projects', projects],
    ['expenses', expenses],
    ['tool_movements', projectMoves],
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
    estimates,
    estimate_items: estimateChildren('estimate_items', estimateIds),
    estimate_payments: estimateChildren('estimate_payments', estimateIds),
    workers,
    tools,
    project_workers: assignments,
    expenses,
    wage_entries: wages,
    tool_movements: moves,
    site_notes: notes,
    attachments,
  };
}

function allMovesOfTools(ids: Set<string>): Row[] {
  if (!ids.size) return [];
  const list = [...ids];
  return all<Row>(`SELECT * FROM tool_movements WHERE tool_id IN (${list.map(() => '?').join(',')})`, list);
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
  return ((tables.attachments ?? []) as unknown as Attachment[]).filter((a) => {
    if (a.deleted_at) return false;
    const f = fileFor(a);
    // A file whose size differs from its row is truncated; never pack it into a bundle.
    return f.exists && (!a.size || f.size === a.size);
  });
}

export function readFileBytes(att: Attachment): Uint8Array {
  return new File(fileFor(att).uri).bytesSync();
}

// ---------------------------------------------------------------- import

export interface ImportPlan {
  /** Files whose bytes did not match their recorded SHA-256; their rows were still imported. */
  badFiles: string[];
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
  return { counts, perTable, badFiles: [] };
}

/** What an estimate in a bundle looks like on the import preview. */
export interface EstimatePreview {
  id: string;
  number: string;
  client_name: string;
  title: string;
  status: Estimate['status'];
  issue_day: string;
  item_count: number;
  total_cents: number;
  /** Whether the same id is already on this phone (so the import updates it instead of adding it). */
  on_this_phone: boolean;
}

/**
 * The live estimates of a bundle with their totals, worked out from the bundle's own rows with the same
 * sums as v_estimate_total. For the import preview, before anything is written.
 */
export function previewEstimates(tables: Bundle['tables']): EstimatePreview[] {
  const items = ((tables.estimate_items ?? []) as unknown as EstimateItem[]).filter((i) => !i.deleted_at);
  return ((tables.estimates ?? []) as unknown as Estimate[])
    .filter((e) => !e.deleted_at)
    .map((e) => {
      const lines = items.filter((i) => i.estimate_id === e.id);
      return {
        id: e.id,
        number: e.number,
        client_name: e.client_name,
        title: e.title,
        status: e.status,
        issue_day: e.issue_day,
        item_count: lines.length,
        total_cents: estimateSums(lines, e.discount_cents, e.tax_bp).total_cents,
        on_this_phone: !!getDb().getFirstSync('SELECT 1 FROM estimates WHERE id = ?', [e.id]),
      };
    });
}

export class BundleFileError extends Error {}

/**
 * Write files first (each checked against its SHA-256), then merge all rows in
 * one transaction, parents before children. A file that fails its check is
 * skipped and listed in `badFiles`; the rows are still imported.
 */
export async function applyBundle(tables: Bundle['tables'], files: Map<string, Uint8Array>): Promise<ImportPlan> {
  const plan = planImport(tables);

  for (const a of (tables.attachments ?? []) as unknown as Attachment[]) {
    if (a.deleted_at) continue;
    const bytes = files.get(a.file_name);
    if (!bytes) continue; // already on this phone, or the sender had no copy either; the row still imports
    if (!isSafeFileName(a.file_name)) {
      // a name that points outside the attachments folder is never written to
      plan.badFiles.push(a.file_name);
      continue;
    }
    try {
      const have = fileFor(a);
      if ((await sha256Hex(bytes)) !== a.sha256) {
        plan.badFiles.push(a.file_name);
        continue;
      }
      // Rewrite a copy that is missing or truncated (size differs from the row).
      if (!have.exists || (a.size && have.size !== a.size)) writeAttachmentBytes(a.file_name, bytes);
    } catch (e) {
      reportError(e, 'applyBundle.file', { file: a.file_name });
      plan.badFiles.push(a.file_name);
    }
  }

  // A tool's history (carried whole, so its status is right) can mention a project this phone does
  // not have, and so can an estimate that was turned into a project on the sender's phone: those two
  // references are allowed to dangle until the project arrives (the link is kept, so the estimate is not
  // offered as a project a second time, and it resolves when the project is imported later). Every other
  // reference is still enforced, but after the merge instead of row by row. PRAGMA foreign_keys
  // can only change outside a transaction.
  const d = getDb();
  d.execSync('PRAGMA foreign_keys = OFF');
  try {
    tx(() => {
      for (const t of DATA_TABLES) for (const r of tables[t] ?? []) mergeRow(t, r);
      assertReferences(d);
    });
  } finally {
    d.execSync('PRAGMA foreign_keys = ON');
  }
  notify();
  return plan;
}

/** Every reference must point at a row, except a tool movement's or an estimate's project. Throws (and so rolls the import back) otherwise. */
function assertReferences(d: ReturnType<typeof getDb>) {
  const broken = d
    .getAllSync<{ table: string; parent: string }>('PRAGMA foreign_key_check')
    .filter((v) => !((v.table === 'tool_movements' || v.table === 'estimates') && v.parent === 'projects'));
  if (broken.length) {
    const what = [...new Set(broken.map((v) => `${v.table} -> ${v.parent}`))].join(', ');
    throw new Error(`FOREIGN KEY constraint failed: ${what}`);
  }
}
