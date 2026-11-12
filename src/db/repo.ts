/**
 * Domain writes. Screens call these, never `save()` directly, so every
 * record is validated the same way before it reaches the database.
 */
import { isValidDay } from '@/lib/dates';
import { dayWage } from '@/lib/wages';

import { all, first, getDb, notify, remove, save, tx } from './index';
import type { ExpenseCategory, PayMethod, ProjectStatus, ProjectWorker, WageKind } from './types';

export class ValidationError extends Error {
  constructor(public field: string, public key: string) {
    super(`${field}: ${key}`);
  }
}

export function req(value: string | null | undefined, field: string, key: string): string {
  const v = (value ?? '').trim();
  if (!v) throw new ValidationError(field, key);
  return v;
}

export function opt(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return v ? v : null;
}

export function day(value: string, field = 'day'): string {
  if (!isValidDay(value)) throw new ValidationError(field, 'errDate');
  return value;
}

/** One expense or wage above Rs 100,000,000 is a slipped finger, not a real bill: refuse it and say to check. */
export const MAX_ENTRY_CENTS = 10_000_000_000;

function cents(value: number | null, field = 'amount'): number {
  if (value == null || !Number.isSafeInteger(value) || value <= 0) throw new ValidationError(field, 'errAmount');
  if (value > MAX_ENTRY_CENTS) throw new ValidationError(field, 'errAmountTooBig');
  return value;
}

/** A contract value is whole, non-negative cents, or nothing. */
function contract(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new ValidationError('contract', 'errAmount');
  return value;
}

