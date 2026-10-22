/**
 * Migration 5 (estimates) and the view v_estimate_total: a fresh install, an upgrade from version 4
 * with the owner's data in it, every CHECK, and the totals for many combinations.
 */
import { createHash } from 'node:crypto';

import { all, closeDb, first, getDb, newId, save } from '@/db';
import { DATA_TABLES, migrations } from '@/db/schema';
import type { EstimateTotal } from '@/db/types';
import { estimateSums } from '@/lib/estimate';
import { resetDb, silenceConsoleError } from '@/test-utils';
import { openLegacyDb } from '@/test-utils/dataKit';
import { insertRow } from '@/test-utils/legacyData';

jest.setTimeout(60_000);

beforeEach(() => resetDb());

const userVersion = () => first<{ user_version: number }>('PRAGMA user_version')?.user_version ?? -1;
const names = (type: 'table' | 'index' | 'view') =>
  all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name", [type]).map((r) => r.name);

/** A bare estimate row straight into the table (no repo rules), so the view can be fed any combination the database allows. */
function estimate(over: Record<string, string | number | null> = {}): string {
  return save('estimates', { number: 'EST-2026-001', client_name: 'Client', title: 'Wall', issue_day: '2026-10-20', ...over });
}
const item = (estimate_id: string, qty_milli: number, rate_cents: number, over: Record<string, string | number | null> = {}) =>
  save('estimate_items', { estimate_id, position: 1, description: 'Line', qty_milli, rate_cents, ...over });
const stage = (estimate_id: string, percent_bp: number, over: Record<string, string | number | null> = {}) =>
  save('estimate_payments', { estimate_id, position: 1, label: 'Stage', percent_bp, ...over });
const total = (id: string) => first<EstimateTotal>('SELECT * FROM v_estimate_total WHERE estimate_id = ?', [id]);

