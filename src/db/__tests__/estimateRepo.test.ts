/**
 * The estimate repo (src/db/estimates.ts): every rule of docs/ESTIMATES.md section 3, the
 * single write path (version + audit entry for every change), positions, the lock on accepted
 * estimates, status changes, duplicate, delete, and turning an estimate into a project.
 */
import { COMPANY_DEFAULTS, saveCompanyProfile } from '@/lib/company';
import { all, first, getDb, getSetting, newId, save } from '@/db';
import {
  applyStandardSchedule,
  createProjectFromEstimate,
  deleteEstimate,
  duplicateEstimate,
  loadEstimate,
  removeEstimateItem,
  removeEstimatePayment,
  saveEstimate,
  saveEstimateItem,
  saveEstimatePayment,
  setEstimateStatus,
  suggestEstimateNumber,
  type EstimateInput,
  type EstimateItemInput,
  type EstimatePaymentInput,
} from '@/db/estimates';
import { deleteRecord, saveProject, ValidationError } from '@/db/repo';
import { DATA_TABLES } from '@/db/schema';
import type { Estimate, EstimateItem, EstimatePayment, EstimateStatus } from '@/db/types';
import { en } from '@/i18n/en';
import { si } from '@/i18n/si';
import { ta } from '@/i18n/ta';
import { allocatePayments, MAX_LINE_CENTS, MAX_QTY_MILLI, MAX_RATE_CENTS } from '@/lib/estimate';
import { resetDb, silenceConsoleError } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

let clock: ReturnType<typeof useClock>;
beforeEach(() => {
  resetDb();
  clock = useClock(new Date(2026, 9, 22, 12, 0, 0)); // 22 Oct 2026, local noon: today() is 2026-10-22
});
afterEach(() => clock.restore());

interface AuditRow {
  seq: number;
  table_name: string;
  row_id: string;
  action: string;
  data: string | null;
}
const audit = (where = '1=1', params: (string | number)[] = []) => all<AuditRow>(`SELECT * FROM audit_log WHERE ${where} ORDER BY seq`, params);
const auditCount = () => first<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n ?? 0;
const settings = () => all('SELECT * FROM settings ORDER BY key');
const row = <T>(table: string, id: string) => first<T>(`SELECT * FROM ${table} WHERE id = ?`, [id]) as T;
const est = (id: string) => row<Estimate>('estimates', id);

/** Everything a refused write must leave exactly as it was. */
function snapshot() {
  return {
    audit: auditCount(),
    settings: settings(),
    tables: Object.fromEntries(DATA_TABLES.map((t) => [t, all(`SELECT * FROM ${t} ORDER BY id`)])),
  };
}

/** Runs a write that must be refused with a ValidationError; proves nothing at all was written. */
function refused(write: () => unknown): { field: string; key: string } {
  const before = snapshot();
  let caught: unknown;
  try {
    write();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ValidationError);
  expect(snapshot()).toEqual(before);
  const { field, key } = caught as ValidationError;
  return { field, key };
}

const mk = (over: Partial<EstimateInput> = {}) => saveEstimate({ client_name: 'Mr. Perera', title: 'Boundary wall', ...over });
/** 10 units at Rs 5,000: Rs 50,000. */
const addItem = (estimate_id: string, over: Partial<EstimateItemInput> = {}) =>
  saveEstimateItem({ estimate_id, description: 'Blockwork', unit: 'm²', qty_milli: 10_000, rate_cents: 500_000, ...over });
const addStage = (estimate_id: string, percent_bp: number, over: Partial<EstimatePaymentInput> = {}) =>
  saveEstimatePayment({ estimate_id, label: 'Stage', percent_bp, ...over });
const live = (table: 'estimate_items' | 'estimate_payments', estimate_id: string) =>
  all<{ id: string; position: number }>(`SELECT id, position FROM ${table} WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY position, created_at, id`, [estimate_id]);
const positions = (table: 'estimate_items' | 'estimate_payments', estimate_id: string) => live(table, estimate_id).map((r) => r.position);
const totalOf = (id: string) => loadEstimate(id)?.total;

/** An accepted estimate with two lines (Rs 50,000 + Rs 20,000) and two stages. */
function acceptedEstimate() {
  const id = mk({ tax_bp: 800, notes: 'n' });
  const i1 = addItem(id);
  const i2 = addItem(id, { description: 'Plaster', qty_milli: 20_000, rate_cents: 100_000 });
  const p1 = addStage(id, 6000, { label: 'Advance' });
  const p2 = addStage(id, 4000, { label: 'On completion' });
  setEstimateStatus(id, 'accepted');
  return { id, i1, i2, p1, p2 };
}

describe('loadEstimate', () => {
  it('is null for an id that does not exist and for a deleted estimate', () => {
    expect(loadEstimate(newId())).toBeNull();
    const id = mk();
    expect(loadEstimate(id)).not.toBeNull();
    deleteEstimate(id);
    expect(loadEstimate(id)).toBeNull();
  });

  it('returns the estimate, its live lines and stages in position order, and the totals of the view', () => {
    const id = mk({ discount_cents: 0, tax_bp: 1800 });
    addItem(id, { description: 'First' });
    addItem(id, { description: 'Second', qty_milli: 1_500, rate_cents: 333 });
    addStage(id, 3000, { label: 'Advance' });
    const loaded = loadEstimate(id);
    expect(loaded?.estimate).toEqual(est(id));
    expect(loaded?.items.map((i) => [i.description, i.position])).toEqual([['First', 1], ['Second', 2]]);
    expect(loaded?.payments.map((p) => [p.label, p.position, p.percent_bp])).toEqual([['Advance', 1, 3000]]);
    expect(loaded?.total).toEqual(first('SELECT * FROM v_estimate_total WHERE estimate_id = ?', [id]));
    // Rs 50,000 + (1.5 x Rs 3.33 = 499.5 cents, rounded up to 500) = 5,000,500; 18 % of that is 900,090
    expect(loaded?.total).toMatchObject({ item_count: 2, subtotal_cents: 5_000_500, tax_cents: 900_090, total_cents: 5_900_590, scheduled_bp: 3000 });
  });

  it('leaves out deleted lines and stages, and orders by position then creation even when positions are out of order', () => {
    const id = mk();
    const a = save('estimate_items', { estimate_id: id, position: 3, description: 'C', qty_milli: 1000, rate_cents: 100 });
    const b = save('estimate_items', { estimate_id: id, position: 1, description: 'A', qty_milli: 1000, rate_cents: 100 });
    clock.tick(1000);
    const c = save('estimate_items', { estimate_id: id, position: 1, description: 'B', qty_milli: 1000, rate_cents: 100 });
    const d = save('estimate_items', { estimate_id: id, position: 2, description: 'gone', qty_milli: 1000, rate_cents: 100 });
    getDb().runSync("UPDATE estimate_items SET deleted_at = '2026-10-23T00:00:00.000Z' WHERE id = ?", [d]);
    expect(loadEstimate(id)?.items.map((i) => i.id)).toEqual([b, c, a]);
    expect(loadEstimate(id)?.total.item_count).toBe(3);
  });
});

