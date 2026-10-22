/**
 * Estimates between phones and in backups: collectEstimate, collectProject carrying the linked
 * estimate, import (idempotent, merged per row by version), a project the importing phone does
 * not have, old bundles without the estimate tables, and backup / restore.
 *
 * The harness phones do not know the estimate module, so this file binds its own: a second phone
 * with its own copy of the data layer (and of src/db/estimates.ts) and its own storage.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { File, Paths } from 'expo-file-system';
import JSZip from 'jszip';

import * as dbMod from '@/db';
import * as estMod from '@/db/estimates';
import * as repoMod from '@/db/repo';
import { DATA_TABLES } from '@/db/schema';
import * as autoBackupMod from '@/lib/autoBackup';
import * as backupMod from '@/lib/backup';
import * as bundleMod from '@/lib/bundle';
import { BUNDLE_FORMAT, BUNDLE_VERSION, type Bundle } from '@/lib/bundle';
import { useClock } from '@/test-utils/dataKit';
import { newStorage, runAs, world, type PhoneStorage } from '@/test-utils/world';

jest.setTimeout(120_000);

interface Mods {
  db: typeof dbMod;
  repo: typeof repoMod;
  est: typeof estMod;
  bundle: typeof bundleMod;
  backup: typeof backupMod;
  autoBackup: typeof autoBackupMod;
}

/** Wrap a module's functions so each call runs with `storage` as the active phone (the harness does the same for its phones). */
function bind<T extends object>(storage: PhoneStorage, mod: T): T {
  const wrapped = new Map<string, unknown>();
  return new Proxy(mod, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== 'function' || typeof prop !== 'string' || !/^[a-z_$]/.test(prop)) return value;
      let fn = wrapped.get(prop);
      if (!fn) {
        fn = (...args: unknown[]) => runAs(storage, () => (value as (...a: unknown[]) => unknown).apply(target, args));
        wrapped.set(prop, fn);
      }
      return fn;
    },
  });
}

class EstPhone {
  readonly db: Mods['db'];
  readonly repo: Mods['repo'];
  readonly est: Mods['est'];
  readonly bundle: Mods['bundle'];
  readonly backup: Mods['backup'];
  readonly autoBackup: Mods['autoBackup'];

  constructor(readonly storage: PhoneStorage, mods: Mods) {
    this.db = bind(storage, mods.db);
    this.repo = bind(storage, mods.repo);
    this.est = bind(storage, mods.est);
    this.bundle = bind(storage, mods.bundle);
    this.backup = bind(storage, mods.backup);
    this.autoBackup = bind(storage, mods.autoBackup);
  }

  reset() {
    runAs(this.storage, () => {
      try {
        this.db.closeDb();
      } catch {
        // nothing was open
      }
    });
    this.storage.reset();
  }

  rows<T = Record<string, unknown>>(table: string, where = '1=1', params: string[] = []): T[] {
    return this.db.all<T>(`SELECT * FROM ${table} WHERE ${where} ORDER BY id`, params);
  }

  count(table: string, where = '1=1', params: string[] = []): number {
    return this.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params)?.n ?? 0;
  }
}

/** The phone of this test file (its plain imports). */
function mainEstPhone(): EstPhone {
  return new EstPhone(world().main, { db: dbMod, repo: repoMod, est: estMod, bundle: bundleMod, backup: backupMod, autoBackup: autoBackupMod });
}

/** A second phone: all of the data layer loaded again inside its own module registry. */
function openEstPhone(name: string): EstPhone {
  const storage = newStorage(name);
  let mods: Mods | undefined;
  jest.isolateModules(() => {
    mods = {
      db: require('@/db'),
      repo: require('@/db/repo'),
      est: require('@/db/estimates'),
      bundle: require('@/lib/bundle'),
      backup: require('@/lib/backup'),
      autoBackup: require('@/lib/autoBackup'),
    };
  });
  if (!mods) throw new Error('the second phone failed to load');
  return new EstPhone(storage, mods);
}

type Tables = Bundle['tables'];
const wire = (tables: Tables) => JSON.parse(JSON.stringify(tables)) as Tables;
/** What the PDF / backup hand-off does: the rows travel as text and are applied on the other phone. */
const send = (to: EstPhone, tables: Tables) => to.bundle.applyBundle(wire(tables), new Map());

