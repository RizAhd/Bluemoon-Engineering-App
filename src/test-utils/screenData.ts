/**
 * Lookups and small builders for screen tests, on top of the demo data set
 * (src/lib/demoData.ts) and the real domain functions in src/db/repo.ts.
 */
import { all, first, setSetting } from '@/db';
import {
  assignWorker,
  recordWorkDay,
  saveExpense,
  saveNote,
  saveProject,
  saveTool,
  saveWorker,
} from '@/db/repo';
import { addDays, today } from '@/lib/dates';

export const SCHOOL = 'Welimada Primary School Building';
export const CULVERT = 'Badulla Culvert Repair';
export const DRAIN = 'Bandarawela Drain Renovation';

function idOf(table: string, column: string, value: string): string {
  const row = first<{ id: string }>(`SELECT id FROM ${table} WHERE ${column} = ? AND deleted_at IS NULL`, [value]);
  if (!row) throw new Error(`No ${table} row with ${column} = ${value}`);
  return row.id;
}

export const projectId = (name: string) => idOf('projects', 'name', name);
export const workerId = (name: string) => idOf('workers', 'name', name);
export const toolId = (name: string) => idOf('tools', 'name', name);

/** Make `id` (or nothing = "All projects") the project the user is working on. */
export function setCurrent(id: string | null) {
  setSetting('current_project', id);
}

/** Id of the expense paid to this person or shop. */
export function expenseId(paidTo: string): string {
  const row = first<{ id: string }>('SELECT id FROM expenses WHERE paid_to = ? AND deleted_at IS NULL', [paidTo]);
  if (!row) throw new Error(`No expense paid to ${paidTo}`);
  return row.id;
}

/** Id of the site note whose text starts with this. */
export function noteId(startsWith: string): string {
  const row = first<{ id: string }>("SELECT id FROM site_notes WHERE body LIKE ? || '%' AND deleted_at IS NULL", [startsWith]);
  if (!row) throw new Error(`No note starting with ${startsWith}`);
  return row.id;
}

export function wageEntryId(workerName: string, kind: 'work' | 'advance' | 'payment'): string {
  const row = first<{ id: string }>(
    `SELECT w.id FROM wage_entries w JOIN workers k ON k.id = w.worker_id
     WHERE k.name = ? AND w.kind = ? AND w.deleted_at IS NULL ORDER BY w.day DESC, w.created_at DESC`,
    [workerName, kind],
  );
  if (!row) throw new Error(`No ${kind} entry for ${workerName}`);
  return row.id;
}

/** Id of a tool movement of the given tool (newest first). */
export function movementId(toolName: string): string {
  const row = first<{ id: string }>(
    `SELECT m.id FROM tool_movements m JOIN tools t ON t.id = m.tool_id
     WHERE t.name = ? AND m.deleted_at IS NULL ORDER BY m.day DESC, m.created_at DESC`,
    [toolName],
  );
  if (!row) throw new Error(`No movement for ${toolName}`);
  return row.id;
}

export function count(table: string, where = '1 = 1', params: (string | number)[] = []): number {
  return first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at IS NULL AND ${where}`, params)?.n ?? 0;
}

export function rows<T>(sql: string, params: (string | number)[] = []): T[] {
  return all<T>(sql, params);
}

/**
 * A project with two workers on it and no work recorded: the starting point for the "tick a
 * worker, pick days, pay, save" flow. Returns the ids; Asanka is on Rs 3,000 a day, Bimal on Rs 2,500.
 */
export function buildCleanSite() {
  const project = saveProject({ name: 'Clean Site', location: 'Kandy', status: 'active' });
  const asanka = saveWorker({ name: 'Asanka Perera', trade: 'Mason', daily_rate_cents: 300_000 });
  const bimal = saveWorker({ name: 'Bimal Silva', trade: 'Helper', daily_rate_cents: 250_000 });
  assignWorker({ project_id: project, worker_id: asanka, rate_cents: 300_000 });
  assignWorker({ project_id: project, worker_id: bimal, rate_cents: 250_000 });
  return { project, asanka, bimal };
}

/** A worker who worked yesterday on the school project (so the day shows "already recorded"). */
export function workYesterday(project: string, worker: string, days = 1) {
  return recordWorkDay({ project_id: project, worker_id: worker, day: addDays(today(), -1), days });
}

/** Extra rows used to cross the "show the search box from 8 projects" threshold. */
export function addManyProjects(n: number) {
  for (let i = 1; i <= n; i++) saveProject({ name: `Extra Project ${i}`, client: `Client ${i}`, location: `Town ${i}`, status: i % 3 === 0 ? 'completed' : 'active' });
}

export function addSimpleExpense(project: string, amountCents = 123_400, paidTo = 'Test Supplier') {
  return saveExpense({ project_id: project, day: today(), category: 'materials', amount_cents: amountCents, paid_to: paidTo, method: 'cash', note: null });
}

export function addSimpleNote(project: string, body = 'A plain test note.') {
  return saveNote({ project_id: project, day: today(), body, weather: null });
}

export function addSimpleTool(name = 'Test Spanner', code: string | null = 'BM-T-099') {
  return saveTool({ name, code });
}

/**
 * An ISO timestamp (UTC, as the app stores them) that falls on local calendar day `day` but on a different
 * UTC day: just after local midnight east of Greenwich (Sri Lanka is UTC+5:30), just before it west of it.
 * `null` where the local zone is UTC itself, because then no such moment exists.
 */
export function isoOnLocalDayOffUtc(day: string): string | null {
  const [y, m, d] = day.split('-').map(Number);
  for (const [hour, minute] of [
    [0, 30],
    [23, 30],
  ]) {
    const at = new Date(y, m - 1, d, hour, minute);
    if (at.toISOString().slice(0, 10) !== day) return at.toISOString();
  }
  return null;
}

/**
 * Local noon today as an ISO timestamp: on the same UTC day as local today in every time zone, so a screen that
 * (wrongly) compares the UTC day with the local day still gets this one right. For tests that are not about time zones.
 */
export function noonToday(): string {
  const [y, m, d] = today().split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0).toISOString();
}