describe('saveEstimate: create', () => {
  it('fills in the number, today, 30 days, the standard terms and draft', () => {
    const id = mk();
    expect(est(id)).toMatchObject({
      number: 'EST-2026-001',
      client_name: 'Mr. Perera',
      title: 'Boundary wall',
      issue_day: '2026-10-22',
      valid_days: 30,
      discount_cents: 0,
      tax_bp: 0,
      status: 'draft',
      terms: COMPANY_DEFAULTS.default_terms,
      notes: null,
      project_id: null,
      client_phone: null,
      client_address: null,
      location: null,
      version: 1,
      deleted_at: null,
    });
  });

  it('takes the valid days and the terms from the company profile', () => {
    saveCompanyProfile({ default_valid_days: 45, default_terms: '  50 % advance.\nPrices fixed for the period.  ' });
    const id = mk();
    expect(est(id)).toMatchObject({ valid_days: 45, terms: '50 % advance.\nPrices fixed for the period.' });
  });

  it('keeps what the form sent instead of the defaults, and an emptied terms box stays empty', () => {
    saveCompanyProfile({ default_valid_days: 45, default_terms: 'Default terms' });
    const a = mk({ valid_days: 14, terms: 'My terms' });
    expect(est(a)).toMatchObject({ valid_days: 14, terms: 'My terms' });
    const b = mk({ terms: '   ' });
    expect(est(b).terms).toBeNull();
  });

  it('trims the text and turns empty optional text into nothing', () => {
    const id = saveEstimate({
      client_name: '  Mr. Perera  ',
      title: ' Wall ',
      client_phone: ' 0771234567 ',
      client_address: '   ',
      location: ' Welimada ',
      notes: '',
      issue_day: '2026-10-01',
    });
    expect(est(id)).toMatchObject({ client_name: 'Mr. Perera', title: 'Wall', client_phone: '0771234567', client_address: null, location: 'Welimada', notes: null, issue_day: '2026-10-01' });
  });

  it('uses the id a form made up, and writes one insert audit entry holding the row', () => {
    const formId = newId();
    expect(mk({ id: formId })).toBe(formId);
    const entries = audit('row_id = ?', [formId]);
    expect(entries.map((a) => [a.table_name, a.action])).toEqual([['estimates', 'insert']]);
    expect(JSON.parse(entries[0].data as string)).toMatchObject({ id: formId, number: 'EST-2026-001', client_name: 'Mr. Perera', status: 'draft' });
  });

  it('creates with a discount, a tax and a typed number when asked', () => {
    const id = mk({ number: ' Q-77 ', tax_bp: 1800 });
    expect(est(id)).toMatchObject({ number: 'Q-77', tax_bp: 1800 });
  });
});

describe('saveEstimate: update', () => {
  it('changes only the fields it is given', () => {
    const id = mk({ client_phone: '0771', location: 'Welimada', notes: 'N', valid_days: 20, tax_bp: 800 });
    clock.tick(60_000);
    saveEstimate({ id, title: 'New title' });
    expect(est(id)).toMatchObject({ title: 'New title', client_name: 'Mr. Perera', client_phone: '0771', location: 'Welimada', notes: 'N', valid_days: 20, tax_bp: 800, number: 'EST-2026-001', version: 2 });
  });

  it('null clears an optional text field, a value replaces it', () => {
    const id = mk({ client_phone: '0771', notes: 'N', terms: 'T' });
    saveEstimate({ id, client_phone: null, notes: ' new ', terms: null });
    expect(est(id)).toMatchObject({ client_phone: null, notes: 'new', terms: null });
  });

  it('bumps the version, writes an update audit entry with the new values, and never changes status or project from here', () => {
    const id = mk();
    setEstimateStatus(id, 'sent');
    saveEstimate({ id, notes: 'x' });
    expect(est(id)).toMatchObject({ status: 'sent', version: 3, project_id: null });
    const last = audit('row_id = ?', [id]).at(-1);
    expect(last?.action).toBe('update');
    expect(JSON.parse(last?.data as string)).toMatchObject({ id, notes: 'x' });
    expect(JSON.parse(last?.data as string)).not.toHaveProperty('status'); // the header form does not touch status or the project link
    expect(JSON.parse(last?.data as string)).not.toHaveProperty('project_id');
  });

  it('a number can be edited, and goes into the counter when it is in the app format', () => {
    const id = mk();
    saveEstimate({ id, number: 'EST-2026-020' });
    expect(est(id).number).toBe('EST-2026-020');
    expect(getSetting('estimate_seq_2026')).toBe('20');
    expect(suggestEstimateNumber()).toBe('EST-2026-021');
  });

  it('refuses a deleted estimate as if it were gone', () => {
    const id = mk();
    deleteEstimate(id);
    expect(refused(() => saveEstimate({ id, title: 'again' }))).toEqual({ field: 'estimate', key: 'errEstimateMissing' });
  });
});

describe('saveEstimate: rules', () => {
  it.each([
    ['empty', ''],
    ['spaces', '   '],
    ['null', null],
  ])('refuses a %s client name', (_l, client_name) => {
    expect(refused(() => mk({ client_name }))).toEqual({ field: 'client_name', key: 'errEstimateClient' });
    expect(refused(() => saveEstimate({ title: 'T', client_name }))).toEqual({ field: 'client_name', key: 'errEstimateClient' });
  });

  it.each([['empty', ''], ['tabs', ' \t '], ['null', null]])('refuses a %s title', (_l, title) => {
    expect(refused(() => mk({ title }))).toEqual({ field: 'title', key: 'errEstimateTitle' });
  });

  it('refuses a create with no client or no title given at all', () => {
    expect(refused(() => saveEstimate({ title: 'T' })).field).toBe('client_name');
    expect(refused(() => saveEstimate({ client_name: 'C' })).field).toBe('title');
  });

  it('refuses to clear the client, title or number of a saved estimate', () => {
    const id = mk();
    expect(refused(() => saveEstimate({ id, client_name: ' ' })).field).toBe('client_name');
    expect(refused(() => saveEstimate({ id, title: '' })).field).toBe('title');
    expect(refused(() => saveEstimate({ id, number: '  ' }))).toEqual({ field: 'number', key: 'errEstimateNumber' });
    expect(refused(() => saveEstimate({ id, number: null }))).toEqual({ field: 'number', key: 'errEstimateNumber' });
  });

  it.each(['2026-13-01', '2026-02-30', '22-10-2026', '2026/10/22', 'today', ''])('refuses the issue day %j', (issue_day) => {
    expect(refused(() => mk({ issue_day }))).toEqual({ field: 'issue_day', key: 'errDate' });
  });

  it.each([0, -1, 366, 1000, 1.5, Number.NaN, null])('refuses %p valid days', (valid_days) => {
    expect(refused(() => mk({ valid_days }))).toEqual({ field: 'valid_days', key: 'errValidDays' });
  });

  it.each([1, 30, 365])('accepts %d valid days', (valid_days) => {
    expect(est(mk({ valid_days })).valid_days).toBe(valid_days);
  });

  it.each([-1, 10_001, 1.5, Number.NaN, null])('refuses %p basis points of tax', (tax_bp) => {
    expect(refused(() => mk({ tax_bp }))).toEqual({ field: 'tax', key: 'errTax' });
  });

  it.each([0, 1, 1800, 10_000])('accepts %d basis points of tax', (tax_bp) => {
    expect(est(mk({ tax_bp })).tax_bp).toBe(tax_bp);
  });

  it.each([-1, 1.5, Number.NaN, null])('refuses a discount of %p', (discount_cents) => {
    expect(refused(() => mk({ discount_cents })).field).toBe('discount');
    expect(refused(() => mk({ discount_cents })).key).toBe('errAmount');
  });

  it('allows only a discount of 0 while there are no lines', () => {
    expect(refused(() => mk({ discount_cents: 1 }))).toEqual({ field: 'discount', key: 'errDiscountTooHigh' });
    const id = mk();
    expect(refused(() => saveEstimate({ id, discount_cents: 1 }))).toEqual({ field: 'discount', key: 'errDiscountTooHigh' });
    expect(() => saveEstimate({ id, discount_cents: 0 })).not.toThrow();
  });

  it('allows a discount up to the current subtotal and no more', () => {
    const id = mk();
    addItem(id); // Rs 50,000
    expect(refused(() => saveEstimate({ id, discount_cents: 5_000_001 }))).toEqual({ field: 'discount', key: 'errDiscountTooHigh' });
    saveEstimate({ id, discount_cents: 5_000_000 });
    expect(totalOf(id)).toMatchObject({ discount_cents: 5_000_000, total_cents: 0 });
    saveEstimate({ id, discount_cents: 123_456 });
    expect(est(id).discount_cents).toBe(123_456);
  });

  it('an untouched discount that has fallen above the subtotal (lines removed on another phone) does not block saving the rest', () => {
    const id = mk();
    const line = addItem(id);
    saveEstimate({ id, discount_cents: 4_000_000 });
    getDb().runSync("UPDATE estimate_items SET deleted_at = '2026-10-23T00:00:00.000Z' WHERE id = ?", [line]); // gone behind the repo's back
    expect(() => saveEstimate({ id, notes: 'still saves', discount_cents: 4_000_000 })).not.toThrow();
    expect(refused(() => saveEstimate({ id, discount_cents: 4_000_001 })).key).toBe('errDiscountTooHigh');
    expect(totalOf(id)).toMatchObject({ subtotal_cents: 0, discount_cents: 4_000_000, total_cents: 0 });
  });
});

