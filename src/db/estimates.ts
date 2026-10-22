/**
 * Estimates (quotations): header, price lines and payment stages. Screens call these, never
 * `save()` directly, so every rule in docs/ESTIMATES.md section 3 is enforced in one place and every
 * change goes through the single write path (version, audit log, change notification).
 *
 * Field names in a ValidationError are the form's field names (client_name, qty, rate, percent ...);
 * 'estimate' stands for the estimate as a whole and 'payments' for its schedule.
 */
import { getCompanyProfile } from '@/lib/company';
import { today } from '@/lib/dates';
import {
  lineAmount,
  MAX_ESTIMATE_ITEMS,
  MAX_LINE_CENTS,
  MAX_QTY_MILLI,
  MAX_RATE_CENTS,
  nextEstimateNumber,
  parseEstimateNumber,
  STANDARD_SCHEDULE,
} from '@/lib/estimate';

import { all, first, getSetting, remove, save, setSetting, tx } from './index';
import { day as checkDay, opt, req, saveProject, ValidationError } from './repo';
import { ESTIMATE_STATUSES, type Estimate, type EstimateItem, type EstimatePayment, type EstimateStatus, type EstimateTotal } from './types';

/** An estimate with its live lines in position order and its totals from v_estimate_total. */
export interface LoadedEstimate {
  estimate: Estimate;
  items: EstimateItem[];
  payments: EstimatePayment[];
  total: EstimateTotal;
}

const ORDER = 'ORDER BY position, created_at, id';

/** The estimate with its live lines and stages (position order) and its totals; null when it is missing or deleted. */
export function loadEstimate(id: string): LoadedEstimate | null {
  const estimate = first<Estimate>('SELECT * FROM estimates WHERE id = ? AND deleted_at IS NULL', [id]);
  const total = estimate ? first<EstimateTotal>('SELECT * FROM v_estimate_total WHERE estimate_id = ?', [id]) : null;
  if (!estimate || !total) return null;
  return {
    estimate,
    items: all<EstimateItem>(`SELECT * FROM estimate_items WHERE estimate_id = ? AND deleted_at IS NULL ${ORDER}`, [id]),
    payments: all<EstimatePayment>(`SELECT * FROM estimate_payments WHERE estimate_id = ? AND deleted_at IS NULL ${ORDER}`, [id]),
    total,
  };
}

// ---------------------------------------------------------------- helpers

function missing(): never {
  throw new ValidationError('estimate', 'errEstimateMissing');
}

function locked(): never {
  throw new ValidationError('estimate', 'errEstimateLocked');
}

/** The live estimate, or a ValidationError. */
function liveEstimate(id: string | null | undefined): Estimate {
  const e = id ? first<Estimate>('SELECT * FROM estimates WHERE id = ? AND deleted_at IS NULL', [id]) : null;
  return e ?? missing();
}

/** The live estimate whose lines and stages may change: not accepted. */
function editableEstimate(id: string | null | undefined): Estimate {
  const e = liveEstimate(id);
  if (e.status === 'accepted') locked();
  return e;
}

type Child = 'estimate_items' | 'estimate_payments';

/** Keep the positions of an estimate's live lines (or stages) 1, 2, 3 ... in their current order. Heals gaps and ties left by a merge. */
function renumber(table: Child, estimateId: string) {
  all<{ id: string; position: number }>(`SELECT id, position FROM ${table} WHERE estimate_id = ? AND deleted_at IS NULL ${ORDER}`, [estimateId]).forEach(
    (r, i) => {
      if (r.position !== i + 1) save(table, { id: r.id, position: i + 1 });
    },
  );
}

function nextPosition(table: Child, estimateId: string): number {
  return (first<{ p: number | null }>(`SELECT MAX(position) AS p FROM ${table} WHERE estimate_id = ? AND deleted_at IS NULL`, [estimateId])?.p ?? 0) + 1;
}

function totalOf(estimateId: string): EstimateTotal {
  return first<EstimateTotal>('SELECT * FROM v_estimate_total WHERE estimate_id = ?', [estimateId]) ?? missing();
}