const ESTIMATE_TABLES = ['estimates', 'estimate_items', 'estimate_payments'] as const;
const dumpEstimates = (p: EstPhone) => Object.fromEntries(ESTIMATE_TABLES.map((t) => [t, p.rows(t)]));
const dumpAll = (p: EstPhone) => Object.fromEntries(DATA_TABLES.map((t) => [t, p.rows(t)]));

let a: EstPhone; // the main phone
let b: EstPhone;
let clock: ReturnType<typeof useClock>;

beforeAll(() => {
  b = openEstPhone('estimates-b');
});
afterAll(() => b.storage.dispose());
beforeEach(() => {
  a = mainEstPhone();
  a.reset();
  b.reset();
  clock = useClock(new Date(2026, 9, 22, 12, 0, 0));
});
afterEach(() => clock.restore());

/** Mr. Perera's boundary wall: two lines (Rs 50,000 and Rs 20,000), 8 % tax and the 30/40/30 schedule. */
function build(p: EstPhone, over: Partial<Parameters<typeof estMod.saveEstimate>[0]> = {}) {
  const id = p.est.saveEstimate({ client_name: 'Mr. Perera', title: 'Boundary wall', location: 'Welimada', tax_bp: 800, ...over });
  const i1 = p.est.saveEstimateItem({ estimate_id: id, description: 'Blockwork', unit: 'm²', qty_milli: 10_000, rate_cents: 500_000 });
  const i2 = p.est.saveEstimateItem({ estimate_id: id, description: 'Plaster', unit: 'm²', qty_milli: 20_000, rate_cents: 100_000 });
  p.est.applyStandardSchedule(id);
  return { id, i1, i2 };
}

describe('collectEstimate', () => {
  it('holds the estimate with its live and deleted lines and stages, and nothing else', () => {
    const { id, i1 } = build(a);
    const other = a.est.saveEstimate({ client_name: 'Someone else', title: 'Another job' });
    a.est.saveEstimateItem({ estimate_id: other, description: 'Other line', qty_milli: 1000, rate_cents: 100 });
    a.repo.saveProject({ name: 'Unrelated project' });
    a.est.removeEstimateItem(i1);

    const t = a.bundle.collectEstimate(id);
    expect(Object.keys(t).sort()).toEqual(['estimate_items', 'estimate_payments', 'estimates']);
    expect(t.estimates?.map((r) => r.id)).toEqual([id]);
    expect(t.estimate_items).toHaveLength(2); // one live, one removed: a deletion has to reach the other phone too
    expect(t.estimate_items?.filter((r) => r.deleted_at)).toHaveLength(1);
    expect(t.estimate_payments).toHaveLength(3);
    for (const r of [...(t.estimate_items ?? []), ...(t.estimate_payments ?? [])]) expect(r.estimate_id).toBe(id);
  });

  it('lists the lines in position order', () => {
    const { id } = build(a);
    expect(a.bundle.collectEstimate(id).estimate_items?.map((r) => r.position)).toEqual([1, 2]);
  });

  it('carries a deleted estimate too, so the deletion travels', () => {
    const { id } = build(a);
    a.est.deleteEstimate(id);
    const t = a.bundle.collectEstimate(id);
    expect(t.estimates?.[0].deleted_at).not.toBeNull();
    expect(t.estimate_items?.every((r) => r.deleted_at)).toBe(true);
    expect(t.estimate_payments?.every((r) => r.deleted_at)).toBe(true);
  });

  it('is three empty lists for an estimate that does not exist', () => {
    expect(a.bundle.collectEstimate('nope')).toEqual({ estimates: [], estimate_items: [], estimate_payments: [] });
  });

  it('collectAll has the three tables too, so a backup carries every estimate', () => {
    const { id } = build(a);
    const all = a.bundle.collectAll();
    expect(all.estimates?.map((r) => r.id)).toEqual([id]);
    expect(all.estimate_items).toHaveLength(2);
    expect(all.estimate_payments).toHaveLength(3);
  });
});