describe('estimate numbers', () => {
  it('count up per phone: 001, 002, 003, and the counter is kept in settings', () => {
    expect([mk(), mk(), mk()].map((id) => est(id).number)).toEqual(['EST-2026-001', 'EST-2026-002', 'EST-2026-003']);
    expect(getSetting('estimate_seq_2026')).toBe('3');
  });

  it('start again at 001 in a new year, and the old year keeps its own count', () => {
    mk();
    mk();
    clock.set(new Date(2027, 0, 5, 9, 0, 0));
    expect(est(mk()).number).toBe('EST-2027-001');
    expect(getSetting('estimate_seq_2026')).toBe('2');
    expect(getSetting('estimate_seq_2027')).toBe('1');
    clock.set(new Date(2026, 11, 31, 9, 0, 0));
    expect(est(mk()).number).toBe('EST-2026-003');
  });

  it('follow the year of the issue day', () => {
    expect(est(mk({ issue_day: '2025-12-30' })).number).toBe('EST-2025-001');
    expect(est(mk()).number).toBe('EST-2026-001');
  });

  it('never go back: a deleted estimate does not free its number', () => {
    const a = mk();
    deleteEstimate(a);
    expect(est(mk()).number).toBe('EST-2026-002');
  });

  it('a blank number on create means the next one', () => {
    expect(est(mk({ number: '' })).number).toBe('EST-2026-001');
    expect(est(mk({ number: null })).number).toBe('EST-2026-002');
    expect(est(mk({ number: '   ' })).number).toBe('EST-2026-003');
  });

  it('a number typed in the app format moves the counter past it, so it is not handed out again', () => {
    mk({ number: 'EST-2026-010' });
    expect(getSetting('estimate_seq_2026')).toBe('10');
    expect(est(mk()).number).toBe('EST-2026-011');
    // an older number typed later does not move the counter back
    mk({ number: 'EST-2026-004' });
    expect(getSetting('estimate_seq_2026')).toBe('11');
  });

  it('a hand-made number does not touch the counter', () => {
    mk({ number: 'Q-1' });
    expect(getSetting('estimate_seq_2026')).toBeNull();
    expect(est(mk()).number).toBe('EST-2026-001');
  });

  it('skip a number a live estimate on this phone already has, for example one that arrived in an import', () => {
    save('estimates', { number: 'EST-2026-001', client_name: 'Imported', title: 'T', issue_day: '2026-10-01' });
    save('estimates', { number: 'EST-2026-002', client_name: 'Imported', title: 'T', issue_day: '2026-10-01' });
    expect(est(mk()).number).toBe('EST-2026-003');
  });

  it('suggestEstimateNumber shows the next number without using it', () => {
    expect(suggestEstimateNumber()).toBe('EST-2026-001');
    expect(suggestEstimateNumber()).toBe('EST-2026-001');
    expect(getSetting('estimate_seq_2026')).toBeNull();
    expect(suggestEstimateNumber('2027-03-01')).toBe('EST-2027-001');
    const id = mk({ number: suggestEstimateNumber() }); // the form saves the number it showed
    expect(est(id).number).toBe('EST-2026-001');
    expect(suggestEstimateNumber()).toBe('EST-2026-002');
  });

  it('are consumed by a duplicate as well', () => {
    const id = mk();
    const copy = duplicateEstimate(id);
    expect(est(copy).number).toBe('EST-2026-002');
    expect(est(mk()).number).toBe('EST-2026-003');
  });

  it('a refused create does not use up a number', () => {
    expect(refused(() => mk({ client_name: '' })).field).toBe('client_name');
    expect(est(mk()).number).toBe('EST-2026-001');
  });
});