export function exists(table: string, id: string | null | undefined): boolean {
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
  const name = req(p.name, 'name', 'errName');
  const contract_cents = contract(p.contract_cents);
  const start_date = p.start_date ? day(p.start_date, 'start_date') : null;
  const end_date = p.end_date ? day(p.end_date, 'end_date') : null;
  // Days are zero-padded YYYY-MM-DD, so comparing the strings compares the dates.
  if (start_date && end_date && end_date < start_date) throw new ValidationError('end_date', 'errDate');
  return save('projects', {
    id: p.id,
    name,
    client: opt(p.client),
    location: opt(p.location),
    contract_cents,
    start_date,
    end_date,
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

// ---------------------------------------------------------------- money received from the client

/**
 * One payment from the client towards a project. Over the project value is allowed (extra work is real): the
 * screen says "over by", the database does not refuse.
 */
export function saveReceipt(r: {
  id?: string;
  project_id: string | null;
  day: string;
  amount_cents: number | null;
  method: PayMethod;
  note?: string | null;
}): string {
  if (!exists('projects', r.project_id)) throw new ValidationError('project_id', 'errProject');
  return save('project_receipts', {
    id: r.id,
    project_id: r.project_id,
    day: day(r.day),
    amount_cents: cents(r.amount_cents),
    method: r.method,
    note: opt(r.note),
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
  if (rate > MAX_ENTRY_CENTS) throw new ValidationError('daily_rate', 'errAmountTooBig');
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
  const d = day(e.day);
  const amount = cents(e.amount_cents);
  return tx(() => {
    // The daily sheet shows one line per worker and day, so a second 'work' entry for the same day
    // would double the wages unseen. Refuse it, the person can open the existing one (recordWorkDay
    // updates it in place and so never comes through here).
    if (e.kind === 'work') {
      const other = first<{ id: string }>(
        `SELECT id FROM wage_entries
         WHERE worker_id = ? AND project_id = ? AND day = ? AND kind = 'work' AND deleted_at IS NULL AND id IS NOT ?
         LIMIT 1`,
        [e.worker_id, e.project_id, d, e.id ?? null],
      );
      if (other) throw new ValidationError('day', 'errWorkDayExists');
    }
    return save('wage_entries', {
      id: e.id,
      worker_id: e.worker_id,
      project_id: e.project_id,
      day: d,
      kind: e.kind,
      days: e.kind === 'work' ? e.days ?? null : null,
      amount_cents: amount,
      note: opt(e.note),
    });
  });
}

// ---------------------------------------------------------------- workers on a project

function nonNegCents(value: number | null | undefined, field: string): number {
  const v = value ?? 0;
  if (!Number.isSafeInteger(v) || v < 0) throw new ValidationError(field, 'errAmount');
  if (v > MAX_ENTRY_CENTS) throw new ValidationError(field, 'errAmountTooBig');
  return v;
}

/** The assignment row (including a soft-deleted one, so it can be revived). */
function findAssignment(project_id: string, worker_id: string): ProjectWorker | null {
  return first<ProjectWorker>(
    'SELECT * FROM project_workers WHERE project_id = ? AND worker_id = ? ORDER BY (deleted_at IS NULL) DESC, updated_at DESC, id DESC LIMIT 1',
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

/**
 * Take a worker off a project (soft delete). Their wage history on it stays.
 * Removes every live row of the pair: after two phones were merged there can be two.
 */
export function unassignWorker(project_id: string, worker_id: string): void {
  tx(() => {
    const live = all<{ id: string }>('SELECT id FROM project_workers WHERE project_id = ? AND worker_id = ? AND deleted_at IS NULL', [project_id, worker_id]);
    live.forEach((r) => remove('project_workers', r.id));
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

/** The live 'work' entries of one day, oldest first. Normally one; more after a merge or a wage-form entry. */
function findWorkEntries(project_id: string, worker_id: string, dayStr: string): { id: string }[] {
  return all<{ id: string }>(
    `SELECT id FROM wage_entries
     WHERE worker_id = ? AND project_id = ? AND day = ? AND kind = 'work' AND deleted_at IS NULL
     ORDER BY created_at, id`,
    [worker_id, project_id, dayStr],
  );
}

/**
 * Mark a day worked. ONE 'work' entry per worker + project + day: calling it
 * again updates days/amount/note. The amount defaults to days x the project rate.
 * The daily sheet shows a day's total, so if more than one entry exists for the day
 * (two phones merged, or the wage form) the rest are removed and the day is exactly what was saved.
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
      amount = cents(dayWage(days, rate)); // the same limit as a typed wage
    }
    const [keep, ...extra] = findWorkEntries(p.project_id, p.worker_id, d);
    const id = save('wage_entries', {
      id: keep?.id,
      worker_id: p.worker_id,
      project_id: p.project_id,
      day: d,
      kind: 'work',
      days,
      amount_cents: amount,
      note: opt(p.note),
    });
    extra.forEach((e) => remove('wage_entries', e.id));
    return id;
  });
}

/** Un-mark a day: soft-deletes that day's work entries. Payments that day stay. */
export function removeWorkDay(project_id: string, worker_id: string, dayStr: string): void {
  const d = day(dayStr);
  tx(() => {
    findWorkEntries(project_id, worker_id, d).forEach((e) => remove('wage_entries', e.id));
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

/**
 * A day's work and the payment handed over with it, saved together: both or neither.
 * `payCents` 0 records only the work (the same as saveWageEntry with kind 'work').
 */
export function recordWorkAndPay(
  work: { id?: string; worker_id: string | null; project_id: string | null; day: string; days: number; amount_cents: number | null; note?: string | null },
  payCents: number,
): string {
  if (!Number.isSafeInteger(payCents) || payCents < 0) throw new ValidationError('pay', 'errAmount');
  if (payCents > MAX_ENTRY_CENTS) throw new ValidationError('pay', 'errAmountTooBig'); // under Pay now, not under the wage
  return tx(() => {
    const id = saveWageEntry({ ...work, kind: 'work' });
    // saveWageEntry has already refused a missing worker or project
    if (payCents > 0) payWages({ project_id: work.project_id as string, worker_id: work.worker_id as string, day: work.day, amount_cents: payCents });
    return id;
  });
}

// ---------------------------------------------------------------- tools

/** One tool or material is at most a million units. */
const MAX_QTY_MILLI = 1_000_000_000;

/**
 * A count in thousandths. A tool is counted in whole pieces and has at least one; a material may have decimals
 * ("2.5 bags") and may be at 0 (stock not bought yet) when `allowZero`.
 */
function qtyMilli(value: number | null | undefined, isMaterial: boolean, allowZero = false, field = 'qty'): number {
  if (value == null || !Number.isSafeInteger(value) || value < 0 || value > MAX_QTY_MILLI || (value === 0 && !allowZero)) throw new ValidationError(field, 'errQty');
  if (!isMaterial && value % 1000 !== 0) throw new ValidationError(field, 'errQtyWhole');
  return value;
}

interface StockRow {
  q: number;
  o: number;
  /** 1 for a material. */
  mat: number;
}

/** A tool kept as one piece (every tool from before quantities): it is out when its latest movement is an issue. */
const isSingle = (r: { q: number; mat: number } | null): boolean => !!r && r.q === 1000 && !r.mat;

/**
 * Quantity and units out of one tool: the same numbers every screen shows (v_tool_stock), which counts a single
 * piece by its latest movement and anything else as issued minus returned.
 */
function stockOf(toolId: string): StockRow | null {
  return first<StockRow>('SELECT quantity_milli AS q, is_material AS mat, out_milli AS o FROM v_tool_stock WHERE tool_id = ?', [toolId]);
}

/** How far a count is from being possible: more out than there is, or a negative number out. 0 = fine. */
function stockViolation(r: StockRow | null): number {
  if (!r) return 0;
  return r.o < 0 ? -r.o : r.o > r.q ? r.o - r.q : 0;
}

/**
 * Throws (so the transaction rolls back) when a change leaves the count of a tool with several pieces, or of a
 * material, worse than it was: more out than there is in store, or more returned than was ever issued. A count that
 * was already wrong (two phones merged) can still be repaired step by step, because only getting worse is refused.
 * A single piece has no count to check: its own rule is "out when the latest movement is an issue".
 */
export function assertStockNotWorse(toolId: string, before: StockRow | null, tooLittleKey: 'errStockShort' | 'errReturnTooMany' | 'errStockInvalid') {
  const after = stockOf(toolId);
  if (isSingle(after) && isSingle(before)) return;
  if (stockViolation(after) <= stockViolation(before)) return;
  throw new ValidationError('qty', tooLittleKey);
}

export function saveTool(t: {
  id?: string;
  name: string;
  code?: string | null;
  notes?: string | null;
  quantity_milli?: number | null;
  unit?: string | null;
  is_material?: boolean;
}): string {
  const current = t.id ? first<{ quantity_milli: number; is_material: number; unit: string | null }>('SELECT quantity_milli, is_material, unit FROM tools WHERE id = ?', [t.id]) : null;
  const isMaterial = t.is_material ?? !!current?.is_material;
  const quantity = qtyMilli(t.quantity_milli ?? current?.quantity_milli ?? 1000, isMaterial, isMaterial);
  return tx(() => {
    const before = t.id ? stockOf(t.id) : null;
    if (t.id && current && quantity === 1000 && !isMaterial && !isSingle({ q: current.quantity_milli, mat: current.is_material })) {
      // Becoming a single piece: it is then out when its latest movement is an issue, so that must agree with what the
      // history adds up to, or the tool would read one way here and another there.
      const counted = before?.o ?? 0;
      const lastKind = first<{ kind: string }>('SELECT kind FROM tool_movements WHERE tool_id = ? AND deleted_at IS NULL ORDER BY day DESC, created_at DESC LIMIT 1', [t.id])?.kind;
      if (counted !== (lastKind === 'issue' ? 1000 : 0)) throw new ValidationError('qty', 'errStockInvalid');
    }
    const id = save('tools', {
      id: t.id,
      name: req(t.name, 'name', 'errName'),
      code: opt(t.code),
      notes: opt(t.notes),
      quantity_milli: quantity,
      unit: t.unit === undefined ? (current?.unit ?? null) : opt(t.unit),
      is_material: isMaterial ? 1 : 0,
    });
    // the total can go up any time, and down only as far as what is still out
    assertStockNotWorse(id, before, 'errStockInvalid');
    return id;
  });
}

export function moveTool(m: {
  id?: string;
  tool_id: string;
  kind: 'issue' | 'return';
  project_id?: string | null;
  worker_id?: string | null;
  taken_by?: string | null;
  /** How many (thousandths); 1000 = one piece, the default. */
  qty_milli?: number | null;
  day: string;
  condition?: string | null;
  note?: string | null;
}): string {
  if (!exists('tools', m.tool_id)) throw new ValidationError('tool_id', 'errTool');
  const kindOf = first<{ q: number; mat: number }>('SELECT quantity_milli AS q, is_material AS mat FROM tools WHERE id = ?', [m.tool_id]);
  const material = !!kindOf?.mat;
  // A single piece is always one: the form has no "How many?" box for it, so another count is refused under the tool.
  const single = isSingle(kindOf);
  if (single && m.qty_milli != null && m.qty_milli !== 1000) throw new ValidationError('tool_id', 'errToolState');
  const qty = single ? 1000 : qtyMilli(m.qty_milli ?? 1000, material);
  if (m.kind === 'issue' && !m.worker_id && !opt(m.taken_by)) throw new ValidationError('taken_by', 'errWorker');
  const d = day(m.day);
  return tx(() => {
    // Judge the movement against the tool's latest one, ordered exactly as v_tool_status orders them
    // (newest day, then the one entered last). The row being edited is not its own predecessor.
    const last = first<{ id: string; kind: 'issue' | 'return'; day: string }>(
      `SELECT id, kind, day FROM tool_movements
       WHERE tool_id = ? AND deleted_at IS NULL AND id IS NOT ?
       ORDER BY day DESC, created_at DESC LIMIT 1`,
      [m.tool_id, m.id ?? null],
    );
    // A record dated before the last one would not change where the tool is (the view goes by day),
    // so the history would say one thing and the tool status another.
    if (last && d < last.day) throw new ValidationError('day', 'errDateBeforeLast');
    // A single piece is out when its latest movement is an issue (what v_tool_status says), whoever brings it back:
    // issued twice or returned twice in a row is refused, in the words it always had.
    if (single) {
      if (m.kind === 'issue' && last?.kind === 'issue') throw new ValidationError('tool_id', 'errToolState');
      if (m.kind === 'return' && (!last || last.kind === 'return')) throw new ValidationError('tool_id', 'errToolState');
    }
    const before = stockOf(m.tool_id);
    const id = save('tool_movements', {
      id: m.id, // the form's id, so photos attached before saving belong to this row
      tool_id: m.tool_id,
      kind: m.kind,
      qty_milli: qty,
      project_id: m.project_id ?? null,
      worker_id: m.worker_id ?? null,
      taken_by: opt(m.taken_by),
      day: d,
      condition: opt(m.condition),
      note: opt(m.note),
    });
    // Out can never be more than there is, nor less than nothing: you cannot issue more than is in store or return
    // more than is out (a single piece was judged above).
    if (!single) assertStockNotWorse(m.tool_id, before, m.kind === 'issue' ? 'errStockShort' : 'errReturnTooMany');
    return id;
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

/** Soft-deletes a record and its attachments together. Deleting a project or a tool also deletes what belongs to it. */
export function deleteRecord(
  table: 'projects' | 'expenses' | 'workers' | 'project_workers' | 'wage_entries' | 'tools' | 'tool_movements' | 'site_notes' | 'project_receipts',
  id: string,
) {
  const d = getDb();
  /** A row and the photos / PDFs attached to it. */
  const removeWithFiles = (t: Parameters<typeof remove>[0], rowId: string) => {
    d.getAllSync<{ id: string }>('SELECT id FROM attachments WHERE owner_table = ? AND owner_id = ? AND deleted_at IS NULL', [t, rowId]).forEach((a) =>
      remove('attachments', a.id),
    );
    remove(t, rowId);
  };
  tx(() => {
    if (table === 'projects') {
      // Cascade so lists/totals that do not join v_project_cost stop counting them; their photos go with them.
      for (const child of ['expenses', 'site_notes', 'wage_entries', 'tool_movements', 'project_workers', 'project_receipts'] as const) {
        d.getAllSync<{ id: string }>(`SELECT id FROM ${child} WHERE project_id = ? AND deleted_at IS NULL`, [id]).forEach((r) => removeWithFiles(child, r.id));
      }
    }
    if (table === 'tools') {
      // A deleted tool takes its issue/return history (and the photos on it) with it, so no live
      // movement is left pointing at a tool that no longer exists.
      d.getAllSync<{ id: string }>('SELECT id FROM tool_movements WHERE tool_id = ? AND deleted_at IS NULL', [id]).forEach((r) => removeWithFiles('tool_movements', r.id));
    }
    // Taking out one issue (or return) must not leave the count impossible, e.g. returns with nothing issued before them.
    const movementTool = table === 'tool_movements' ? first<{ tool_id: string }>('SELECT tool_id FROM tool_movements WHERE id = ?', [id])?.tool_id : undefined;
    const before = movementTool ? stockOf(movementTool) : null;
    removeWithFiles(table, id);
    if (movementTool) assertStockNotWorse(movementTool, before, 'errStockInvalid');
  });
  notify();
}
