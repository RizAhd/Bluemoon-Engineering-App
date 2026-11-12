/**
 * Money received from the client, part by part. The project value is 1 crore (Rs 10,000,000); the client pays
 * Rs 10 lakh, later Rs 20 lakh: received 30 lakh, still to receive 70 lakh. One place does the sums
 * (receiptSummary), the database view (v_project_received) must agree with it.
 */
import { all, first, mergeRow } from '@/db';
import { deleteRecord, saveExpense, saveProject, saveReceipt, ValidationError } from '@/db/repo';
import { DATA_TABLES } from '@/db/schema';
import type { ProjectReceived } from '@/db/types';
import { dataMark } from '@/lib/autoBackup';
import { collectAll, collectProject } from '@/lib/bundle';
import { receiptSummary } from '@/lib/receipts';
import { resetDb } from '@/test-utils';

const rs = (n: number) => Math.round(n * 100);
const CRORE = rs(10_000_000);
const LAKH = rs(100_000);

beforeEach(() => resetDb());

const received = (id: string) => first<ProjectReceived>('SELECT * FROM v_project_received WHERE project_id = ?', [id]);
const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ValidationError ? `${e.field}:${e.key}` : String(e);
  }
  return null;
};

describe('receiptSummary (the sums)', () => {
  it('1 crore, 10 lakh then 20 lakh: received 30 lakh, still to receive 70 lakh, 30 %', () => {
    expect(receiptSummary(CRORE, 10 * LAKH)).toEqual({ value: CRORE, received: 10 * LAKH, left: 90 * LAKH, over: 0, percent: 10 });
    expect(receiptSummary(CRORE, 30 * LAKH)).toEqual({ value: CRORE, received: 30 * LAKH, left: 70 * LAKH, over: 0, percent: 30 });
  });
  it('paid in full: nothing left, 100 %', () => {
    expect(receiptSummary(CRORE, CRORE)).toMatchObject({ left: 0, over: 0, percent: 100 });
  });
  it('past the value: left stays 0, over says by how much, the bar stays at 100 %', () => {
    expect(receiptSummary(CRORE, CRORE + 5 * LAKH)).toMatchObject({ left: 0, over: 5 * LAKH, percent: 100 });
  });
  it('99.9 % is not 100 %', () => {
    expect(receiptSummary(CRORE, CRORE - 1).percent).toBe(99);
  });
  it('without a value only the received total is known', () => {
    expect(receiptSummary(null, 5 * LAKH)).toEqual({ value: null, received: 5 * LAKH, left: null, over: 0, percent: 0 });
    expect(receiptSummary(0, 5 * LAKH).value).toBeNull();
  });
  it('whole cents all the way: no float drift on large values', () => {
    expect(receiptSummary(10_000_000_000, 3_333_333_333)).toMatchObject({ percent: 33, left: 6_666_666_667 });
  });
});

describe('saveReceipt and v_project_received', () => {
  it('records each payment and the view adds them up', () => {
    const p = saveProject({ name: 'Big Job', contract_cents: CRORE });
    expect(received(p)).toMatchObject({ received_cents: 0, receipt_count: 0, last_day: null, contract_cents: CRORE });
    saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: 10 * LAKH, method: 'bank', note: 'Advance' });
    saveReceipt({ project_id: p, day: '2026-11-05', amount_cents: 20 * LAKH, method: 'cheque' });
    expect(received(p)).toMatchObject({ received_cents: 30 * LAKH, receipt_count: 2, last_day: '2026-11-05' });
    const sum = receiptSummary(CRORE, received(p)?.received_cents ?? 0);
    expect(sum.left).toBe(70 * LAKH);
  });

  it('is per project: another project payments are not counted', () => {
    const a = saveProject({ name: 'A', contract_cents: CRORE });
    const b = saveProject({ name: 'B' });
    saveReceipt({ project_id: a, day: '2026-10-01', amount_cents: LAKH, method: 'cash' });
    saveReceipt({ project_id: b, day: '2026-10-01', amount_cents: 2 * LAKH, method: 'cash' });
    expect(received(a)?.received_cents).toBe(LAKH);
    expect(received(b)).toMatchObject({ received_cents: 2 * LAKH, contract_cents: null });
  });

  it('changing the value afterwards changes what is left, not what was received', () => {
    const p = saveProject({ name: 'Job', contract_cents: CRORE });
    saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: 10 * LAKH, method: 'bank' });
    saveProject({ id: p, name: 'Job', contract_cents: 2 * CRORE });
    const r = received(p) as ProjectReceived;
    expect(r.received_cents).toBe(10 * LAKH);
    expect(receiptSummary(r.contract_cents, r.received_cents).left).toBe(190 * LAKH);
  });

  it('editing a payment replaces it, it does not add another', () => {
    const p = saveProject({ name: 'Job', contract_cents: CRORE });
    const id = saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: 10 * LAKH, method: 'bank' });
    saveReceipt({ id, project_id: p, day: '2026-10-02', amount_cents: 15 * LAKH, method: 'cash', note: '  fixed  ' });
    expect(received(p)).toMatchObject({ received_cents: 15 * LAKH, receipt_count: 1, last_day: '2026-10-02' });
    expect(first('SELECT note, method, version FROM project_receipts WHERE id = ?', [id])).toEqual({ note: 'fixed', method: 'cash', version: 2 });
  });

  it('refuses what cannot be right, with the same words as other money', () => {
    const p = saveProject({ name: 'Job' });
    const ok = { project_id: p, day: '2026-10-01', method: 'bank' as const };
    expect(err(() => saveReceipt({ ...ok, amount_cents: null }))).toBe('amount:errAmount');
    expect(err(() => saveReceipt({ ...ok, amount_cents: 0 }))).toBe('amount:errAmount');
    expect(err(() => saveReceipt({ ...ok, amount_cents: -5 }))).toBe('amount:errAmount');
    expect(err(() => saveReceipt({ ...ok, amount_cents: 1.5 }))).toBe('amount:errAmount');
    expect(err(() => saveReceipt({ ...ok, amount_cents: 10_000_000_001 }))).toBe('amount:errAmountTooBig');
    expect(err(() => saveReceipt({ ...ok, day: '2026-13-40', amount_cents: 100 }))).toBe('day:errDate');
    expect(err(() => saveReceipt({ ...ok, project_id: null, amount_cents: 100 }))).toBe('project_id:errProject');
    expect(err(() => saveReceipt({ ...ok, project_id: 'nope', amount_cents: 100 }))).toBe('project_id:errProject');
    expect(received(p)?.receipt_count).toBe(0);
  });

  it('going past the project value is allowed (extra work is real); the sums say over', () => {
    const p = saveProject({ name: 'Job', contract_cents: CRORE });
    saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: CRORE, method: 'bank' });
    saveReceipt({ project_id: p, day: '2026-10-02', amount_cents: LAKH, method: 'bank' });
    const r = received(p) as ProjectReceived;
    expect(receiptSummary(r.contract_cents, r.received_cents)).toMatchObject({ left: 0, over: LAKH });
  });

  it('is independent of what was spent: expenses do not change what was received', () => {
    const p = saveProject({ name: 'Job', contract_cents: CRORE });
    saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: 10 * LAKH, method: 'bank' });
    saveExpense({ project_id: p, day: '2026-10-02', category: 'materials', amount_cents: 3 * LAKH, method: 'cash' });
    expect(received(p)?.received_cents).toBe(10 * LAKH);
  });
});