describe('price lines', () => {
  it('are added at the end, positions 1, 2, 3, with the text trimmed and the unit optional', () => {
    const id = mk();
    const a = addItem(id, { description: '  Excavation  ', unit: ' m³ ' });
    const b = addItem(id, { description: 'Concrete', unit: '' });
    const c = addItem(id, { description: 'Paint', unit: null });
    expect([a, b, c].map((x) => row<EstimateItem>('estimate_items', x))).toMatchObject([
      { description: 'Excavation', unit: 'm³', position: 1, estimate_id: id, qty_milli: 10_000, rate_cents: 500_000 },
      { description: 'Concrete', unit: null, position: 2 },
      { description: 'Paint', unit: null, position: 3 },
    ]);
    expect(totalOf(id)).toMatchObject({ item_count: 3, subtotal_cents: 15_000_000 });
  });

  it('can be changed: same id, same position, new values, version up, an update audit entry', () => {
    const id = mk();
    addItem(id);
    const b = addItem(id, { description: 'Old' });
    addItem(id);
    saveEstimateItem({ id: b, estimate_id: id, description: 'New', unit: 'kg', qty_milli: 2_500, rate_cents: 40_000 });
    expect(row<EstimateItem>('estimate_items', b)).toMatchObject({ description: 'New', unit: 'kg', qty_milli: 2_500, rate_cents: 40_000, position: 2, version: 2 });
    expect(positions('estimate_items', id)).toEqual([1, 2, 3]);
    expect(audit('row_id = ?', [b]).map((a) => a.action)).toEqual(['insert', 'update']);
  });

  it('use the id a form made up', () => {
    const id = mk();
    const formId = newId();
    expect(addItem(id, { id: formId })).toBe(formId);
    expect(row<EstimateItem>('estimate_items', formId)).toMatchObject({ estimate_id: id, position: 1 });
  });

  it.each([
    ['empty', ''],
    ['spaces', '  \n '],
  ])('refuse a %s description', (_l, description) => {
    const id = mk();
    expect(refused(() => addItem(id, { description }))).toEqual({ field: 'description', key: 'errItemDescription' });
  });

  it.each([null, 0, -1000, 1.5, Number.NaN, MAX_QTY_MILLI + 1])('refuse a quantity of %p', (qty_milli) => {
    const id = mk();
    expect(refused(() => addItem(id, { qty_milli }))).toEqual({ field: 'qty', key: 'errQty' });
  });

  it.each([null, -1, 1.5, Number.NaN, MAX_RATE_CENTS + 1])('refuse a rate of %p', (rate_cents) => {
    const id = mk();
    expect(refused(() => addItem(id, { rate_cents }))).toEqual({ field: 'rate', key: 'errAmount' });
  });

  it('allow a quantity of 0.001, a rate of 0 and both limits', () => {
    const id = mk();
    expect(() => addItem(id, { qty_milli: 1, rate_cents: 0 })).not.toThrow();
    expect(() => addItem(id, { qty_milli: MAX_QTY_MILLI, rate_cents: 1_000_000 })).not.toThrow(); // Rs 10 billion, the largest line
    expect(totalOf(id)?.subtotal_cents).toBe(MAX_LINE_CENTS);
  });

  it('refuse a line above Rs 10 billion, which would put the totals out of exact range', () => {
    const id = mk();
    expect(refused(() => addItem(id, { qty_milli: MAX_QTY_MILLI, rate_cents: 1_000_001 }))).toEqual({ field: 'rate', key: 'errAmountTooLarge' });
    expect(refused(() => addItem(id, { qty_milli: MAX_QTY_MILLI, rate_cents: MAX_RATE_CENTS })).key).toBe('errAmountTooLarge');
  });

  it('stop at 200 lines, and a removed line makes room again', () => {
    const id = mk();
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) ids.push(addItem(id, { description: `Line ${i + 1}`, qty_milli: 1000, rate_cents: 100 }));
    expect(refused(() => addItem(id))).toEqual({ field: 'items', key: 'errItemLimit' });
    expect(totalOf(id)?.item_count).toBe(200);
    removeEstimateItem(ids[10]);
    expect(() => addItem(id)).not.toThrow();
    expect(positions('estimate_items', id)).toEqual(Array.from({ length: 200 }, (_v, i) => i + 1));
    expect(refused(() => addItem(id)).key).toBe('errItemLimit');
  });

  it('editing the 200th line is still fine', () => {
    const id = mk();
    let last = '';
    for (let i = 0; i < 200; i++) last = addItem(id, { qty_milli: 1000, rate_cents: 100 });
    expect(() => saveEstimateItem({ id: last, estimate_id: id, description: 'edited', qty_milli: 2000, rate_cents: 100 })).not.toThrow();
  });

  it('need an estimate that exists', () => {
    expect(refused(() => addItem(newId()))).toEqual({ field: 'estimate', key: 'errEstimateMissing' });
    const id = mk();
    deleteEstimate(id);
    expect(refused(() => addItem(id))).toEqual({ field: 'estimate', key: 'errEstimateMissing' });
  });

  it('cannot be moved to another estimate, and a deleted line cannot be saved again', () => {
    const a = mk();
    const b = mk();
    const line = addItem(a);
    expect(refused(() => saveEstimateItem({ id: line, estimate_id: b, description: 'x', qty_milli: 1000, rate_cents: 1 })).key).toBe('errEstimateMissing');
    removeEstimateItem(line);
    expect(refused(() => saveEstimateItem({ id: line, estimate_id: a, description: 'x', qty_milli: 1000, rate_cents: 1 })).key).toBe('errEstimateMissing');
  });

  it('removing one closes the gap in the numbering, leaves the others in order, and soft-deletes with an audit entry', () => {
    const id = mk();
    const [a, b, c, d] = [1, 2, 3, 4].map((n) => addItem(id, { description: `L${n}` }));
    removeEstimateItem(b);
    expect(live('estimate_items', id).map((r) => [r.id, r.position])).toEqual([[a, 1], [c, 2], [d, 3]]);
    expect(row<EstimateItem>('estimate_items', b)).toMatchObject({ deleted_at: expect.any(String), version: 2 });
    expect(audit('row_id = ?', [b]).map((x) => x.action)).toEqual(['insert', 'delete']);
    // the lines that moved up were written through the same path
    expect(audit('row_id = ?', [c]).map((x) => x.action)).toEqual(['insert', 'update']);
    expect(audit('row_id = ?', [a]).map((x) => x.action)).toEqual(['insert']);
    expect(totalOf(id)?.item_count).toBe(3);
  });

  it('removing a line that is already gone, or never existed, does nothing at all', () => {
    const id = mk();
    const a = addItem(id);
    removeEstimateItem(a);
    const before = snapshot();
    removeEstimateItem(a);
    removeEstimateItem(newId());
    expect(snapshot()).toEqual(before);
  });

  it('heal numbering that a merge left with ties and gaps', () => {
    const id = mk();
    clock.tick(1000);
    save('estimate_items', { estimate_id: id, position: 1, description: 'A', qty_milli: 1000, rate_cents: 100 });
    clock.tick(1000);
    save('estimate_items', { estimate_id: id, position: 1, description: 'B', qty_milli: 1000, rate_cents: 100 });
    clock.tick(1000);
    save('estimate_items', { estimate_id: id, position: 7, description: 'C', qty_milli: 1000, rate_cents: 100 });
    addItem(id, { description: 'D' });
    expect(all<{ description: string; position: number }>('SELECT description, position FROM estimate_items WHERE estimate_id = ? ORDER BY position', [id])).toEqual([
      { description: 'A', position: 1 },
      { description: 'B', position: 2 },
      { description: 'C', position: 3 },
      { description: 'D', position: 4 },
    ]);
  });

  it('keep the discount at or below the subtotal when lines are removed or cheapened', () => {
    const id = mk();
    const a = addItem(id); // 5,000,000
    const b = addItem(id, { description: 'B', qty_milli: 1000, rate_cents: 2_000_000 }); // 2,000,000
    saveEstimate({ id, discount_cents: 6_000_000 });
    removeEstimateItem(a);
    expect(totalOf(id)).toMatchObject({ subtotal_cents: 2_000_000, discount_cents: 2_000_000, total_cents: 0 });
    expect(audit('row_id = ?', [id]).at(-1)?.action).toBe('update');

    saveEstimate({ id, discount_cents: 1_500_000 });
    saveEstimateItem({ id: b, estimate_id: id, description: 'B', qty_milli: 1000, rate_cents: 1_000_000 });
    expect(totalOf(id)).toMatchObject({ subtotal_cents: 1_000_000, discount_cents: 1_000_000, total_cents: 0 });

    // a discount that still fits is left alone
    saveEstimate({ id, discount_cents: 100_000 });
    const v = est(id).version;
    saveEstimateItem({ id: b, estimate_id: id, description: 'B', qty_milli: 1000, rate_cents: 900_000 });
    expect(est(id)).toMatchObject({ discount_cents: 100_000, version: v });
  });
});