describe('collectProject', () => {
  it('carries the estimate the project was made from, with its lines and stages', () => {
    const { id, i1 } = build(a);
    a.est.removeEstimateItem(i1);
    a.est.setEstimateStatus(id, 'accepted');
    const project = a.est.createProjectFromEstimate(id);
    const unlinked = build(a, { title: 'Not this one' });

    const t = a.bundle.collectProject(project);
    expect(t.estimates?.map((r) => r.id)).toEqual([id]);
    expect(t.estimate_items).toHaveLength(2); // the removed line travels too
    expect(t.estimate_payments).toHaveLength(3);
    expect(t.projects?.map((r) => r.id)).toEqual([project]);
    expect(JSON.stringify(t)).not.toContain(unlinked.id);
  });

  it('has empty estimate lists for a project that did not come from an estimate', () => {
    const p = a.repo.saveProject({ name: 'Plain project' });
    build(a);
    const t = a.bundle.collectProject(p);
    expect(t.estimates).toEqual([]);
    expect(t.estimate_items).toEqual([]);
    expect(t.estimate_payments).toEqual([]);
  });
});

describe('handing an estimate to another phone', () => {
  it('adds the estimate, its lines and its stages, and reports the counts per table', async () => {
    const { id } = build(a);
    const plan = await send(b, a.bundle.collectEstimate(id));
    expect(plan.badFiles).toEqual([]);
    expect(plan.counts).toEqual({ inserted: 6, updated: 0, skipped: 0 });
    expect(plan.perTable).toEqual({
      estimates: { inserted: 1, updated: 0, skipped: 0 },
      estimate_items: { inserted: 2, updated: 0, skipped: 0 },
      estimate_payments: { inserted: 3, updated: 0, skipped: 0 },
    });
    expect(b.count('projects')).toBe(0);
  });

  it('shows the same figures on the other phone', async () => {
    const { id } = build(a);
    a.est.saveEstimate({ id, discount_cents: 100_000, notes: 'Includes gate' });
    await send(b, a.bundle.collectEstimate(id));
    const totals = (p: EstPhone) => p.db.all('SELECT * FROM v_estimate_total');
    expect(totals(b)).toHaveLength(1);
    expect(totals(b)).toEqual(totals(a));
    expect(b.db.first('SELECT total_cents FROM v_estimate_total')).toEqual({ total_cents: Math.round((7_000_000 - 100_000) * 1.08) });
  });

  it('rows arrive byte for byte: ids, versions, timestamps and the sender\'s device id are kept', async () => {
    const { id, i1 } = build(a);
    a.est.saveEstimateItem({ id: i1, estimate_id: id, description: 'Blockwork 6 in', qty_milli: 12_000, rate_cents: 500_000 });
    await send(b, a.bundle.collectEstimate(id));
    expect(dumpEstimates(b)).toEqual(dumpEstimates(a));
    expect(b.db.deviceId()).not.toBe(a.db.deviceId());
    expect(b.db.all('SELECT DISTINCT device_id FROM estimates')).toEqual([{ device_id: a.db.deviceId() }]);
  });

  it('the other phone can open it, load it, edit it and send it on', async () => {
    const { id } = build(a);
    await send(b, a.bundle.collectEstimate(id));
    expect(b.est.loadEstimate(id)).toEqual(a.est.loadEstimate(id));
    b.est.saveEstimateItem({ estimate_id: id, description: 'Gate', unit: 'nos', qty_milli: 1000, rate_cents: 2_500_000 });
    expect(b.est.loadEstimate(id)?.items.map((i) => i.position)).toEqual([1, 2, 3]);
    await send(a, b.bundle.collectEstimate(id));
    expect(a.est.loadEstimate(id)).toEqual(b.est.loadEstimate(id));
    expect(a.est.loadEstimate(id)?.items).toHaveLength(3);
  });

  it('is recorded in the other phone\'s audit log as an import', async () => {
    const { id } = build(a);
    await send(b, a.bundle.collectEstimate(id));
    expect(b.db.all('SELECT action, COUNT(*) AS n FROM audit_log GROUP BY action')).toEqual([{ action: 'import-insert', n: 6 }]);
  });

  it('importing the same estimate twice changes nothing', async () => {
    const { id } = build(a);
    const bundle = a.bundle.collectEstimate(id);
    await send(b, bundle);
    const before = { rows: dumpAll(b), audit: b.count('audit_log'), settings: b.db.all('SELECT * FROM settings ORDER BY key') };
    const again = await send(b, bundle);
    expect(again.counts).toEqual({ inserted: 0, updated: 0, skipped: 6 });
    expect({ rows: dumpAll(b), audit: b.count('audit_log'), settings: b.db.all('SELECT * FROM settings ORDER BY key') }).toEqual(before);
  });

  it('planImport tells the same story as the import, before anything is written', async () => {
    const { id } = build(a);
    const tables = wire(a.bundle.collectEstimate(id));
    const preview = b.bundle.planImport(tables);
    expect(b.count('estimates')).toBe(0);
    const plan = await b.bundle.applyBundle(tables, new Map());
    expect(plan.counts).toEqual(preview.counts);
    expect(plan.perTable).toEqual(preview.perTable);
    expect(b.bundle.planImport(tables).counts).toEqual({ inserted: 0, updated: 0, skipped: 6 });
  });

  it('a later change on the sender updates only the rows that changed', async () => {
    const { id, i1 } = build(a);
    const pay = a.est.loadEstimate(id)?.payments[0].id as string; // the first stage
    await send(b, a.bundle.collectEstimate(id));
    clock.tick(60_000);
    a.est.saveEstimateItem({ id: i1, estimate_id: id, description: 'Blockwork changed', qty_milli: 10_000, rate_cents: 600_000 });
    a.est.removeEstimatePayment(pay); // the other two stages move up
    const plan = await send(b, a.bundle.collectEstimate(id));
    expect(plan.perTable).toEqual({
      estimates: { inserted: 0, updated: 0, skipped: 1 },
      estimate_items: { inserted: 0, updated: 1, skipped: 1 },
      estimate_payments: { inserted: 0, updated: 3, skipped: 0 }, // the removed one and the two renumbered
    });
    expect(b.est.loadEstimate(id)).toEqual(a.est.loadEstimate(id));
    expect(b.est.loadEstimate(id)?.payments.map((p) => p.position)).toEqual([1, 2]);
  });

  it('a line removed on the sender is removed on the other phone', async () => {
    const { id, i1 } = build(a);
    await send(b, a.bundle.collectEstimate(id));
    clock.tick(60_000);
    a.est.removeEstimateItem(i1);
    await send(b, a.bundle.collectEstimate(id));
    expect(b.est.loadEstimate(id)?.items.map((i) => i.description)).toEqual(['Plaster']);
    expect(b.est.loadEstimate(id)?.total.subtotal_cents).toBe(2_000_000);
  });

  it('an estimate deleted on the sender is deleted on the other phone', async () => {
    const { id } = build(a);
    await send(b, a.bundle.collectEstimate(id));
    clock.tick(60_000);
    a.est.deleteEstimate(id);
    await send(b, a.bundle.collectEstimate(id));
    expect(b.est.loadEstimate(id)).toBeNull();
    expect(b.db.all('SELECT * FROM v_estimate_total')).toEqual([]);
  });

  it('describes the estimate in the bundle for the preview, with the same total the sender sees', async () => {
    const { id, i1 } = build(a);
    a.est.saveEstimate({ id, discount_cents: 123_456 });
    a.est.setEstimateStatus(id, 'sent');
    const tables = wire(a.bundle.collectEstimate(id));
    const want = a.est.loadEstimate(id);
    expect(b.bundle.previewEstimates(tables)).toEqual([
      {
        id,
        number: 'EST-2026-001',
        client_name: 'Mr. Perera',
        title: 'Boundary wall',
        status: 'sent',
        issue_day: '2026-10-22',
        item_count: 2,
        total_cents: want?.total.total_cents,
        on_this_phone: false,
      },
    ]);
    await b.bundle.applyBundle(tables, new Map());
    expect(b.bundle.previewEstimates(tables)[0].on_this_phone).toBe(true);

    // removed lines and removed estimates are not part of what the preview shows
    a.est.removeEstimateItem(i1);
    const after = wire(a.bundle.collectEstimate(id));
    expect(b.bundle.previewEstimates(after)[0]).toMatchObject({ item_count: 1, total_cents: a.est.loadEstimate(id)?.total.total_cents });
    a.est.deleteEstimate(id);
    expect(b.bundle.previewEstimates(wire(a.bundle.collectEstimate(id)))).toEqual([]);
  });

  it('a bundle that looks like the PDF carries it (kind estimate) survives the text round trip unchanged', async () => {
    const { id } = build(a);
    const bundle: Bundle = {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      kind: 'estimate',
      exported_at: new Date().toISOString(),
      device_id: a.db.deviceId(),
      estimate_id: id,
      estimate_number: 'EST-2026-001',
      tables: a.bundle.collectEstimate(id),
    };
    const read = JSON.parse(JSON.stringify(bundle)) as Bundle;
    expect(read).toEqual(bundle);
    const plan = await b.bundle.applyBundle(read.tables, new Map());
    expect(plan.counts.inserted).toBe(6);
    expect(read.kind === 'estimate' && b.est.loadEstimate(read.estimate_id as string)).toBeTruthy();
  });
});