describe('delete', () => {
  it('deleting one payment takes it out of the total, softly', () => {
    const p = saveProject({ name: 'Job', contract_cents: CRORE });
    const a = saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: 10 * LAKH, method: 'bank' });
    saveReceipt({ project_id: p, day: '2026-10-02', amount_cents: 20 * LAKH, method: 'bank' });
    deleteRecord('project_receipts', a);
    expect(received(p)).toMatchObject({ received_cents: 20 * LAKH, receipt_count: 1 });
    expect(first<{ deleted_at: string | null }>('SELECT deleted_at FROM project_receipts WHERE id = ?', [a])?.deleted_at).not.toBeNull();
    deleteRecord('project_receipts', a); // a second tap changes nothing
    expect(received(p)?.received_cents).toBe(20 * LAKH);
  });

  it('deleting the project takes its payments with it and no other project', () => {
    const a = saveProject({ name: 'A', contract_cents: CRORE });
    const b = saveProject({ name: 'B', contract_cents: CRORE });
    saveReceipt({ project_id: a, day: '2026-10-01', amount_cents: LAKH, method: 'bank' });
    saveReceipt({ project_id: b, day: '2026-10-01', amount_cents: LAKH, method: 'bank' });
    deleteRecord('projects', a);
    expect(all('SELECT id FROM project_receipts WHERE project_id = ? AND deleted_at IS NULL', [a])).toHaveLength(0);
    expect(all('SELECT id FROM project_receipts WHERE project_id = ? AND deleted_at IS NULL', [b])).toHaveLength(1);
    expect(received(a)).toBeNull(); // the project is gone
  });
});

describe('backups and hand-off carry the payments', () => {
  it('is a data table, parents first', () => {
    expect(DATA_TABLES.indexOf('project_receipts')).toBeGreaterThan(DATA_TABLES.indexOf('projects'));
  });

  it('a full backup and a project hand-off both include them, and the backup change mark moves', () => {
    const p = saveProject({ name: 'Job', contract_cents: CRORE });
    const before = dataMark();
    saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: 10 * LAKH, method: 'bank' });
    expect(dataMark()).not.toBe(before);
    expect(collectAll().project_receipts).toHaveLength(1);
    expect(collectProject(p).project_receipts).toHaveLength(1);
  });

  it('merging the same payment twice does not count it twice; a changed copy updates it', () => {
    const p = saveProject({ name: 'Job', contract_cents: CRORE });
    const id = saveReceipt({ project_id: p, day: '2026-10-01', amount_cents: 10 * LAKH, method: 'bank' });
    const row = all<Record<string, unknown>>('SELECT * FROM project_receipts WHERE id = ?', [id])[0];
    expect(mergeRow('project_receipts', row as never)).toBe('skipped');
    expect(mergeRow('project_receipts', { ...row, version: 3, amount_cents: 12 * LAKH } as never)).toBe('updated');
    expect(received(p)).toMatchObject({ received_cents: 12 * LAKH, receipt_count: 1 });
  });
});