describe('payment stages', () => {
  it('are added at the end with their label and share', () => {
    const id = mk();
    const a = addStage(id, 3000, { label: '  Advance ' });
    const b = addStage(id, 4000, { label: 'Progress' });
    expect([a, b].map((x) => row<EstimatePayment>('estimate_payments', x))).toMatchObject([
      { label: 'Advance', percent_bp: 3000, position: 1, estimate_id: id },
      { label: 'Progress', percent_bp: 4000, position: 2 },
    ]);
    expect(totalOf(id)?.scheduled_bp).toBe(7000);
  });

  it('can be changed, keeping id and position', () => {
    const id = mk();
    addStage(id, 3000);
    const b = addStage(id, 3000);
    saveEstimatePayment({ id: b, estimate_id: id, label: 'Changed', percent_bp: 5000 });
    expect(row<EstimatePayment>('estimate_payments', b)).toMatchObject({ label: 'Changed', percent_bp: 5000, position: 2, version: 2 });
    expect(audit('row_id = ?', [b]).map((x) => x.action)).toEqual(['insert', 'update']);
  });

  it.each([null, 0, -1, 10_001, 1.5, Number.NaN])('refuse a share of %p', (percent_bp) => {
    const id = mk();
    expect(refused(() => addStage(id, 1, { percent_bp }))).toEqual({ field: 'percent', key: 'errPercent' });
  });

  it('refuse an empty label', () => {
    const id = mk();
    expect(refused(() => addStage(id, 3000, { label: ' ' }))).toEqual({ field: 'label', key: 'errStageLabel' });
  });

  it('allow 0.01 % and exactly 100 % in total', () => {
    const id = mk();
    expect(() => addStage(id, 1)).not.toThrow();
    expect(() => addStage(id, 9999)).not.toThrow();
    expect(totalOf(id)?.scheduled_bp).toBe(10_000);
  });

  it('refuse stages that add up to more than 100 %', () => {
    const id = mk();
    addStage(id, 3000);
    addStage(id, 4000);
    expect(refused(() => addStage(id, 3001))).toEqual({ field: 'percent', key: 'errScheduleOver' });
    expect(() => addStage(id, 3000)).not.toThrow();
    expect(refused(() => addStage(id, 1)).key).toBe('errScheduleOver');
  });

  it('judge an edit against the other stages, not against itself', () => {
    const id = mk();
    const a = addStage(id, 6000);
    const b = addStage(id, 3000);
    expect(() => saveEstimatePayment({ id: a, estimate_id: id, label: 'A', percent_bp: 7000 })).not.toThrow(); // 70 + 30
    expect(refused(() => saveEstimatePayment({ id: a, estimate_id: id, label: 'A', percent_bp: 7001 })).key).toBe('errScheduleOver');
    expect(refused(() => saveEstimatePayment({ id: b, estimate_id: id, label: 'B', percent_bp: 3001 })).key).toBe('errScheduleOver');
  });

  it('a removed stage frees its share', () => {
    const id = mk();
    const a = addStage(id, 6000);
    addStage(id, 4000);
    expect(refused(() => addStage(id, 100)).key).toBe('errScheduleOver');
    removeEstimatePayment(a);
    expect(() => addStage(id, 6000)).not.toThrow();
  });

  it('close the gap in the numbering when one is removed, and removing twice does nothing', () => {
    const id = mk();
    const [a, b, c] = [1000, 2000, 3000].map((bp) => addStage(id, bp));
    removeEstimatePayment(b);
    expect(live('estimate_payments', id).map((r) => [r.id, r.position])).toEqual([[a, 1], [c, 2]]);
    expect(audit('row_id = ?', [b]).map((x) => x.action)).toEqual(['insert', 'delete']);
    const before = snapshot();
    removeEstimatePayment(b);
    expect(snapshot()).toEqual(before);
  });

  it('need an estimate that exists and cannot be moved', () => {
    expect(refused(() => addStage(newId(), 1000)).key).toBe('errEstimateMissing');
    const a = mk();
    const b = mk();
    const s = addStage(a, 1000);
    expect(refused(() => saveEstimatePayment({ id: s, estimate_id: b, label: 'x', percent_bp: 1000 })).key).toBe('errEstimateMissing');
  });

  it('the allocated amounts of a complete schedule add up to the total of the estimate', () => {
    const id = mk({ tax_bp: 1800 });
    addItem(id, { qty_milli: 3_333, rate_cents: 12_345 });
    addStage(id, 3333);
    addStage(id, 3333);
    addStage(id, 3334);
    const loaded = loadEstimate(id);
    const amounts = allocatePayments(loaded?.total.total_cents ?? 0, loaded?.payments.map((p) => p.percent_bp) ?? []);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(loaded?.total.total_cents);
  });
});

describe('the standard schedule', () => {
  it('fills 30 % Advance, 40 % Progress payment, 30 % On completion and returns the three ids', () => {
    const id = mk();
    const ids = applyStandardSchedule(id);
    expect(ids).toHaveLength(3);
    expect(loadEstimate(id)?.payments.map((p) => [p.id, p.label, p.percent_bp, p.position])).toEqual([
      [ids[0], 'Advance', 3000, 1],
      [ids[1], 'Progress payment', 4000, 2],
      [ids[2], 'On completion', 3000, 3],
    ]);
    expect(totalOf(id)?.scheduled_bp).toBe(10_000);
    expect(audit("table_name = 'estimate_payments'").map((a) => a.action)).toEqual(['insert', 'insert', 'insert']);
  });

  it('refuses when stages already exist, and says so with a key the screen can ask about', () => {
    const id = mk();
    const own = addStage(id, 2000, { label: 'Mine' });
    expect(refused(() => applyStandardSchedule(id))).toEqual({ field: 'payments', key: 'errScheduleExists' });
    expect(live('estimate_payments', id).map((r) => r.id)).toEqual([own]);
  });

  it('replaces the stages when the caller says so, removing the old ones and numbering the new ones from 1', () => {
    const id = mk();
    const a = addStage(id, 2000, { label: 'Mine' });
    const b = addStage(id, 1000, { label: 'Also mine' });
    const ids = applyStandardSchedule(id, { replace: true });
    expect(live('estimate_payments', id).map((r) => r.id)).toEqual(ids);
    expect(positions('estimate_payments', id)).toEqual([1, 2, 3]);
    expect([a, b].map((x) => row<EstimatePayment>('estimate_payments', x).deleted_at)).toEqual([expect.any(String), expect.any(String)]);
    expect(totalOf(id)?.scheduled_bp).toBe(10_000);
  });

  it('can be applied again once the stages are gone', () => {
    const id = mk();
    applyStandardSchedule(id);
    live('estimate_payments', id).forEach((r) => removeEstimatePayment(r.id));
    expect(applyStandardSchedule(id)).toHaveLength(3);
    expect(live('estimate_payments', id)).toHaveLength(3);
  });

  it('needs an estimate that exists and is not accepted', () => {
    expect(refused(() => applyStandardSchedule(newId())).key).toBe('errEstimateMissing');
    const { id } = acceptedEstimate();
    expect(refused(() => applyStandardSchedule(id, { replace: true })).key).toBe('errEstimateLocked');
  });
});

describe('status', () => {
  it('can go from any status to any other, always allowed', () => {
    const id = mk();
    const all4: EstimateStatus[] = ['draft', 'sent', 'accepted', 'declined'];
    for (const from of all4) {
      for (const to of all4) {
        setEstimateStatus(id, from);
        setEstimateStatus(id, to);
        expect({ from, to, status: est(id).status }).toEqual({ from, to, status: to });
      }
    }
  });

  it('changes the estimate row and nothing else: not its lines, stages, project link or other fields', () => {
    const id = mk({ notes: 'N', tax_bp: 800 });
    const i = addItem(id);
    const p = addStage(id, 5000);
    const lines = [row('estimate_items', i), row('estimate_payments', p)];
    const before = est(id);
    const n = auditCount();
    clock.tick(60_000);
    setEstimateStatus(id, 'sent');
    expect(est(id)).toEqual({ ...before, status: 'sent', version: before.version + 1, updated_at: expect.any(String) });
    expect([row('estimate_items', i), row('estimate_payments', p)]).toEqual(lines);
    const entries = audit('seq > ?', [n]);
    expect(entries.map((a) => [a.table_name, a.row_id, a.action])).toEqual([['estimates', id, 'update']]);
    expect(JSON.parse(entries[0].data as string)).toEqual({ id, status: 'sent' });
  });

  it('the same status again does nothing: no version, no audit entry', () => {
    const id = mk();
    setEstimateStatus(id, 'sent');
    const before = snapshot();
    setEstimateStatus(id, 'sent');
    expect(snapshot()).toEqual(before);
  });

  it('refuses an estimate that is missing or deleted, and a status that does not exist', () => {
    expect(refused(() => setEstimateStatus(newId(), 'sent')).key).toBe('errEstimateMissing');
    const id = mk();
    expect(() => setEstimateStatus(id, 'paid' as EstimateStatus)).toThrow(/Unknown estimate status/);
    deleteEstimate(id);
    expect(refused(() => setEstimateStatus(id, 'sent')).key).toBe('errEstimateMissing');
  });
});