describe('an estimate edited on two phones', () => {
  /** Both phones start from the same estimate (version 1 of everything). */
  async function shared() {
    const ids = build(a);
    await send(b, a.bundle.collectEstimate(ids.id));
    expect(dumpEstimates(b)).toEqual(dumpEstimates(a));
    return ids;
  }
  /** Exchange what each phone has now, in both directions, from snapshots taken before either applies the other. */
  async function exchange(id: string) {
    const fromA = a.bundle.collectEstimate(id);
    const fromB = b.bundle.collectEstimate(id);
    await send(b, fromA);
    await send(a, fromB);
  }
  const edit = (p: EstPhone, estimate_id: string, id: string, description: string, rate_cents = 500_000) =>
    p.est.saveEstimateItem({ id, estimate_id, description, unit: 'm²', qty_milli: 10_000, rate_cents });

  it('keeps, row by row, the newer version, and both phones end up identical', async () => {
    const { id, i1, i2 } = await shared();
    clock.tick(60_000);
    a.est.saveEstimate({ id, title: 'Title from A' }); // estimate v2 at +1 min
    edit(a, id, i1, 'Line 1 from A'); // line 1 v2
    clock.tick(60_000);
    b.est.saveEstimate({ id, notes: 'Notes from B' }); // estimate v2 at +2 min: the later one of two equal versions
    edit(b, id, i1, 'Line 1 from B, first');
    clock.tick(1000);
    edit(b, id, i1, 'Line 1 from B, second'); // line 1 v3
    b.est.saveEstimateItem({ id: i2, estimate_id: id, description: 'Line 2 from B', unit: 'm²', qty_milli: 20_000, rate_cents: 100_000 }); // line 2 v2, a still has v1

    await exchange(id);

    expect(dumpEstimates(a)).toEqual(dumpEstimates(b));
    const merged = a.est.loadEstimate(id);
    expect(merged?.estimate).toMatchObject({ notes: 'Notes from B', title: 'Boundary wall', version: 2 }); // B's row, whole: same version, later time
    expect(merged?.items.map((i) => [i.description, i.version])).toEqual([['Line 1 from B, second', 3], ['Line 2 from B', 2]]);
    expect(b.est.loadEstimate(id)).toEqual(merged);
  });

  it('a higher version wins even when the other edit is more recent', async () => {
    const { id, i1 } = await shared();
    clock.tick(60_000);
    edit(b, id, i1, 'B once');
    clock.tick(1000);
    edit(b, id, i1, 'B twice'); // v3 at +1:01
    clock.tick(60_000);
    edit(a, id, i1, 'A once, later'); // v2 at +2:01
    await exchange(id);
    expect(a.rows<{ description: string }>('estimate_items', 'id = ?', [i1])[0].description).toBe('B twice');
    expect(dumpEstimates(a)).toEqual(dumpEstimates(b));
  });

  it('edits to different rows are all kept: nothing is lost when the phones touch different lines', async () => {
    const { id, i1, i2 } = await shared();
    clock.tick(60_000);
    edit(a, id, i1, 'Only A touched this');
    clock.tick(60_000);
    b.est.saveEstimateItem({ id: i2, estimate_id: id, description: 'Only B touched this', unit: 'm²', qty_milli: 20_000, rate_cents: 100_000 });
    const stage = b.est.loadEstimate(id)?.payments[1].id as string; // the 40 % stage
    b.est.saveEstimatePayment({ id: stage, estimate_id: id, label: 'Stage from B', percent_bp: 4000 });
    await exchange(id);
    for (const p of [a, b]) {
      expect(p.est.loadEstimate(id)?.items.map((i) => i.description)).toEqual(['Only A touched this', 'Only B touched this']);
      expect(p.est.loadEstimate(id)?.payments.map((s) => s.label)).toEqual(['Advance', 'Stage from B', 'On completion']);
    }
    expect(dumpEstimates(a)).toEqual(dumpEstimates(b));
  });

  it('a line removed on one phone and the estimate edited on the other: the removal and the edit both stand', async () => {
    const { id, i1 } = await shared();
    clock.tick(60_000);
    a.est.removeEstimateItem(i1);
    clock.tick(60_000);
    b.est.saveEstimate({ id, notes: 'Edited on B' });
    await exchange(id);
    for (const p of [a, b]) {
      expect(p.est.loadEstimate(id)?.items.map((i) => i.description)).toEqual(['Plaster']);
      expect(p.est.loadEstimate(id)?.estimate.notes).toBe('Edited on B');
    }
  });

  it('two lines added on the same position on both phones both stay, in the same order, and the next edit numbers them 1 to n', async () => {
    const { id } = await shared();
    clock.tick(60_000);
    a.est.saveEstimateItem({ estimate_id: id, description: 'Added on A', qty_milli: 1000, rate_cents: 100_000 });
    clock.tick(60_000);
    b.est.saveEstimateItem({ estimate_id: id, description: 'Added on B', qty_milli: 1000, rate_cents: 200_000 });
    await exchange(id);
    const order = (p: EstPhone) => p.est.loadEstimate(id)?.items.map((i) => [i.description, i.position]);
    expect(order(a)).toEqual(order(b));
    expect(order(a)).toEqual([['Blockwork', 1], ['Plaster', 2], ['Added on A', 3], ['Added on B', 3]]); // a tie, but one fixed order
    expect(a.est.loadEstimate(id)?.total.item_count).toBe(4);

    clock.tick(60_000);
    a.est.saveEstimateItem({ estimate_id: id, description: 'Next on A', qty_milli: 1000, rate_cents: 300_000 });
    expect(a.est.loadEstimate(id)?.items.map((i) => i.position)).toEqual([1, 2, 3, 4, 5]);
    await send(b, a.bundle.collectEstimate(id));
    expect(order(b)).toEqual(order(a));
  });

  it('the same estimate edited on both phones gives the same totals on both once merged', async () => {
    const { id, i1 } = await shared();
    clock.tick(60_000);
    edit(a, id, i1, 'Cheaper', 400_000);
    a.est.saveEstimate({ id, tax_bp: 0, discount_cents: 50_000 });
    clock.tick(60_000);
    b.est.saveEstimateItem({ estimate_id: id, description: 'Extra', qty_milli: 3000, rate_cents: 12_345 });
    await exchange(id);
    expect(a.db.first('SELECT * FROM v_estimate_total')).toEqual(b.db.first('SELECT * FROM v_estimate_total'));
  });
});

