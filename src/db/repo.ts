/**
 * Domain writes. Screens call these, never `save()` directly, so every
 * record is validated the same way before it reaches the database.
 */
import { isValidDay } from '@/lib/dates';

import { first, getDb, notify, remove, save, tx } from './index';
import type { ExpenseCategory, PayMethod, ProjectStatus, ProjectWorker, WageKind } from './types';

export class ValidationError extends Error {
  constructor(public field: string, public key: string) {
    super(`${field}: ${key}`);
  }
}

function req(value: string | null | undefined, field: string, key: string): string {
  const v = (value ?? '').trim();
  if (!v) throw new ValidationError(field, key);
  return v;
}

function opt(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return v ? v : null;
}

function day(value: string, field = 'day'): string {
  if (!isValidDay(value)) throw new ValidationError(field, 'errDate');
  return value;
}

function cents(value: number | null, field = 'amount'): number {
  if (value == null || !Number.isSafeInteger(value) || value <= 0) throw new ValidationError(field, 'errAmount');
  return value;
}

function exists(table: string, id: string | null | undefined): boolean {
  if (!id) return false;
  return !!first(`SELECT 1 AS ok FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id]);
}

// ---------------------------------------------------------------- projects

export function saveProject(p: {
  id?: string;
  name: string;
  client?: string | null;
  location?: string | null;
  contract_cents?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: ProjectStatus;
  notes?: string | null;
}): string {
  return save('projects', {
    id: p.id,
    name: req(p.name, 'name', 'errName'),
    client: opt(p.client),
    location: opt(p.location),
    contract_cents: p.contract_cents ?? null,
    start_date: p.start_date ? day(p.start_date, 'start_date') : null,
    end_date: p.end_date ? day(p.end_date, 'end_date') : null,
    status: p.status ?? 'active',
    notes: opt(p.notes),
  });
}

// ---------------------------------------------------------------- expenses

export function saveExpense(e: {
  id?: string;
  project_id: string | null;
  day: string;
  category: ExpenseCategory | null;
  amount_cents: number | null;
  paid_to?: string | null;
  method: PayMethod;
  note?: string | null;
}): string {
  if (!exists('projects', e.project_id)) throw new ValidationError('project_id', 'errProject');
  if (!e.category) throw new ValidationError('category', 'errAmount');
  return save('expenses', {
    id: e.id,
    project_id: e.project_id,
    day: day(e.day),
    category: e.category,
    amount_cents: cents(e.amount_cents),
    paid_to: opt(e.paid_to),
    method: e.method,
    note: opt(e.note),
  });
}

// ---------------------------------------------------------------- workers & wages

export function saveWorker(w: {
  id?: string;
  name: string;
  phone?: string | null;
  trade?: string | null;
  daily_rate_cents: number | null;
  active?: boolean;
}): string {
  const rate = w.daily_rate_cents ?? 0;
  if (!Number.isSafeInteger(rate) || rate < 0) throw new ValidationError('daily_rate', 'errAmount');
  return save('workers', {
    id: w.id,
    name: req(w.name, 'name', 'errName'),
    phone: opt(w.phone),
    trade: opt(w.trade),
    daily_rate_cents: rate,
    active: w.active === false ? 0 : 1,
  });
}

function workDays(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || !(value > 0) || value > 31) throw new ValidationError('days', 'errDays');
  return value;
}

export function saveWageEntry(e: {
  id?: string;
  worker_id: string | null;
  project_id: string | null;
  day: string;
  kind: WageKind;
  days?: number | null;
  amount_cents: number | null;
  note?: string | null;
}): string {
  if (!exists('workers', e.worker_id)) throw new ValidationError('worker_id', 'errWorker');
  if (!exists('projects', e.project_id)) throw new ValidationError('project_id', 'errProject');
  if (e.kind === 'work') workDays(e.days);
  return save('wage_entries', {
    id: e.id,
    worker_id: e.worker_id,
    project_id: e.project_id,
    day: day(e.day),
    kind: e.kind,
    days: e.kind === 'work' ? e.days ?? null : null,
    amount_cents: cents(e.amount_cents),
    note: opt(e.note),
  });
}

// ---------------------------------------------------------------- workers on a project

function nonNegCents(value: number | null | undefined, field: string): number {
  const v = value ?? 0;
  if (!Number.isSafeInteger(v) || v < 0) throw new ValidationError(field, 'errAmount');
  return v;
}

/** The assignment row (including a soft-deleted one, so it can be revived). */
function findAssignment(project_id: string, worker_id: string): ProjectWorker | null {
  return first<ProjectWorker>(
    'SELECT * FROM project_workers WHERE project_id = ? AND worker_id = ? ORDER BY (deleted_at IS NULL) DESC, updated_at DESC LIMIT 1',
    [project_id, worker_id],
  );
}

/**
 * Put a worker on a project with the rate agreed for that project. One logical
 * row per (project, worker): assigning again updates the rate and re-activates
 * the row (also when it was removed earlier), never inserting a duplicate.
 */
export function assignWorker(p: { project_id: string; worker_id: string; rate_cents: number }): string {
  if (!exists('projects', p.project_id)) throw new ValidationError('project_id', 'errProject');
  if (!exists('workers', p.worker_id)) throw new ValidationError('worker_id', 'errWorker');
  const rate = nonNegCents(p.rate_cents, 'rate');
  return tx(() => {
    const existing = findAssignment(p.project_id, p.worker_id);
    return save('project_workers', {
      id: existing?.id,
      project_id: p.project_id,
      worker_id: p.worker_id,
      rate_cents: rate,
      active: 1,
      deleted_at: null,
    });
  });
}

/** Take a worker off a project (soft delete). Their wage history on it stays. */
export function unassignWorker(project_id: string, worker_id: string): void {
  tx(() => {
    const existing = findAssignment(project_id, worker_id);
    if (existing && !existing.deleted_at) remove('project_workers', existing.id);
  });
}

export function setProjectWorkerRate(project_id: string, worker_id: string, rate_cents: number): void {
  const rate = nonNegCents(rate_cents, 'rate');
  tx(() => {
    const existing = findAssignment(project_id, worker_id);
    if (!existing || existing.deleted_at) throw new ValidationError('worker_id', 'errWorker');
    save('project_workers', { id: existing.id, rate_cents: rate });
  });
}

/** The rate for a worker on a project; falls back to the worker's default daily rate. */
function projectRate(project_id: string, worker_id: string): number {
  const pw = findAssignment(project_id, worker_id);
  if (pw && !pw.deleted_at) return pw.rate_cents;
  return first<{ daily_rate_cents: number }>('SELECT daily_rate_cents FROM workers WHERE id = ?', [worker_id])?.daily_rate_cents ?? 0;
}

function findWorkEntry(project_id: string, worker_id: string, dayStr: string): { id: string } | null {
  return first<{ id: string }>(
    `SELECT id FROM wage_entries
     WHERE worker_id = ? AND project_id = ? AND day = ? AND kind = 'work' AND deleted_at IS NULL
     ORDER BY created_at LIMIT 1`,
    [worker_id, project_id, dayStr],
  );
}

/**
 * Mark a day worked. ONE 'work' entry per worker + project + day: calling it
 * again updates days/amount/note. The amount defaults to days x the project rate.
 */
export function recordWorkDay(p: {
  project_id: string;
  worker_id: string;
  day: string;
  days: number;
  amount_cents?: number | null;
  note?: string | null;
}): string {
  if (!exists('projects', p.project_id)) throw new ValidationError('project_id', 'errProject');
  if (!exists('workers', p.worker_id)) throw new ValidationError('worker_id', 'errWorker');
  const d = day(p.day);
  const days = workDays(p.days);
  return tx(() => {
    let amount: number;
    if (p.amount_cents != null) {
      amount = cents(p.amount_cents);
    } else {
      const rate = projectRate(p.project_id, p.worker_id);
      if (rate <= 0) throw new ValidationError('rate', 'rateRequired');
      amount = Math.round(days * rate);
    }
    const existing = findWorkEntry(p.project_id, p.worker_id, d);
    return save('wage_entries', {
      id: existing?.id,
      worker_id: p.worker_id,
      project_id: p.project_id,
      day: d,
      kind: 'work',
      days,
      amount_cents: amount,
      note: opt(p.note),
    });
  });
}

/** Un-mark a day: soft-deletes that day's work entry. Payments that day stay. */
export function removeWorkDay(project_id: string, worker_id: string, dayStr: string): void {
  const d = day(dayStr);
  tx(() => {
    const existing = findWorkEntry(project_id, worker_id, d);
    if (existing) remove('wage_entries', existing.id);
  });
}

/** Money handed to a worker for this project (a 'payment' entry). */
export function payWages(p: { project_id: string; worker_id: string; day: string; amount_cents: number; note?: string | null }): string {
  return saveWageEntry({
    worker_id: p.worker_id,
    project_id: p.project_id,
    day: p.day,
    kind: 'payment',
    amount_cents: p.amount_cents,
    note: p.note,
  });
}

// ---------------------------------------------------------------- tools

export function saveTool(t: { id?: string; name: string; code?: string | null; notes?: string | null }): string {
  return save('tools', {
    id: t.id,
    name: req(t.name, 'name', 'errName'),
    code: opt(t.code),
    notes: opt(t.notes),
  });
}

export function moveTool(m: {
  id?: string;
  tool_id: string;
  kind: 'issue' | 'return';
  project_id?: string | null;
  worker_id?: string | null;
  taken_by?: string | null;
  day: string;
  condition?: string | null;
  note?: string | null;
}): string {
  if (!exists('tools', m.tool_id)) throw new ValidationError('tool_id', 'errName');
  if (m.kind === 'issue' && !m.worker_id && !opt(m.taken_by)) throw new ValidationError('taken_by', 'errWorker');
  return save('tool_movements', {
    id: m.id, // the form's id, so photos attached before saving belong to this row
    tool_id: m.tool_id,
    kind: m.kind,
    project_id: m.project_id ?? null,
    worker_id: m.worker_id ?? null,
    taken_by: opt(m.taken_by),
    day: day(m.day),
    condition: opt(m.condition),
    note: opt(m.note),
  });
}

// ---------------------------------------------------------------- site notes

export function saveNote(n: { id?: string; project_id: string | null; day: string; body: string; weather?: string | null }): string {
  if (!exists('projects', n.project_id)) throw new ValidationError('project_id', 'errProject');
  return save('site_notes', {
    id: n.id,
    project_id: n.project_id,
    day: day(n.day),
    body: req(n.body, 'body', 'errNote'),
    weather: opt(n.weather),
  });
}

// ---------------------------------------------------------------- delete

/** Soft-deletes a record and its attachments together. */
export function deleteRecord(
  table: 'projects' | 'expenses' | 'workers' | 'project_workers' | 'wage_entries' | 'tools' | 'tool_movements' | 'site_notes',
  id: string,
) {
  const d = getDb();
  tx(() => {
    const atts = d.getAllSync<{ id: string }>(
      'SELECT id FROM attachments WHERE owner_table = ? AND owner_id = ? AND deleted_at IS NULL',
      [table, id],
    );
    atts.forEach((a) => remove('attachments', a.id));
    if (table === 'projects') {
      // Cascade so lists/totals that do not join v_project_cost stop counting them.
      for (const child of ['expenses', 'site_notes', 'wage_entries', 'tool_movements', 'project_workers'] as const) {
        d.getAllSync<{ id: string }>(`SELECT id FROM ${child} WHERE project_id = ? AND deleted_at IS NULL`, [id]).forEach((r) =>
          remove(child, r.id),
        );
      }
    }
    remove(table, id);
  });
  notify();
}