describe('an accepted estimate is locked', () => {
  const locked = { field: 'estimate', key: 'errEstimateLocked' };

  it('refuses every change to its lines, its stages, its discount and its tax, and writes nothing', () => {
    const { id, i1, p1 } = acceptedEstimate();
    expect(refused(() => addItem(id))).toEqual(locked);
    expect(refused(() => saveEstimateItem({ id: i1, estimate_id: id, description: 'changed', qty_milli: 1000, rate_cents: 1 }))).toEqual(locked);
    expect(refused(() => removeEstimateItem(i1))).toEqual(locked);
    expect(refused(() => addStage(id, 1))).toEqual(locked);
    expect(refused(() => saveEstimatePayment({ id: p1, estimate_id: id, label: 'x', percent_bp: 5000 }))).toEqual(locked);
    expect(refused(() => removeEstimatePayment(p1))).toEqual(locked);
    expect(refused(() => applyStandardSchedule(id))).toEqual(locked);
    expect(refused(() => saveEstimate({ id, discount_cents: 100 }))).toEqual(locked);
    expect(refused(() => saveEstimate({ id, tax_bp: 0 }))).toEqual(locked);
    expect(refused(() => saveEstimate({ id, title: 'T', discount_cents: 100, tax_bp: 1 }))).toEqual(locked);
  });

  it('still lets the details change: client, title, number, dates, terms, notes, and the same discount and tax sent again', () => {
    const { id } = acceptedEstimate();
    const t = totalOf(id);
    saveEstimate({
      id,
      client_name: 'New client',
      client_phone: '0770000000',
      title: 'New title',
      number: 'EST-2026-050',
      issue_day: '2026-10-25',
      valid_days: 10,
      terms: 'T',
      notes: 'N2',
      discount_cents: 0, // what it already is
      tax_bp: 800, // what it already is
    });
    expect(est(id)).toMatchObject({ client_name: 'New client', title: 'New title', number: 'EST-2026-050', valid_days: 10, status: 'accepted', discount_cents: 0, tax_bp: 800 });
    expect(totalOf(id)).toEqual(t);
  });

  it('is unlocked by reopening it as a draft, and changes work again', () => {
    const { id, i1 } = acceptedEstimate();
    setEstimateStatus(id, 'draft');
    expect(() => saveEstimateItem({ id: i1, estimate_id: id, description: 'changed', qty_milli: 1000, rate_cents: 1 })).not.toThrow();
    expect(() => saveEstimate({ id, tax_bp: 0 })).not.toThrow();
    expect(refused(() => addStage(id, 1)).key).toBe('errScheduleOver'); // 60 + 40 = 100 %: now the schedule is full, no longer locked
  });

  it('is only the accepted status: draft, sent and declined estimates can all be edited', () => {
    for (const status of ['draft', 'sent', 'declined'] as const) {
      const id = mk();
      setEstimateStatus(id, status);
      expect(() => addItem(id)).not.toThrow();
      expect(() => addStage(id, 1000)).not.toThrow();
      expect(() => saveEstimate({ id, tax_bp: 100 })).not.toThrow();
    }
  });

  it('can still be duplicated, deleted and turned into a project', () => {
    const { id } = acceptedEstimate();
    expect(() => duplicateEstimate(id)).not.toThrow();
    expect(() => createProjectFromEstimate(id)).not.toThrow();
    expect(() => deleteEstimate(id)).not.toThrow();
  });
});

describe('duplicate', () => {
  it('makes a new draft with a new number, today\'s date, and the same client, lines, stages, discount, tax, terms and notes', () => {
    const id = mk({
      client_phone: '0771',
      client_address: 'Temple Rd',
      location: 'Welimada',
      issue_day: '2026-09-01',
      valid_days: 21,
      tax_bp: 800,
      terms: 'Terms',
      notes: 'Notes',
    });
    addItem(id, { description: 'A' });
    addItem(id, { description: 'B', unit: null, qty_milli: 1_500, rate_cents: 333 });
    addStage(id, 6000, { label: 'Advance' });
    addStage(id, 4000, { label: 'Final' });
    saveEstimate({ id, discount_cents: 1_000 });
    setEstimateStatus(id, 'sent');
    clock.set(new Date(2026, 10, 3, 10, 0, 0));

    const copy = duplicateEstimate(id);
    expect(copy).not.toBe(id);
    expect(est(copy)).toMatchObject({
      number: 'EST-2026-002',
      client_name: 'Mr. Perera',
      client_phone: '0771',
      client_address: 'Temple Rd',
      title: 'Boundary wall',
      location: 'Welimada',
      issue_day: '2026-11-03',
      valid_days: 21,
      discount_cents: 1_000,
      tax_bp: 800,
      status: 'draft',
      terms: 'Terms',
      notes: 'Notes',
      project_id: null,
      version: 1,
    });
    const a = loadEstimate(id);
    const b = loadEstimate(copy);
    const strip = <T extends { id: string; estimate_id: string }>(rows: T[] | undefined) =>
      rows?.map((r) => ({ ...r, id: '', estimate_id: '', created_at: '', updated_at: '', device_id: '' }));
    expect(strip(b?.items)).toEqual(strip(a?.items));
    expect(strip(b?.payments)).toEqual(strip(a?.payments));
    expect(b?.total).toEqual({ ...a?.total, estimate_id: copy });
    expect(est(id).status).toBe('sent'); // the original is untouched
  });

  it('copies a locked estimate as an editable draft, and never the project link', () => {
    const { id } = acceptedEstimate();
    createProjectFromEstimate(id);
    expect(est(id).project_id).not.toBeNull();
    const copy = duplicateEstimate(id);
    expect(est(copy)).toMatchObject({ status: 'draft', project_id: null });
    expect(() => addItem(copy)).not.toThrow();
  });

  it('does not copy deleted lines or stages, and numbers the copy from 1', () => {
    const id = mk();
    const a = addItem(id, { description: 'A' });
    addItem(id, { description: 'B' });
    const s = addStage(id, 3000);
    addStage(id, 3000);
    removeEstimateItem(a);
    removeEstimatePayment(s);
    const copy = duplicateEstimate(id);
    expect(loadEstimate(copy)?.items.map((i) => [i.description, i.position])).toEqual([['B', 1]]);
    expect(loadEstimate(copy)?.payments.map((p) => p.position)).toEqual([1]);
  });

  it('is independent of the original afterwards', () => {
    const id = mk();
    const line = addItem(id);
    const copy = duplicateEstimate(id);
    const copyLine = live('estimate_items', copy)[0].id;
    expect(copyLine).not.toBe(line);
    removeEstimateItem(copyLine);
    saveEstimateItem({ id: line, estimate_id: id, description: 'changed', qty_milli: 1000, rate_cents: 1 });
    expect(loadEstimate(copy)?.items).toHaveLength(0);
    expect(loadEstimate(id)?.items).toHaveLength(1);
  });

  it('is written through the write path: inserts for the estimate and every line and stage', () => {
    const id = mk();
    addItem(id);
    addItem(id);
    addStage(id, 5000);
    const n = auditCount();
    const copy = duplicateEstimate(id);
    const entries = audit('seq > ?', [n]);
    expect(entries.map((a) => [a.table_name, a.action])).toEqual([
      ['estimates', 'insert'],
      ['estimate_items', 'insert'],
      ['estimate_items', 'insert'],
      ['estimate_payments', 'insert'],
    ]);
    expect(entries[0].row_id).toBe(copy);
  });

  it('refuses an estimate that is missing or deleted', () => {
    expect(refused(() => duplicateEstimate(newId())).key).toBe('errEstimateMissing');
    const id = mk();
    deleteEstimate(id);
    expect(refused(() => duplicateEstimate(id)).key).toBe('errEstimateMissing');
  });
});