describe('the project of an imported estimate', () => {
  async function acceptedAndLinked() {
    const { id } = build(a);
    a.est.setEstimateStatus(id, 'accepted');
    const project = a.est.createProjectFromEstimate(id);
    return { id, project };
  }

  it('is not on the importing phone: the estimate still imports and keeps its link, nothing is thrown', async () => {
    const { id, project } = await acceptedAndLinked();
    const plan = await send(b, a.bundle.collectEstimate(id)); // an estimate bundle does not carry the project
    expect(plan.counts.inserted).toBe(6);
    expect(b.count('projects')).toBe(0);
    expect(b.rows<{ project_id: string }>('estimates')[0].project_id).toBe(project);
    expect(b.db.first<{ foreign_keys: number }>('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
  });

  it('the link is kept, so the importing phone is not offered a second project for the same job', async () => {
    const { id } = await acceptedAndLinked();
    await send(b, a.bundle.collectEstimate(id));
    expect(() => b.est.createProjectFromEstimate(id)).toThrow(expect.objectContaining({ key: 'errEstimateLinked' }));
    expect(b.count('projects')).toBe(0);
  });

  it('the importing phone can still work on the estimate while the project is missing', async () => {
    const { id } = await acceptedAndLinked();
    await send(b, a.bundle.collectEstimate(id));
    expect(() => b.est.saveEstimate({ id, notes: 'Edited without the project', title: 'New title' })).not.toThrow();
    expect(() => b.est.setEstimateStatus(id, 'draft')).not.toThrow();
    expect(() => b.est.saveEstimateItem({ estimate_id: id, description: 'More', qty_milli: 1000, rate_cents: 100 })).not.toThrow();
    expect(() => b.est.duplicateEstimate(id)).not.toThrow();
    expect(() => b.est.deleteEstimate(id)).not.toThrow();
  });

  it('resolves by itself when the project arrives later: the estimate is not changed again', async () => {
    const { id, project } = await acceptedAndLinked();
    await send(b, a.bundle.collectEstimate(id));
    const plan = await send(b, a.bundle.collectProject(project));
    expect(plan.perTable?.projects).toEqual({ inserted: 1, updated: 0, skipped: 0 });
    expect(plan.perTable?.estimates).toEqual({ inserted: 0, updated: 0, skipped: 1 });
    expect(b.db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(b.db.first('SELECT contract_cents FROM projects WHERE id = ?', [project])).toEqual({ contract_cents: a.est.loadEstimate(id)?.total.total_cents });
  });

  it('a whole project bundle brings the project and the estimate together, in an order the foreign keys accept', async () => {
    const { id, project } = await acceptedAndLinked();
    const plan = await send(b, a.bundle.collectProject(project));
    expect(plan.perTable?.projects?.inserted).toBe(1);
    expect(plan.perTable?.estimates?.inserted).toBe(1);
    expect(plan.perTable?.estimate_items?.inserted).toBe(2);
    expect(plan.perTable?.estimate_payments?.inserted).toBe(3);
    expect(b.est.loadEstimate(id)).toEqual(a.est.loadEstimate(id));
    expect(b.db.all('PRAGMA foreign_key_check')).toEqual([]);
    // and importing it again changes nothing
    const again = await send(b, a.bundle.collectProject(project));
    expect(again.counts.inserted + again.counts.updated).toBe(0);
  });

  it('every other reference is still enforced: a line of an estimate that is nowhere is refused and nothing is imported', async () => {
    const { id } = build(a);
    const tables = wire(a.bundle.collectEstimate(id));
    const lonely: Tables = { estimate_items: tables.estimate_items, estimate_payments: tables.estimate_payments }; // the estimate itself left out
    const before = dumpAll(b);
    await expect(b.bundle.applyBundle(lonely, new Map())).rejects.toThrow(/FOREIGN KEY constraint failed: estimate_(items|payments) -> estimates/);
    expect(dumpAll(b)).toEqual(before);
    expect(b.db.first<{ foreign_keys: number }>('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
  });
});

describe('bundles and backups from before estimates existed', () => {
  it('an old project bundle (no estimate tables at all) still imports', async () => {
    const p = a.repo.saveProject({ name: 'Old style project' });
    a.repo.saveNote({ project_id: p, day: '2026-10-20', body: 'A note' });
    const old = wire(a.bundle.collectProject(p));
    delete old.estimates;
    delete old.estimate_items;
    delete old.estimate_payments;
    const preview = b.bundle.planImport(old);
    expect(preview.counts).toEqual({ inserted: 2, updated: 0, skipped: 0 });
    expect(Object.keys(preview.perTable).sort()).toEqual(['projects', 'site_notes']);
    const plan = await b.bundle.applyBundle(old, new Map());
    expect(plan.counts.inserted).toBe(2);
    expect(b.count('projects')).toBe(1);
    expect(b.count('estimates')).toBe(0);
    expect(b.bundle.previewEstimates(old)).toEqual([]);
  });

  it('an old bundle imported over an estimate leaves the estimates alone', async () => {
    const { id } = build(b);
    const p = a.repo.saveProject({ name: 'Old style project' });
    const old = wire(a.bundle.collectProject(p));
    delete old.estimates;
    await b.bundle.applyBundle(old, new Map());
    expect(b.est.loadEstimate(id)?.items).toHaveLength(2);
  });

  it('a snapshot taken before the feature (no estimate tables) restores without a word of complaint', async () => {
    const p = a.repo.saveProject({ name: 'Pre-estimate data' });
    const bytes = await a.backup.dataSnapshot();
    const zip = await JSZip.loadAsync(bytes);
    const data = JSON.parse((await zip.file('data.json')?.async('string')) ?? '{}') as Bundle;
    delete data.tables.estimates;
    delete data.tables.estimate_items;
    delete data.tables.estimate_payments;
    const text = new TextEncoder().encode(JSON.stringify(data));
    const manifest = JSON.parse((await zip.file('bluemoon-backup.json')?.async('string')) ?? '{}');
    manifest.data_sha256 = await a.bundle.sha256Hex(text);
    zip.file('data.json', text);
    zip.file('bluemoon-backup.json', JSON.stringify(manifest));
    const old = await zip.generateAsync({ type: 'uint8array' });
    const uri = runAs(b.storage, () => {
      const f = new File(Paths.cache, 'old-snapshot.zip');
      f.create();
      f.writeSync(old);
      return f.uri;
    });
    const res = await b.backup.restorePart(uri);
    expect(res.plan.counts.inserted).toBe(1);
    expect(b.rows('projects').map((r) => (r as { id: string }).id)).toEqual([p]);
  });
});

describe('backup and restore', () => {
  /** A phone's records in a snapshot file on the other phone, ready for restorePart. */
  async function snapshotTo(from: EstPhone, to: EstPhone): Promise<string> {
    const bytes = await from.backup.dataSnapshot();
    return runAs(to.storage, () => {
      const f = new File(Paths.cache, 'snapshot.zip');
      if (f.exists) f.delete();
      f.create();
      f.writeSync(bytes);
      return f.uri;
    });
  }

  it('a snapshot restored on a new phone brings back every estimate, line and stage exactly', async () => {
    const first = build(a);
    a.est.setEstimateStatus(first.id, 'accepted');
    const project = a.est.createProjectFromEstimate(first.id);
    const second = build(a, { title: 'Second', client_name: 'වැලිමඩ ගනුදෙනුකරු' });
    a.est.removeEstimateItem(second.i1);
    const third = build(a, { title: 'Deleted one' });
    a.est.deleteEstimate(third.id);

    const res = await b.backup.restorePart(await snapshotTo(a, b));
    expect(res.plan.perTable.estimates).toEqual({ inserted: 3, updated: 0, skipped: 0 });
    expect(dumpAll(b)).toEqual(dumpAll(a));
    expect(b.est.loadEstimate(first.id)).toEqual(a.est.loadEstimate(first.id));
    expect(b.est.loadEstimate(second.id)).toEqual(a.est.loadEstimate(second.id));
    expect(b.est.loadEstimate(third.id)).toBeNull(); // a deleted estimate stays deleted
    expect(b.rows<{ project_id: string }>('estimates', 'id = ?', [first.id])[0].project_id).toBe(project);
    expect(b.db.all('SELECT * FROM v_estimate_total ORDER BY estimate_id')).toEqual(a.db.all('SELECT * FROM v_estimate_total ORDER BY estimate_id'));
  });

  it('restoring over the same phone changes nothing, and fills in only what is missing', async () => {
    const x = build(a);
    const y = build(a, { title: 'Y' });
    const uri = await snapshotTo(a, a);
    const same = await a.backup.restorePart(uri);
    expect(same.plan.counts.inserted + same.plan.counts.updated).toBe(0);
    // an estimate lost from the phone comes back, the other one is untouched
    a.db.getDb().execSync(`DELETE FROM estimate_items WHERE estimate_id = '${x.id}'; DELETE FROM estimate_payments WHERE estimate_id = '${x.id}'; DELETE FROM estimates WHERE id = '${x.id}'`);
    const keep = a.est.loadEstimate(y.id);
    const res = await a.backup.restorePart(uri);
    expect(res.plan.perTable.estimates).toEqual({ inserted: 1, updated: 0, skipped: 1 });
    expect(a.est.loadEstimate(x.id)?.items).toHaveLength(2);
    expect(a.est.loadEstimate(y.id)).toEqual(keep);
  });

  it('the automatic daily snapshot carries estimates, and restoring the newest one after a reset brings them back', async () => {
    const x = build(a);
    const before = dumpEstimates(a);
    expect(await a.autoBackup.runAutoBackupIfDue(true)).toBe('done');
    // the records are lost but the backups folder is still there (what a corrupt database being set aside looks like)
    const d = a.db.getDb();
    d.execSync('PRAGMA foreign_keys = OFF');
    for (const t of [...DATA_TABLES].reverse()) d.execSync(`DELETE FROM ${t}`);
    d.execSync('PRAGMA foreign_keys = ON');
    a.db.closeDb();
    expect(a.count('estimates')).toBe(0);
    expect(await a.autoBackup.restoreNewestAutoBackup()).toBe(true);
    expect(dumpEstimates(a)).toEqual(before);
    expect(a.est.loadEstimate(x.id)?.items).toHaveLength(2);
  });
});