/** A discount can never be more than the subtotal: when lines are removed or cheapened it comes down with them. */
function clampDiscount(estimateId: string) {
  const t = totalOf(estimateId);
  if (t.discount_cents > t.subtotal_cents) save('estimates', { id: estimateId, discount_cents: t.subtotal_cents });
}

// ---------------------------------------------------------------- numbers

const seqKey = (year: number) => `estimate_seq_${year}`;

/** The last sequence number this phone handed out (or saw typed) for a year. */
function lastSeq(year: number): number {
  const n = Number(getSetting(seqKey(year)));
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function numberTaken(number: string): boolean {
  return !!first('SELECT 1 AS ok FROM estimates WHERE number = ? AND deleted_at IS NULL', [number]);
}

const yearOf = (dayStr: string) => Number(dayStr.slice(0, 4));

/** The next free number for a year: the counter + 1, skipping any number a live estimate on this phone already has (typed or imported). */
function freeNumber(year: number): string {
  let seq = lastSeq(year);
  let number: string;
  do {
    seq++;
    number = nextEstimateNumber(year, seq);
  } while (numberTaken(number));
  return number;
}

/** A number in the app's own format moves that year's counter up to it, so the counter never hands the same number out twice. */
function noteNumberUsed(number: string) {
  const parsed = parseEstimateNumber(number);
  if (parsed && parsed.seq > lastSeq(parsed.year)) setSetting(seqKey(parsed.year), String(parsed.seq));
}

/** The number a new estimate dated `issueDay` would get now (EST-2026-004). Shown as the form's starting value; reads only. */
export function suggestEstimateNumber(issueDay: string = today()): string {
  return freeNumber(yearOf(issueDay));
}

// ---------------------------------------------------------------- the estimate

export interface EstimateInput {
  /** Omit to create. A new id (from a form) that is not in the table creates the estimate with that id. */
  id?: string;
  /** Blank on create: the next number from this phone's counter. */
  number?: string | null;
  client_name?: string | null;
  client_phone?: string | null;
  client_address?: string | null;
  title?: string | null;
  location?: string | null;
  /** YYYY-MM-DD. Today on create. */
  issue_day?: string;
  /** 1 to 365. The company's default on create. */
  valid_days?: number | null;
  /** Whole cents, 0 up to the current subtotal. */
  discount_cents?: number | null;
  /** Basis points, 0 to 10000 (1800 = 18 %). */
  tax_bp?: number | null;
  /** The company's default terms on create when omitted. */
  terms?: string | null;
  notes?: string | null;
}

/** A field that was not given (undefined) keeps what the saved estimate has; text that is given is trimmed and '' clears it. */
function text(given: string | null | undefined, kept: string | null | undefined): string | null {
  return given === undefined ? kept ?? null : opt(given);
}

/**
 * Create or update the header of an estimate. On create the number, issue day, valid days and terms
 * default from this phone's counter, today and the company profile. Updates change only the fields given.
 * Discount and tax of an accepted estimate cannot change (errEstimateLocked); everything else can.
 */
export function saveEstimate(e: EstimateInput): string {
  return tx(() => {
    const prior = e.id ? first<Estimate>('SELECT * FROM estimates WHERE id = ?', [e.id]) : null;
    if (prior?.deleted_at) missing();
    const client_name = req(e.client_name === undefined ? prior?.client_name : e.client_name, 'client_name', 'errEstimateClient');
    const title = req(e.title === undefined ? prior?.title : e.title, 'title', 'errEstimateTitle');
    const issue_day = e.issue_day === undefined ? prior?.issue_day ?? today() : checkDay(e.issue_day, 'issue_day');
    // a blank number on create is the counter's next one; on update it is an error (a number cannot be removed)
    const typed = e.number === undefined ? undefined : opt(e.number);
    const number = prior ? req(typed === undefined ? prior.number : typed, 'number', 'errEstimateNumber') : typed ?? freeNumber(yearOf(issue_day));

    const valid_days = e.valid_days === undefined ? prior?.valid_days ?? getCompanyProfile().default_valid_days : e.valid_days;
    if (valid_days == null || !Number.isInteger(valid_days) || valid_days < 1 || valid_days > 365) throw new ValidationError('valid_days', 'errValidDays');

    const tax_bp = e.tax_bp === undefined ? prior?.tax_bp ?? 0 : e.tax_bp;
    if (tax_bp == null || !Number.isInteger(tax_bp) || tax_bp < 0 || tax_bp > 10000) throw new ValidationError('tax', 'errTax');
    const discount_cents = e.discount_cents === undefined ? prior?.discount_cents ?? 0 : e.discount_cents;
    if (discount_cents == null || !Number.isSafeInteger(discount_cents) || discount_cents < 0) throw new ValidationError('discount', 'errAmount');

    if (prior && prior.status === 'accepted' && (discount_cents !== prior.discount_cents || tax_bp !== prior.tax_bp)) locked();
    // an unchanged discount is not judged again: lines removed on another phone can leave it above the subtotal (the view caps it at zero)
    if (discount_cents !== prior?.discount_cents && discount_cents > (prior ? totalOf(prior.id).subtotal_cents : 0)) {
      throw new ValidationError('discount', 'errDiscountTooHigh');
    }

    const id = save('estimates', {
      id: e.id,
      number,
      client_name,
      client_phone: text(e.client_phone, prior?.client_phone),
      client_address: text(e.client_address, prior?.client_address),
      title,
      location: text(e.location, prior?.location),
      issue_day,
      valid_days,
      discount_cents,
      tax_bp,
      terms: e.terms === undefined && !prior ? opt(getCompanyProfile().default_terms) : text(e.terms, prior?.terms),
      notes: text(e.notes, prior?.notes),
      // status and project link are not part of the header form: a new estimate is a draft with no project, and an update
      // must not even name project_id (SQLite re-checks a foreign key that is in the SET list, and the project of an
      // imported estimate may not be on this phone)
      ...(prior ? {} : { status: 'draft' }),
    });
    noteNumberUsed(number);
    return id;
  });
}

/**
 * Move an estimate to a status. Always allowed from any status (reopening an accepted one sets it back to
 * draft). Only the estimate row changes: its lines, stages and project link are left alone. The same status again does nothing.
 */
export function setEstimateStatus(id: string, status: EstimateStatus): void {
  if (!ESTIMATE_STATUSES.includes(status)) throw new Error(`Unknown estimate status ${String(status)}`);
  tx(() => {
    const e = liveEstimate(id);
    if (e.status !== status) save('estimates', { id, status });
  });
}

/** A new draft with a new number and today's date, the same client, terms, discount, tax, lines and stages. Never copies the project link. Returns its id. */
export function duplicateEstimate(id: string): string {
  return tx(() => {
    const src = loadEstimate(id) ?? missing();
    const e = src.estimate;
    const issue_day = today();
    const number = freeNumber(yearOf(issue_day));
    const copy = save('estimates', {
      number,
      client_name: e.client_name,
      client_phone: e.client_phone,
      client_address: e.client_address,
      title: e.title,
      location: e.location,
      issue_day,
      valid_days: e.valid_days,
      discount_cents: e.discount_cents,
      tax_bp: e.tax_bp,
      status: 'draft',
      terms: e.terms,
      notes: e.notes,
      project_id: null,
    });
    noteNumberUsed(number);
    src.items.forEach((it, i) =>
      save('estimate_items', { estimate_id: copy, position: i + 1, description: it.description, unit: it.unit, qty_milli: it.qty_milli, rate_cents: it.rate_cents }),
    );
    src.payments.forEach((p, i) => save('estimate_payments', { estimate_id: copy, position: i + 1, label: p.label, percent_bp: p.percent_bp }));
    return copy;
  });
}

/** Soft-delete an estimate together with its lines and stages, in one step. A linked project is left alone. Deleting a deleted or unknown estimate does nothing. */
export function deleteEstimate(id: string): void {
  tx(() => {
    for (const table of ['estimate_items', 'estimate_payments'] as const) {
      all<{ id: string }>(`SELECT id FROM ${table} WHERE estimate_id = ? AND deleted_at IS NULL`, [id]).forEach((r) => remove(table, r.id));
    }
    remove('estimates', id);
  });
}

/**
 * Turn an accepted estimate into a project (name = title, client, location, contract value = the estimate's total
 * now, as a snapshot that does not follow later edits) and link it. One step. Refused unless the estimate is
 * accepted and not linked; a link to a project that has since been deleted on this phone counts as not linked.
 * Returns the project id.
 */
export function createProjectFromEstimate(id: string): string {
  return tx(() => {
    const e = liveEstimate(id);
    if (e.status !== 'accepted') throw new ValidationError('estimate', 'errEstimateNotAccepted');
    if (e.project_id) {
      const linked = first<{ deleted_at: string | null }>('SELECT deleted_at FROM projects WHERE id = ?', [e.project_id]);
      if (!linked?.deleted_at) throw new ValidationError('estimate', 'errEstimateLinked');
    }
    const projectId = saveProject({
      name: e.title,
      client: e.client_name,
      location: e.location,
      contract_cents: totalOf(id).total_cents,
      status: 'active',
    });
    save('estimates', { id, project_id: projectId });
    return projectId;
  });
}

// ---------------------------------------------------------------- price lines

export interface EstimateItemInput {
  /** Omit to add a line. A new id (from a form) that is not in the table adds the line with that id. */
  id?: string;
  estimate_id: string;
  description: string;
  unit?: string | null;
  /** Thousandths: 12.5 is 12500 (parseQty). 1 to 1,000,000,000; null when what was typed is not a number. */
  qty_milli: number | null;
  /** Whole cents, 0 to 5,000,000,000. */
  rate_cents: number | null;
}

/**
 * Add or change a price line. New lines go to the end. Refused when the estimate is accepted, has 200 lines,
 * or the line amount is above Rs 10 billion. If the discount would then be more than the subtotal it is lowered to it.
 */
export function saveEstimateItem(i: EstimateItemInput): string {
  return tx(() => {
    const prior = i.id ? first<EstimateItem>('SELECT * FROM estimate_items WHERE id = ?', [i.id]) : null;
    if (prior && (prior.deleted_at || prior.estimate_id !== i.estimate_id)) missing();
    editableEstimate(i.estimate_id);

    const description = req(i.description, 'description', 'errItemDescription');
    const qty = i.qty_milli;
    if (qty == null || !Number.isSafeInteger(qty) || qty < 1 || qty > MAX_QTY_MILLI) throw new ValidationError('qty', 'errQty');
    const rate = i.rate_cents;
    if (rate == null || !Number.isSafeInteger(rate) || rate < 0 || rate > MAX_RATE_CENTS) throw new ValidationError('rate', 'errAmount');
    if (lineAmount(qty, rate) > MAX_LINE_CENTS) throw new ValidationError('rate', 'errAmountTooLarge');
    if (!prior) {
      const n = first<{ n: number }>('SELECT COUNT(*) AS n FROM estimate_items WHERE estimate_id = ? AND deleted_at IS NULL', [i.estimate_id])?.n ?? 0;
      if (n >= MAX_ESTIMATE_ITEMS) throw new ValidationError('items', 'errItemLimit');
    }

    const id = save('estimate_items', {
      id: i.id,
      estimate_id: i.estimate_id,
      position: prior ? prior.position : nextPosition('estimate_items', i.estimate_id),
      description,
      unit: opt(i.unit),
      qty_milli: qty,
      rate_cents: rate,
    });
    renumber('estimate_items', i.estimate_id);
    clampDiscount(i.estimate_id);
    return id;
  });
}

/** Remove a price line (soft delete) and close the gap in the numbering. Refused when the estimate is accepted. A line that is already gone does nothing. */
export function removeEstimateItem(id: string): void {
  tx(() => {
    const row = first<EstimateItem>('SELECT * FROM estimate_items WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!row) return;
    const owner = first<Estimate>('SELECT * FROM estimates WHERE id = ?', [row.estimate_id]);
    if (owner && !owner.deleted_at && owner.status === 'accepted') locked();
    remove('estimate_items', id);
    renumber('estimate_items', row.estimate_id);
    if (owner && !owner.deleted_at) clampDiscount(row.estimate_id);
  });
}

// ---------------------------------------------------------------- payment schedule

export interface EstimatePaymentInput {
  /** Omit to add a stage. A new id (from a form) that is not in the table adds the stage with that id. */
  id?: string;
  estimate_id: string;
  label: string;
  /** Basis points: 3000 is 30 % (parsePercent). 1 to 10000; null when what was typed is not a number. */
  percent_bp: number | null;
}

/**
 * Add or change a payment stage. New stages go to the end. Refused when the estimate is accepted or the stages
 * would add up to more than 100 %. Less than 100 % is allowed (the screen warns).
 */
export function saveEstimatePayment(p: EstimatePaymentInput): string {
  return tx(() => {
    const prior = p.id ? first<EstimatePayment>('SELECT * FROM estimate_payments WHERE id = ?', [p.id]) : null;
    if (prior && (prior.deleted_at || prior.estimate_id !== p.estimate_id)) missing();
    editableEstimate(p.estimate_id);

    const label = req(p.label, 'label', 'errStageLabel');
    const bp = p.percent_bp;
    if (bp == null || !Number.isInteger(bp) || bp < 1 || bp > 10000) throw new ValidationError('percent', 'errPercent');
    const others =
      first<{ s: number | null }>('SELECT SUM(percent_bp) AS s FROM estimate_payments WHERE estimate_id = ? AND deleted_at IS NULL AND id IS NOT ?', [
        p.estimate_id,
        p.id ?? null,
      ])?.s ?? 0;
    if (others + bp > 10000) throw new ValidationError('percent', 'errScheduleOver');

    const id = save('estimate_payments', {
      id: p.id,
      estimate_id: p.estimate_id,
      position: prior ? prior.position : nextPosition('estimate_payments', p.estimate_id),
      label,
      percent_bp: bp,
    });
    renumber('estimate_payments', p.estimate_id);
    return id;
  });
}

/** Remove a payment stage (soft delete) and close the gap in the numbering. Refused when the estimate is accepted. A stage that is already gone does nothing. */
export function removeEstimatePayment(id: string): void {
  tx(() => {
    const row = first<EstimatePayment>('SELECT * FROM estimate_payments WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!row) return;
    const owner = first<Estimate>('SELECT * FROM estimates WHERE id = ?', [row.estimate_id]);
    if (owner && !owner.deleted_at && owner.status === 'accepted') locked();
    remove('estimate_payments', id);
    renumber('estimate_payments', row.estimate_id);
  });
}

/**
 * Fill the payment schedule with the standard 30 % Advance, 40 % Progress payment, 30 % On completion.
 * Replaces nothing silently: when the estimate already has stages it is refused with
 * ValidationError('payments', 'errScheduleExists') unless `replace` is true, which removes the existing stages first.
 * Refused when the estimate is accepted. Returns the ids of the three new stages.
 */
export function applyStandardSchedule(estimateId: string, opts: { replace?: boolean } = {}): string[] {
  return tx(() => {
    editableEstimate(estimateId);
    const live = all<{ id: string }>('SELECT id FROM estimate_payments WHERE estimate_id = ? AND deleted_at IS NULL', [estimateId]);
    if (live.length && !opts.replace) throw new ValidationError('payments', 'errScheduleExists');
    live.forEach((r) => remove('estimate_payments', r.id));
    return STANDARD_SCHEDULE.map((s, i) => save('estimate_payments', { estimate_id: estimateId, position: i + 1, label: s.label, percent_bp: s.percent_bp }));
  });
}