describe('delete', () => {
  it('soft-deletes the estimate with its lines and stages in one step, each with an audit entry', () => {
    const id = mk();
    const i1 = addItem(id);
    const i2 = addItem(id);
    const p1 = addStage(id, 5000);
    const other = mk();
    const otherLine = addItem(other);
    const n = auditCount();
    deleteEstimate(id);
    for (const [table, rid] of [['estimates', id], ['estimate_items', i1], ['estimate_items', i2], ['estimate_payments', p1]] as const) {
      expect(row<{ deleted_at: string | null; version: number }>(table, rid)).toMatchObject({ deleted_at: expect.any(String), version: expect.any(Number) });
    }
    expect(audit('seq > ?', [n]).map((a) => [a.table_name, a.action]).sort()).toEqual(
      [['estimate_items', 'delete'], ['estimate_items', 'delete'], ['estimate_payments', 'delete'], ['estimates', 'delete']].sort(),
    );
    expect(loadEstimate(id)).toBeNull();
    expect(first('SELECT * FROM v_estimate_total WHERE estimate_id = ?', [id])).toBeNull();
    // the other estimate is untouched
    expect(row<{ deleted_at: string | null }>('estimate_items', otherLine).deleted_at).toBeNull();
    expect(loadEstimate(other)?.items).toHaveLength(1);
  });

  it('is rolled back as a whole when something fails half way', () => {
    const id = mk();
    addItem(id);
    addStage(id, 5000);
    getDb().execSync("CREATE TRIGGER boom BEFORE UPDATE OF deleted_at ON estimates BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    const mute = silenceConsoleError();
    const before = snapshot();
    expect(() => deleteEstimate(id)).toThrow(/boom/);
    mute.mockRestore();
    expect(snapshot()).toEqual(before);
    expect(loadEstimate(id)?.items).toHaveLength(1);
  });

  it('a second delete, or an unknown id, changes nothing', () => {
    const id = mk();
    deleteEstimate(id);
    const before = snapshot();
    deleteEstimate(id);
    deleteEstimate(newId());
    expect(snapshot()).toEqual(before);
  });

  it('leaves a linked project alone, and works on an accepted estimate', () => {
    const { id } = acceptedEstimate();
    const project = createProjectFromEstimate(id);
    deleteEstimate(id);
    expect(first('SELECT name, deleted_at FROM projects WHERE id = ?', [project])).toEqual({ name: 'Boundary wall', deleted_at: null });
  });

  it('a deleted estimate no longer counts anywhere: list, totals, number clash', () => {
    const id = mk();
    deleteEstimate(id);
    expect(all('SELECT * FROM v_estimate_total')).toEqual([]);
    expect(est(mk({ number: 'EST-2026-001' })).number).toBe('EST-2026-001'); // the number is free again for a typed one
  });
});

describe('create a project from an accepted estimate', () => {
  it('makes an active project from the title, client, location and total, and links it', () => {
    const id = mk({ client_name: 'Mr. Perera', title: 'Boundary wall, Welimada', location: 'Welimada', tax_bp: 800 });
    addItem(id);
    addItem(id, { description: 'Plaster', qty_milli: 20_000, rate_cents: 100_000 });
    saveEstimate({ id, discount_cents: 200_000 });
    setEstimateStatus(id, 'accepted');
    const total = totalOf(id)?.total_cents as number;
    expect(total).toBe(Math.round((7_000_000 - 200_000) * 1.08)); // 6,800,000 + 8 % = 7,344,000

    const p = createProjectFromEstimate(id);
    expect(first('SELECT * FROM projects WHERE id = ?', [p])).toMatchObject({
      name: 'Boundary wall, Welimada',
      client: 'Mr. Perera',
      location: 'Welimada',
      contract_cents: total,
      status: 'active',
      deleted_at: null,
      version: 1,
    });
    expect(est(id)).toMatchObject({ project_id: p, status: 'accepted' });
    expect(first('SELECT contract_cents FROM v_project_cost WHERE project_id = ?', [p])).toEqual({ contract_cents: 7_344_000 });
  });

  it('is one step: a project insert and an estimate update in the audit log, nothing else', () => {
    const { id } = acceptedEstimate();
    const n = auditCount();
    const p = createProjectFromEstimate(id);
    expect(audit('seq > ?', [n]).map((a) => [a.table_name, a.row_id, a.action])).toEqual([
      ['projects', p, 'insert'],
      ['estimates', id, 'update'],
    ]);
  });

  it('is refused unless the estimate is accepted', () => {
    for (const status of ['draft', 'sent', 'declined'] as const) {
      const id = mk();
      setEstimateStatus(id, status);
      expect(refused(() => createProjectFromEstimate(id))).toEqual({ field: 'estimate', key: 'errEstimateNotAccepted' });
    }
    expect(first('SELECT COUNT(*) AS n FROM projects')).toEqual({ n: 0 });
  });

  it('is refused the second time, and no second project appears', () => {
    const { id } = acceptedEstimate();
    const p = createProjectFromEstimate(id);
    expect(refused(() => createProjectFromEstimate(id))).toEqual({ field: 'estimate', key: 'errEstimateLinked' });
    expect(first('SELECT COUNT(*) AS n FROM projects')).toEqual({ n: 1 });
    expect(est(id).project_id).toBe(p);
  });

  it('is still refused after reopening and accepting again: the link stays', () => {
    const { id } = acceptedEstimate();
    createProjectFromEstimate(id);
    setEstimateStatus(id, 'draft');
    setEstimateStatus(id, 'accepted');
    expect(refused(() => createProjectFromEstimate(id)).key).toBe('errEstimateLinked');
  });

  it('keeps the contract value it had: later edits of the estimate do not move it', () => {
    const { id, i1 } = acceptedEstimate();
    const p = createProjectFromEstimate(id);
    const contract = first<{ contract_cents: number }>('SELECT contract_cents FROM projects WHERE id = ?', [p])?.contract_cents;
    setEstimateStatus(id, 'draft');
    saveEstimateItem({ id: i1, estimate_id: id, description: 'Changed', qty_milli: 99_000, rate_cents: 999_999 });
    expect(totalOf(id)?.total_cents).not.toBe(contract);
    expect(first('SELECT contract_cents FROM projects WHERE id = ?', [p])).toEqual({ contract_cents: contract });
  });

  it('works for an estimate worth nothing (contract value 0)', () => {
    const id = mk();
    setEstimateStatus(id, 'accepted');
    const p = createProjectFromEstimate(id);
    expect(first('SELECT contract_cents FROM projects WHERE id = ?', [p])).toEqual({ contract_cents: 0 });
  });

  it('allows a new project when the linked one was deleted on this phone', () => {
    const { id } = acceptedEstimate();
    const first1 = createProjectFromEstimate(id);
    deleteRecord('projects', first1);
    const second = createProjectFromEstimate(id);
    expect(second).not.toBe(first1);
    expect(est(id).project_id).toBe(second);
  });

  it('is refused while the linked project is not on this phone (it arrived with an imported estimate), so no second project is made', () => {
    const { id } = acceptedEstimate();
    getDb().execSync('PRAGMA foreign_keys = OFF');
    save('estimates', { id, project_id: newId() });
    getDb().execSync('PRAGMA foreign_keys = ON');
    expect(refused(() => createProjectFromEstimate(id)).key).toBe('errEstimateLinked');
  });

  it('needs an estimate that exists', () => {
    expect(refused(() => createProjectFromEstimate(newId())).key).toBe('errEstimateMissing');
  });

  it('either makes the project and the link, or neither', () => {
    const { id } = acceptedEstimate();
    getDb().execSync("CREATE TRIGGER no_link BEFORE UPDATE OF project_id ON estimates BEGIN SELECT RAISE(ABORT, 'no link'); END;");
    const mute = silenceConsoleError();
    const before = snapshot();
    expect(() => createProjectFromEstimate(id)).toThrow(/no link/);
    mute.mockRestore();
    expect(snapshot()).toEqual(before);
    expect(first('SELECT COUNT(*) AS n FROM projects')).toEqual({ n: 0 });
  });

  it('the project is an ordinary one: it can be edited and takes expenses', () => {
    const { id } = acceptedEstimate();
    const p = createProjectFromEstimate(id);
    expect(() => saveProject({ id: p, name: 'Renamed', contract_cents: 1 })).not.toThrow();
    expect(est(id).title).toBe('Boundary wall');
  });
});

describe('the write path', () => {
  it('every change of every estimate table bumps the version by one and leaves exactly one audit entry', () => {
    const a = mk({ tax_bp: 800 });
    const i1 = addItem(a);
    const i2 = addItem(a, { description: 'B' });
    addItem(a, { description: 'C' });
    saveEstimateItem({ id: i2, estimate_id: a, description: 'B2', qty_milli: 1000, rate_cents: 100 });
    removeEstimateItem(i1);
    applyStandardSchedule(a);
    const p = live('estimate_payments', a)[0].id;
    saveEstimatePayment({ id: p, estimate_id: a, label: 'Deposit', percent_bp: 2000 });
    removeEstimatePayment(live('estimate_payments', a)[2].id);
    saveEstimate({ id: a, discount_cents: 100, notes: 'x' });
    setEstimateStatus(a, 'sent');
    setEstimateStatus(a, 'accepted');
    const project = createProjectFromEstimate(a);
    const copy = duplicateEstimate(a);
    setEstimateStatus(a, 'draft');
    removeEstimateItem(live('estimate_items', copy)[0].id);
    deleteEstimate(copy);
    deleteEstimate(a);

    for (const table of ['estimates', 'estimate_items', 'estimate_payments', 'projects'] as const) {
      for (const r of all<{ id: string; version: number }>(`SELECT id, version FROM ${table}`)) {
        const entries = audit('table_name = ? AND row_id = ?', [table, r.id]);
        expect({ table, id: r.id, version: r.version }).toEqual({ table, id: r.id, version: entries.length });
        expect(entries[0].action).toBe('insert');
        expect(entries.slice(1).every((e) => e.action === 'update' || e.action === 'delete')).toBe(true);
      }
    }
    expect(project).toBeTruthy();
    // every audit entry is for a table the app knows
    expect(new Set(audit().map((e) => e.table_name))).toEqual(new Set(['estimates', 'estimate_items', 'estimate_payments', 'projects']));
  });

  it('all the repo calls stamp this phone\'s device id and the time of the change', () => {
    const id = mk();
    clock.tick(5000);
    const line = addItem(id);
    const stage = addStage(id, 5000);
    for (const [table, rid] of [['estimates', id], ['estimate_items', line], ['estimate_payments', stage]] as const) {
      const r = row<{ device_id: string; created_at: string; updated_at: string }>(table, rid);
      expect(r.device_id).toBe(first<{ value: string }>("SELECT value FROM settings WHERE key = 'device_id'")?.value);
      expect(r.updated_at).toBe(r.created_at);
    }
  });
});

describe('what the person sees', () => {
  const KEYS = [
    'errEstimateClient',
    'errEstimateTitle',
    'errEstimateNumber',
    'errEstimateMissing',
    'errEstimateLocked',
    'errEstimateNotAccepted',
    'errEstimateLinked',
    'errValidDays',
    'errTax',
    'errDiscountTooHigh',
    'errItemDescription',
    'errQty',
    'errAmountTooLarge',
    'errItemLimit',
    'errStageLabel',
    'errPercent',
    'errScheduleOver',
    'errScheduleExists',
    'errDate',
    'errAmount',
  ] as const;

  it.each(KEYS)('%s has its own words in English, Sinhala and Tamil', (key) => {
    for (const dict of [en, si, ta] as Record<string, string>[]) {
      expect(typeof dict[key]).toBe('string');
      expect(dict[key].trim().length).toBeGreaterThan(3);
    }
    expect(si[key]).not.toBe(en[key]);
    expect(ta[key]).not.toBe(en[key]);
  });

  it('every key a ValidationError of the repo carries is one of those', () => {
    const used = new Set<string>();
    const note = (write: () => unknown) => {
      try {
        write();
      } catch (e) {
        if (e instanceof ValidationError) used.add(e.key);
      }
    };
    const id = mk();
    addItem(id);
    const locked = acceptedEstimate();
    note(() => mk({ client_name: '' }));
    note(() => mk({ title: '' }));
    note(() => saveEstimate({ id, number: '' }));
    note(() => mk({ issue_day: 'x' }));
    note(() => mk({ valid_days: 0 }));
    note(() => mk({ tax_bp: -1 }));
    note(() => mk({ discount_cents: -1 }));
    note(() => saveEstimate({ id, discount_cents: 999_999_999 }));
    note(() => addItem(id, { description: '' }));
    note(() => addItem(id, { qty_milli: 0 }));
    note(() => addItem(id, { rate_cents: -1 }));
    note(() => addItem(id, { qty_milli: MAX_QTY_MILLI, rate_cents: MAX_RATE_CENTS }));
    note(() => addStage(id, 0));
    note(() => addStage(id, 1, { label: '' }));
    addStage(id, 10_000);
    note(() => addStage(id, 1));
    note(() => applyStandardSchedule(id));
    note(() => addItem(locked.id));
    note(() => addItem(newId()));
    note(() => createProjectFromEstimate(id));
    createProjectFromEstimate(locked.id);
    note(() => createProjectFromEstimate(locked.id));
    expect([...used].filter((k) => !(KEYS as readonly string[]).includes(k))).toEqual([]);
    // and the list above is not padded: every key but the 200-line limit (tested with the lines) really was reached
    expect(KEYS.filter((k) => k !== 'errItemLimit' && !used.has(k))).toEqual([]);
  });
});