describe('migration 5 on an empty database', () => {
  it('creates the three tables, the indexes and the view, and the app runs at the latest version', () => {
    getDb();
    expect(userVersion()).toBe(migrations.length);
    expect(migrations.length).toBeGreaterThanOrEqual(5);
    expect(names('table')).toEqual(expect.arrayContaining(['estimates', 'estimate_items', 'estimate_payments']));
    expect(names('view')).toContain('v_estimate_total');
    expect(names('index')).toEqual(expect.arrayContaining(['ix_estimates_status_day', 'ix_estimate_items_estimate', 'ix_estimate_payments_estimate']));
    expect(all('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('the three tables have the common columns and the columns of the spec', () => {
    const cols = (t: string) => all<{ name: string }>(`PRAGMA table_info(${t})`).map((c) => c.name);
    const common = ['id', 'created_at', 'updated_at', 'deleted_at', 'version', 'device_id'];
    expect(cols('estimates')).toEqual([
      ...common,
      ...['number', 'client_name', 'client_phone', 'client_address', 'title', 'location', 'issue_day', 'valid_days', 'discount_cents', 'tax_bp', 'status', 'terms', 'notes', 'project_id'],
    ]);
    expect(cols('estimate_items')).toEqual([...common, 'estimate_id', 'position', 'description', 'unit', 'qty_milli', 'rate_cents']);
    expect(cols('estimate_payments')).toEqual([...common, 'estimate_id', 'position', 'label', 'percent_bp']);
  });

  it('the index on (status, issue_day) covers the two columns in that order', () => {
    expect(all<{ name: string }>('PRAGMA index_info(ix_estimates_status_day)').map((c) => c.name)).toEqual(['status', 'issue_day']);
  });

  it('lines and stages point at estimates, estimates at projects', () => {
    const fk = (t: string) => all<{ table: string; from: string }>(`PRAGMA foreign_key_list(${t})`).map((r) => `${r.from}->${r.table}`);
    expect(fk('estimate_items')).toEqual(['estimate_id->estimates']);
    expect(fk('estimate_payments')).toEqual(['estimate_id->estimates']);
    expect(fk('estimates')).toEqual(['project_id->projects']);
  });

  it('the view has the columns of the EstimateTotal type, in that order', () => {
    expect(all<{ name: string }>('PRAGMA table_info(v_estimate_total)').map((c) => c.name)).toEqual([
      'estimate_id',
      'item_count',
      'subtotal_cents',
      'discount_cents',
      'tax_cents',
      'total_cents',
      'scheduled_bp',
    ]);
  });

  it('DATA_TABLES lists the new tables after projects, parents before children', () => {
    const order = [...DATA_TABLES] as string[];
    expect(order.slice(0, 4)).toEqual(['projects', 'estimates', 'estimate_items', 'estimate_payments']);
    expect(order.indexOf('estimates')).toBeLessThan(order.indexOf('estimate_items'));
    expect(order.indexOf('estimates')).toBeLessThan(order.indexOf('estimate_payments'));
    expect(order.indexOf('projects')).toBeLessThan(order.indexOf('estimates'));
  });

  it('migrations 1 to 4 still read exactly as they shipped (a shipped migration is never edited, only appended to)', () => {
    const sha = (s: string) => createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
    expect(migrations.slice(0, 4).map(sha)).toEqual(['b472d281ccc47e9f', 'd9a6334074ccd985', '9257a4bcd0edcf60', '15b2b3d999ac7416']);
  });
});

describe('what the tables refuse', () => {
  let mute: ReturnType<typeof silenceConsoleError>;
  beforeEach(() => {
    getDb();
    mute = silenceConsoleError();
  });
  afterEach(() => mute.mockRestore());

  const refuses = (write: () => unknown) => expect(write).toThrow(/constraint/i);

  it.each([
    ['a blank number', { number: '  ' }],
    ['a blank client name', { client_name: '' }],
    ['a blank title', { title: ' ' }],
    ['valid_days 0', { valid_days: 0 }],
    ['valid_days 366', { valid_days: 366 }],
    ['a negative discount', { discount_cents: -1 }],
    ['tax above 100 %', { tax_bp: 10001 }],
    ['a negative tax', { tax_bp: -1 }],
    ['an unknown status', { status: 'paid' }],
    ['an issue day that is not YYYY-MM-DD', { issue_day: '20/10/2026' }],
    ['no issue day', { issue_day: null }],
  ])('an estimate cannot have %s', (_label, over) => {
    refuses(() => estimate(over as Record<string, string | number | null>));
    expect(first('SELECT COUNT(*) AS n FROM estimates')).toEqual({ n: 0 });
  });

  it('accepts the edges: valid days 1 and 365, tax 0 and 100 %, every status', () => {
    const edges: Record<string, string | number>[] = [{ valid_days: 1 }, { valid_days: 365 }, { tax_bp: 0 }, { tax_bp: 10000 }, { status: 'draft' }, { status: 'sent' }, { status: 'accepted' }, { status: 'declined' }];
    for (const over of edges) expect(() => estimate(over)).not.toThrow();
  });

  it('defaults to a 30 day draft with no discount and no tax', () => {
    const id = estimate();
    expect(first('SELECT valid_days, discount_cents, tax_bp, status, project_id, deleted_at, version FROM estimates WHERE id = ?', [id])).toEqual({
      valid_days: 30,
      discount_cents: 0,
      tax_bp: 0,
      status: 'draft',
      project_id: null,
      deleted_at: null,
      version: 1,
    });
  });

  it.each([
    ['a blank description', { description: '' }],
    ['quantity 0', { qty_milli: 0 }],
    ['quantity above 1,000,000', { qty_milli: 1_000_000_001 }],
    ['a negative rate', { rate_cents: -1 }],
    ['a rate above Rs 50,000,000', { rate_cents: 5_000_000_001 }],
  ])('an item cannot have %s', (_label, over) => {
    const e = estimate();
    refuses(() => item(e, 1000, 100, over as Record<string, string | number | null>));
  });

  it('accepts the edges: quantity 0.001 and 1,000,000, rate 0 and Rs 50,000,000', () => {
    const e = estimate();
    expect(() => item(e, 1, 0)).not.toThrow();
    expect(() => item(e, 1_000_000_000, 5_000_000_000)).not.toThrow();
  });

  it.each([
    ['a blank label', { label: ' ' }],
    ['0 %', { percent_bp: 0 }],
    ['more than 100 %', { percent_bp: 10001 }],
  ])('a stage cannot have %s', (_label, over) => {
    const e = estimate();
    refuses(() => stage(e, 5000, over as Record<string, string | number | null>));
  });

  it('accepts 0.01 % and 100 %', () => {
    const e = estimate();
    expect(() => stage(e, 1)).not.toThrow();
    expect(() => stage(e, 10000)).not.toThrow();
  });

  it('a line, a stage or an estimate cannot point at something that does not exist', () => {
    refuses(() => item(newId(), 1000, 100));
    refuses(() => stage(newId(), 5000));
    refuses(() => estimate({ project_id: newId() }));
  });
});

describe('v_estimate_total', () => {
  beforeEach(() => {
    getDb();
  });

  it('has a row for an estimate with no items, all zero', () => {
    const e = estimate();
    expect(total(e)).toEqual({ estimate_id: e, item_count: 0, subtotal_cents: 0, discount_cents: 0, tax_cents: 0, total_cents: 0, scheduled_bp: 0 });
  });

  it('sums the lines, each line rounded half a cent up on its own', () => {
    const e = estimate();
    item(e, 1500, 333); // 499.5 -> 500
    item(e, 1, 500, { position: 2 }); // 0.5 -> 1
    item(e, 1, 500, { position: 3 }); // 0.5 -> 1 (not 1.0 for the pair)
    item(e, 1, 499, { position: 4 }); // 0.499 -> 0
    expect(total(e)).toMatchObject({ item_count: 4, subtotal_cents: 502, total_cents: 502 });
  });

  it('takes the discount off before the tax and rounds the tax half a cent up', () => {
    const e = estimate({ discount_cents: 10_000, tax_bp: 1800 });
    item(e, 2000, 50_000); // 2 x Rs 500 = 100,000
    item(e, 1000, 50_000, { position: 2 }); // 50,000
    // 150,000 - 10,000 = 140,000; 18 % = 25,200
    expect(total(e)).toEqual({ estimate_id: e, item_count: 2, subtotal_cents: 150_000, discount_cents: 10_000, tax_cents: 25_200, total_cents: 165_200, scheduled_bp: 0 });
  });

  it.each([
    [10, 500, 1], // 0.5 -> 1
    [9, 500, 0], // 0.45 -> 0
    [30, 1250, 4], // 3.75 -> 4
    [1, 5000, 1], // 0.5 -> 1
    [100_000, 1800, 18_000],
  ])('tax on %d cents at %d basis points is %d', (subtotal, bp, tax) => {
    const e = estimate({ tax_bp: bp });
    item(e, 1000, subtotal);
    expect(total(e)).toMatchObject({ subtotal_cents: subtotal, tax_cents: tax, total_cents: subtotal + tax });
  });

  it('a discount above the subtotal leaves nothing to pay and no tax, and still reports the discount that was set', () => {
    const e = estimate({ discount_cents: 9_000, tax_bp: 1800 });
    item(e, 1000, 5_000);
    expect(total(e)).toMatchObject({ subtotal_cents: 5_000, discount_cents: 9_000, tax_cents: 0, total_cents: 0 });
    // a discount of exactly the subtotal, too
    const f = estimate({ number: 'B', discount_cents: 5_000, tax_bp: 1800 });
    item(f, 1000, 5_000);
    expect(total(f)).toMatchObject({ tax_cents: 0, total_cents: 0 });
  });

  it('a discount on an estimate with no items changes nothing below zero', () => {
    const e = estimate({ discount_cents: 500 });
    expect(total(e)).toMatchObject({ subtotal_cents: 0, discount_cents: 500, total_cents: 0 });
  });

  it('ignores deleted lines and deleted stages', () => {
    const e = estimate();
    item(e, 1000, 10_000);
    const gone = item(e, 1000, 99_999, { position: 2 });
    stage(e, 3000);
    const p2 = stage(e, 4000, { position: 2 });
    expect(total(e)).toMatchObject({ item_count: 2, subtotal_cents: 109_999, scheduled_bp: 7000 });
    getDb().runSync("UPDATE estimate_items SET deleted_at = '2026-10-21T00:00:00.000Z' WHERE id = ?", [gone]);
    getDb().runSync("UPDATE estimate_payments SET deleted_at = '2026-10-21T00:00:00.000Z' WHERE id = ?", [p2]);
    expect(total(e)).toMatchObject({ item_count: 1, subtotal_cents: 10_000, total_cents: 10_000, scheduled_bp: 3000 });
  });

  it('adds up the scheduled share of the stages', () => {
    const e = estimate();
    stage(e, 3000);
    stage(e, 4000, { position: 2 });
    stage(e, 3000, { position: 3 });
    expect(total(e)?.scheduled_bp).toBe(10_000);
  });

  it('one estimate never counts the lines or stages of another', () => {
    const a = estimate();
    const b = estimate({ number: 'B' });
    item(a, 1000, 100);
    item(b, 2000, 100);
    stage(b, 5000);
    expect(total(a)).toMatchObject({ item_count: 1, subtotal_cents: 100, scheduled_bp: 0 });
    expect(total(b)).toMatchObject({ item_count: 1, subtotal_cents: 200, scheduled_bp: 5000 });
  });

  it('lists only live estimates', () => {
    const a = estimate();
    const b = estimate({ number: 'B' });
    getDb().runSync("UPDATE estimates SET deleted_at = '2026-10-21T00:00:00.000Z' WHERE id = ?", [b]);
    expect(all<{ estimate_id: string }>('SELECT estimate_id FROM v_estimate_total').map((r) => r.estimate_id)).toEqual([a]);
  });

  it('keeps whole cents as integers at the top of the range the app allows', () => {
    // 200 lines of Rs 10 billion each (1,000,000 units at Rs 10,000), 100 % tax: nothing may turn into a float
    const e = estimate({ tax_bp: 10000 });
    for (let i = 0; i < 200; i++) item(e, 1_000_000_000, 1_000_000, { position: i + 1 });
    const t = first<Record<string, number | string>>('SELECT *, typeof(total_cents) AS kind FROM v_estimate_total WHERE estimate_id = ?', [e]);
    expect(t?.kind).toBe('integer');
    expect(t?.subtotal_cents).toBe(200 * 1_000_000_000_000);
    expect(t?.tax_cents).toBe(200 * 1_000_000_000_000);
    expect(t?.total_cents).toBe(400 * 1_000_000_000_000);
    // and a single line at the very top of the column limits is exact too
    const big = estimate({ number: 'BIG' });
    item(big, 1_000_000_000, 5_000_000_000);
    expect(total(big)?.subtotal_cents).toBe(5_000_000_000_000_000);
  });

  it('matches the pure estimateSums for many random estimates', () => {
    let seed = 12345;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let n = 0; n < 150; n++) {
      const lines = Array.from({ length: Math.floor(next() * 7) }, () => ({
        qty_milli: 1 + Math.floor(next() * (next() < 0.5 ? 20_000 : 1_000_000_000)),
        rate_cents: Math.floor(next() * (next() < 0.5 ? 100_000 : 100_000_000)),
      }));
      const subtotal = estimateSums(lines, 0, 0).subtotal_cents;
      const discount = Math.floor(next() * (subtotal * 1.5 + 10));
      const taxBp = [0, 0, 1800, 800, 1, 9999, 10000][Math.floor(next() * 7)];
      const e = estimate({ number: `R${n}`, discount_cents: discount, tax_bp: taxBp });
      lines.forEach((l, i) => item(e, l.qty_milli, l.rate_cents, { position: i + 1 }));
      const want = estimateSums(lines, discount, taxBp);
      expect({ n, lines, discount, taxBp, got: total(e) }).toEqual({
        n,
        lines,
        discount,
        taxBp,
        got: { estimate_id: e, item_count: lines.length, ...want, scheduled_bp: 0 },
      });
    }
  });
});

describe('upgrading a version-4 database (migration 5)', () => {
  const stamp = '2026-10-10T04:00:00.000Z';
  const base = (id: string) => ({ id, created_at: stamp, updated_at: stamp, version: 1, device_id: 'dev' });
  const V4_TABLES = [...DATA_TABLES.filter((t) => !t.startsWith('estimate')), 'audit_log', 'settings'] as const;
  const ORDER: Record<string, string> = { audit_log: 'seq', settings: 'key' };
  const VIEWS = ['v_project_cost', 'v_worker_balance', 'v_tool_status', 'v_project_worker_balance'] as const;

  type Reader = { getAllSync: <T>(sql: string) => T[] };
  const dump = (db: Reader) => Object.fromEntries(V4_TABLES.map((t) => [t, db.getAllSync<Record<string, unknown>>(`SELECT * FROM ${t} ORDER BY ${ORDER[t] ?? 'id'}`)]));
  const dumpViews = (db: Reader) => Object.fromEntries(VIEWS.map((v) => [v, db.getAllSync<Record<string, unknown>>(`SELECT * FROM ${v}`)]));

  /** A phone on schema version 4 holding the owner's records. */
  function installVersion4() {
    resetDb();
    const old = openLegacyDb(4);
    insertRow(old, 'projects', { ...base('P'), name: 'School', client: 'Zonal office', contract_cents: 1_850_000_000, status: 'active' });
    insertRow(old, 'projects', { ...base('Q'), name: 'Culvert', status: 'on_hold', deleted_at: '2026-10-11T00:00:00.000Z' });
    insertRow(old, 'workers', { ...base('W'), name: 'Nimal', daily_rate_cents: 350_000, active: 1 });
    insertRow(old, 'project_workers', { ...base('pw'), project_id: 'P', worker_id: 'W', rate_cents: 360_000, active: 1 });
    insertRow(old, 'wage_entries', { ...base('we'), worker_id: 'W', project_id: 'P', day: '2026-10-09', kind: 'work', days: 1, amount_cents: 360_000 });
    insertRow(old, 'expenses', { ...base('ex'), project_id: 'P', day: '2026-10-09', category: 'food', amount_cents: 4_200, method: 'cash' });
    insertRow(old, 'tools', { ...base('drill'), name: 'Drill' });
    insertRow(old, 'tool_movements', { ...base('mv'), tool_id: 'drill', kind: 'issue', project_id: 'P', worker_id: 'W', day: '2026-10-09' });
    insertRow(old, 'site_notes', { ...base('sn'), project_id: 'P', day: '2026-10-09', body: 'Slab poured' });
    insertRow(old, 'attachments', { ...base('at'), owner_table: 'site_notes', owner_id: 'sn', kind: 'photo', file_name: 'a.jpg', mime: 'image/jpeg', size: 10, sha256: 'x' });
    old.runSync("INSERT INTO settings(key, value) VALUES ('language', 'si')");
    old.runSync("INSERT INTO audit_log(at, device_id, table_name, row_id, action, data) VALUES (?, 'dev', 'projects', 'P', 'insert', NULL)", [stamp]);
    expect(old.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(4);
    const out = { rows: dump(old), views: dumpViews(old) };
    old.closeSync();
    return out;
  }

  it('has a newer schema than the data it is tested with (the test is not vacuous)', () => {
    expect(migrations.length).toBeGreaterThan(4);
  });

  it('runs migration 5 and ends at the latest version', () => {
    installVersion4();
    expect(userVersion()).toBe(migrations.length);
    expect(names('table')).toEqual(expect.arrayContaining(['estimates', 'estimate_items', 'estimate_payments']));
  });

  it('loses no row and changes no value in any existing table, the audit log and the settings included', () => {
    const before = installVersion4();
    getDb();
    expect(dump(getDb())).toEqual(before.rows);
    expect(before.rows.projects).toHaveLength(2);
    expect(before.rows.wage_entries).toHaveLength(1);
    expect(before.rows.settings).toHaveLength(1);
    expect(all('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('the figures the owner relies on are the same afterwards', () => {
    const before = installVersion4();
    getDb();
    expect(dumpViews(getDb())).toEqual(before.views);
  });

  it('the new tables start empty and work straight away', () => {
    installVersion4();
    getDb();
    for (const t of ['estimates', 'estimate_items', 'estimate_payments']) expect(first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n).toBe(0);
    expect(all('SELECT * FROM v_estimate_total')).toEqual([]);
    const e = estimate({ project_id: 'P' });
    item(e, 2000, 50_000);
    expect(total(e)).toMatchObject({ subtotal_cents: 100_000, total_cents: 100_000 });
  });

  it('opening the upgraded database again changes nothing', () => {
    const before = installVersion4();
    getDb();
    const schema = () => all<{ type: string; name: string }>("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name");
    const first1 = { schema: schema(), version: userVersion() };
    for (let i = 0; i < 2; i++) {
      closeDb();
      getDb();
    }
    expect({ schema: schema(), version: userVersion() }).toEqual(first1);
    expect(dump(getDb())).toEqual(before.rows);
  });

  it('a version-4 database with no data at all upgrades too', () => {
    resetDb();
    openLegacyDb(4).closeSync();
    expect(userVersion()).toBe(migrations.length);
    expect(all('SELECT * FROM v_estimate_total')).toEqual([]);
  });
});
