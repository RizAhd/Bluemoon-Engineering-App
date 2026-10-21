/**
 * Domain writes. Screens call these, never `save()` directly, so every
 * record is validated the same way before it reaches the database.
 */
import { isValidDay } from '@/lib/dates';

import { first, getDb, notify, remove, save, tx } from './index';
import type { ExpenseCategory, PayMethod, ProjectStatus, WageKind } from './types';

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
  if (e.project_id && !exists('projects', e.project_id)) throw new ValidationError('project_id', 'errProject');
  if (e.kind === 'work' && (e.days == null || !(e.days > 0) || e.days > 31)) throw new ValidationError('days', 'errDays');
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
  table: 'projects' | 'expenses' | 'workers' | 'wage_entries' | 'tools' | 'tool_movements' | 'site_notes',
  id: string,
) {
  const d = getDb();
  tx(() => {
    const atts = d.getAllSync<{ id: string }>(
      'SELECT id FROM attachments WHERE owner_table = ? AND owner_id = ? AND deleted_at IS NULL',
      [table, id],
    );
    atts.forEach((a) => remove('attachments', a.id));
    remove(table, id);
  });
  notify();
}
