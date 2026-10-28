/**
 * Backups: the records-only snapshot (dataSnapshot + verifyBackup), the full backup with photos
 * (makeBackup, in parts), and restorePart, which merges and never deletes.
 */
import { File, Paths } from 'expo-file-system';
import JSZip from 'jszip';

import { tx } from '@/db';
import { DATA_TABLES } from '@/db/schema';
import type { Attachment } from '@/db/types';
import { readErrorLog } from '@/lib/errors';
import { addFile, addPhotos } from '@/lib/files';
import { mainPhone, openSecondPhone, queuePhotos, resetDb, seedDemo, type Phone } from '@/test-utils';
import { localStamp } from '@/lib/backup';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(180_000);

const MANIFEST = 'bluemoon-backup.json';

let a: Phone; // the phone being backed up
let b: Phone; // a new phone, or the same phone after a reset
let clock: ReturnType<typeof useClock>;

beforeAll(() => {
  b = openSecondPhone();
});
afterAll(() => b.dispose());
beforeEach(() => {
  resetDb();
  b.resetDb();
  a = mainPhone();
  clock = useClock('2026-10-22T06:30:45.000Z');
});
afterEach(() => clock.restore());

function dump(phone: Phone): Record<string, unknown[]> {
  return Object.fromEntries(DATA_TABLES.map((t) => [t, phone.db.all(`SELECT * FROM ${t} ORDER BY id`)]));
}
const count = (phone: Phone, table: string, where = '1=1') => phone.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)?.n ?? 0;

/** Put bytes into a phone's cache folder, like a file the user picked from Drive. */
function place(phone: Phone, name: string, bytes: Uint8Array): string {
  return phone.run(() => {
    const f = new File(Paths.cache, name);
    f.create();
    f.writeSync(bytes);
    return f.uri;
  });
}

async function unzip(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const manifest = JSON.parse((await zip.file(MANIFEST)?.async('string')) ?? '{}');
  const data = await zip.file('data.json')?.async('uint8array');
  return { zip, manifest, data };
}

/** The same zip with data.json replaced, keeping the manifest (and so its SHA-256) as it was. */
async function withData(bytes: Uint8Array, newData: string | Uint8Array): Promise<Uint8Array> {
  const { zip } = await unzip(bytes);
  zip.file('data.json', newData);
  return zip.generateAsync({ type: 'uint8array' });
}

async function withManifest(bytes: Uint8Array, patch: Record<string, unknown> | null): Promise<Uint8Array> {
  const { zip, manifest } = await unzip(bytes);
  if (patch === null) zip.remove(MANIFEST);
  else zip.file(MANIFEST, JSON.stringify({ ...manifest, ...patch }));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('dataSnapshot and verifyBackup', () => {
  it('a snapshot is a zip with a manifest and every record, and it verifies', async () => {
    seedDemo();
    const bytes = await a.backup.dataSnapshot();
    expect(await a.backup.verifyBackup(bytes)).toBe(true);

    const { manifest, data } = await unzip(bytes);
    expect(manifest).toMatchObject({ format: 'bluemoon-backup', version: 2, part: 1, parts: 1, created_at: '2026-10-22T06:30:45.000Z', device_id: a.db.deviceId() });
    expect(manifest.data_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await a.bundle.sha256Hex(data as Uint8Array)).toBe(manifest.data_sha256);

    const bundle = JSON.parse(new TextDecoder().decode(data));
    expect(bundle).toMatchObject({ format: 'bluemoon-bundle', kind: 'backup', exported_at: '2026-10-22T06:30:45.000Z' });
    expect(Object.keys(bundle.tables).sort()).toEqual([...DATA_TABLES].sort());
    const rows = (t: string) => bundle.tables[t].length;
    expect({ projects: rows('projects'), workers: rows('workers'), expenses: rows('expenses'), tools: rows('tools'), project_workers: rows('project_workers'), site_notes: rows('site_notes') }).toEqual({
      projects: 3,
      workers: 6,
      expenses: 12,
      tools: 7,
      project_workers: 7,
      site_notes: 3,
    });
  });

  it('is small: a demo database compresses to a few KB', async () => {
    seedDemo();
    const raw = JSON.stringify(a.bundle.collectAll()).length;
    const bytes = await a.backup.dataSnapshot();
    expect(bytes.byteLength).toBeLessThan(raw / 3);
  });

  it('also carries deleted records, so a deletion is not undone by a restore', async () => {
    seedDemo();
    const e = a.db.first<{ id: string }>('SELECT id FROM expenses LIMIT 1')?.id as string;
    a.repo.deleteRecord('expenses', e);
    const { data } = await unzip(await a.backup.dataSnapshot());
    const expenses = JSON.parse(new TextDecoder().decode(data)).tables.expenses as { id: string; deleted_at: string | null }[];
    expect(expenses).toHaveLength(12);
    expect(expenses.find((x) => x.id === e)?.deleted_at).not.toBeNull();
  });

  it('keeps Sinhala, Tamil and emoji exactly', async () => {
    const names = ['වැලිමඩ ප්‍රාථමික පාසල', 'பதுளை கால்வாய் பழுது', 'Site 🚧 café — Ñandú'];
    for (const name of names) a.repo.saveProject({ name, client: name.toUpperCase(), notes: `${name}\n${name}` });
    const path = place(b, 'snap.zip', await a.backup.dataSnapshot());
    await b.backup.restorePart(path);
    expect(b.db.all<{ name: string }>('SELECT name FROM projects ORDER BY name').map((r) => r.name).sort()).toEqual([...names].sort());
    expect(dump(b)).toEqual(dump(a));
  });

  describe('verifyBackup refuses anything that is not an intact snapshot', () => {
    let good: Uint8Array;
    beforeEach(async () => {
      seedDemo();
      good = await a.backup.dataSnapshot();
    });

    it('empty and random bytes', async () => {
      expect(await a.backup.verifyBackup(new Uint8Array(0))).toBe(false);
      expect(await a.backup.verifyBackup(new Uint8Array(500).map((_, i) => (i * 37) % 251))).toBe(false);
    });

    it('a zip cut short', async () => {
      expect(await a.backup.verifyBackup(good.slice(0, Math.floor(good.length / 2)))).toBe(false);
    });

    it('records changed after the manifest was written', async () => {
      const { data } = await unzip(good);
      const text = new TextDecoder().decode(data).replace('Welimada Primary School Building', 'Welimada Primary School Buildinh');
      expect(await a.backup.verifyBackup(await withData(good, text))).toBe(false);
    });

    it('a manifest hash that does not belong to the records', async () => {
      expect(await a.backup.verifyBackup(await withManifest(good, { data_sha256: '0'.repeat(64) }))).toBe(false);
    });

    it('no manifest, or no records', async () => {
      expect(await a.backup.verifyBackup(await withManifest(good, null))).toBe(false);
      const { zip } = await unzip(good);
      zip.remove('data.json');
      expect(await a.backup.verifyBackup(await zip.generateAsync({ type: 'uint8array' }))).toBe(false);
    });

    it('and accepts the untouched original after all that', async () => {
      expect(await a.backup.verifyBackup(good)).toBe(true);
    });
  });
});

describe('restorePart', () => {
  it('brings a whole database back onto a new phone, identical row for row', async () => {
    seedDemo();
    const path = place(b, 'snap.zip', await a.backup.dataSnapshot());
    const res = await b.backup.restorePart(path);
    expect(res).toMatchObject({ part: 1, parts: 1, photos: 0 });
    expect(res.plan.counts).toEqual({ inserted: 86, updated: 0, skipped: 0 }); // the 70 records of the site data and the 16 of the two demo estimates
    expect(dump(b)).toEqual(dump(a));
    expect(b.db.all('SELECT * FROM v_project_cost ORDER BY project_id')).toEqual(a.db.all('SELECT * FROM v_project_cost ORDER BY project_id'));
    expect(b.db.all('SELECT * FROM v_worker_balance ORDER BY worker_id')).toEqual(a.db.all('SELECT * FROM v_worker_balance ORDER BY worker_id'));
    expect(b.db.all('SELECT * FROM v_tool_status ORDER BY tool_id')).toEqual(a.db.all('SELECT * FROM v_tool_status ORDER BY tool_id'));
  });

  it('restoring the same backup again changes nothing', async () => {
    seedDemo();
    const path = place(b, 'snap.zip', await a.backup.dataSnapshot());
    await b.backup.restorePart(path);
    const state = dump(b);
    const again = await b.backup.restorePart(path);
    expect(again.plan.counts).toEqual({ inserted: 0, updated: 0, skipped: 86 });
    expect(dump(b)).toEqual(state);
  });

  it('a version-1 backup (made before tools had counts) still restores: every tool and movement is one piece', async () => {
    seedDemo();
    const snapshot = await a.backup.dataSnapshot();
    const { data } = await unzip(snapshot);
    const bundle = JSON.parse(new TextDecoder().decode(data));
    for (const t of bundle.tables.tools) for (const col of ['quantity_milli', 'unit', 'is_material']) delete t[col];
    for (const m of bundle.tables.tool_movements) delete m.qty_milli;
    const text = new TextEncoder().encode(JSON.stringify(bundle));
    const old = await withManifest(await withData(snapshot, text), { version: 1, data_sha256: await a.bundle.sha256Hex(text) });

    const res = await b.backup.restorePart(place(b, 'v1.zip', old));

    expect(res.plan.counts).toEqual({ inserted: 86, updated: 0, skipped: 0 });
    expect(b.db.all('SELECT DISTINCT quantity_milli, unit, is_material FROM tools')).toEqual([{ quantity_milli: 1000, unit: null, is_material: 0 }]);
    expect(b.db.all('SELECT DISTINCT qty_milli FROM tool_movements')).toEqual([{ qty_milli: 1000 }]);
    // one piece each: the drill, the mixer and the cement are held (the ladder and the wheelbarrow went out and came back)
    expect(b.db.all('SELECT t.name, h.qty_milli FROM v_tool_holders h JOIN tools t ON t.id = h.tool_id ORDER BY t.name')).toEqual([
      { name: 'Cement', qty_milli: 1000 },
      { name: 'Concrete mixer', qty_milli: 1000 },
      { name: 'Hilti drill', qty_milli: 1000 },
    ]);
  });

  it('a backup of this version says version 2, and a file one version newer than the app is refused', async () => {
    seedDemo();
    const snapshot = await a.backup.dataSnapshot();
    expect((await unzip(snapshot)).manifest.version).toBe(a.bundle.BUNDLE_VERSION);
    expect(a.bundle.BUNDLE_VERSION).toBe(2);
    await expect(b.backup.restorePart(place(b, 'next.zip', await withManifest(snapshot, { version: a.bundle.BUNDLE_VERSION + 1 })))).rejects.toThrow('newer');
    expect(count(b, 'tools')).toBe(0);
  });

  describe('merges, and never deletes', () => {
    it('keeps what only the receiving phone has', async () => {
      seedDemo();
      const path = place(b, 'snap.zip', await a.backup.dataSnapshot());
      const mine = b.repo.saveProject({ name: 'Only on this phone' });
      b.repo.saveExpense({ project_id: mine, day: '2026-10-22', category: 'fuel', amount_cents: 9_900, method: 'cash' });
      const worker = b.repo.saveWorker({ name: 'Only here', daily_rate_cents: 1 });

      await b.backup.restorePart(path);

      expect(count(b, 'projects')).toBe(4);
      expect(b.db.first('SELECT expense_cents FROM v_project_cost WHERE project_id = ?', [mine])).toEqual({ expense_cents: 9_900 });
      expect(b.db.first('SELECT name FROM workers WHERE id = ?', [worker])).toEqual({ name: 'Only here' });
    });

    it('keeps a newer edit made on this phone, and fills in the older rows', async () => {
      seedDemo();
      const path = place(b, 'snap.zip', await a.backup.dataSnapshot());
      await b.backup.restorePart(path); // b now equals a
      clock.tick(60_000);
      const [e1, e2] = b.db.all<{ id: string }>('SELECT id FROM expenses ORDER BY id LIMIT 2').map((r) => r.id);
      const e1row = b.db.first<{ project_id: string; day: string }>('SELECT project_id, day FROM expenses WHERE id = ?', [e1]) as { project_id: string; day: string };
      b.repo.saveExpense({ id: e1, project_id: e1row.project_id, day: e1row.day, category: 'other', amount_cents: 1_234, method: 'cash' }); // v2 on b
      b.repo.deleteRecord('expenses', e2); // v2, deleted, on b

      await b.backup.restorePart(path); // the old backup (v1) comes back

      expect(b.db.first('SELECT amount_cents, version FROM expenses WHERE id = ?', [e1])).toEqual({ amount_cents: 1_234, version: 2 });
      expect(b.db.first('SELECT deleted_at IS NOT NULL AS gone, version FROM expenses WHERE id = ?', [e2])).toEqual({ gone: 1, version: 2 });
    });

    it('a deletion in a newer backup reaches the phone; the row stays as a deleted row', async () => {
      seedDemo();
      const early = place(b, 'early.zip', await a.backup.dataSnapshot());
      await b.backup.restorePart(early);
      clock.tick(60_000);
      const e = a.db.first<{ id: string }>('SELECT id FROM expenses LIMIT 1')?.id as string;
      a.repo.deleteRecord('expenses', e);
      const late = place(b, 'late.zip', await a.backup.dataSnapshot());

      const res = await b.backup.restorePart(late);

      expect(res.plan.counts).toEqual({ inserted: 0, updated: 1, skipped: 85 });
      expect(b.db.first('SELECT deleted_at IS NOT NULL AS gone FROM expenses WHERE id = ?', [e])).toEqual({ gone: 1 });
      expect(count(b, 'expenses')).toBe(12);
    });

    it('an older backup after a newer one cannot undo the newer data (in any order)', async () => {
      seedDemo();
      const oldBytes = await a.backup.dataSnapshot();
      clock.tick(60_000);
      a.repo.saveProject({ id: a.db.first<{ id: string }>('SELECT id FROM projects LIMIT 1')?.id as string, name: 'Renamed later' });
      const freshBytes = await a.backup.dataSnapshot();

      let old = place(b, 'old.zip', oldBytes);
      let fresh = place(b, 'new.zip', freshBytes);
      await b.backup.restorePart(fresh);
      await b.backup.restorePart(old);
      expect(dump(b)).toEqual(dump(a));

      b.resetDb(); // a new phone again (this also empties its cache folder)
      old = place(b, 'old.zip', oldBytes);
      fresh = place(b, 'new.zip', freshBytes);
      await b.backup.restorePart(old);
      await b.backup.restorePart(fresh);
      expect(dump(b)).toEqual(dump(a));
    });
  });

  describe('refuses a backup it cannot trust, and writes nothing', () => {
    let good: Uint8Array;
    beforeEach(async () => {
      seedDemo();
      good = await a.backup.dataSnapshot();
    });
    const untouched = () => {
      for (const t of DATA_TABLES) expect({ table: t, rows: count(b, t) }).toEqual({ table: t, rows: 0 });
    };

    it('records that were changed after the backup was made: "damaged"', async () => {
      const { data } = await unzip(good);
      const bad = await withData(good, new TextDecoder().decode(data).replace('"contract_cents":1850000000', '"contract_cents":1850000001'));
      await expect(b.backup.restorePart(place(b, 'bad.zip', bad))).rejects.toThrow('damaged');
      untouched();
    });

    it('a zip without its records: "damaged"', async () => {
      const { zip } = await unzip(good);
      zip.remove('data.json');
      await expect(b.backup.restorePart(place(b, 'bad.zip', await zip.generateAsync({ type: 'uint8array' })))).rejects.toThrow('damaged');
      untouched();
    });

    it('a file that is not a zip: "not-zip"', async () => {
      await expect(b.backup.restorePart(place(b, 'bad.zip', new TextEncoder().encode('this is a photo, not a backup')))).rejects.toThrow('not-zip');
      untouched();
    });

    it('a zip that is not a Bluemoon backup: "not-backup"', async () => {
      const zip = new JSZip();
      zip.file('holiday.txt', 'hello');
      await expect(b.backup.restorePart(place(b, 'other.zip', await zip.generateAsync({ type: 'uint8array' })))).rejects.toThrow('not-backup');
      await expect(b.backup.restorePart(place(b, 'nomanifest.zip', await withManifest(good, null)))).rejects.toThrow('not-backup');
      await expect(b.backup.restorePart(place(b, 'wrongformat.zip', await withManifest(good, { format: 'something-else' })))).rejects.toThrow('not-backup');
      untouched();
    });

    it('a backup from a newer version of the app: "newer"', async () => {
      await expect(b.backup.restorePart(place(b, 'future.zip', await withManifest(good, { version: 99 })))).rejects.toThrow('newer');
      untouched();
    });

    it('records with a matching hash but broken contents write nothing', async () => {
      const broken = new TextEncoder().encode('{"tables": [oops');
      const hash = await a.bundle.sha256Hex(broken);
      const bytes = await withManifest(await withData(good, broken), { data_sha256: hash });
      await expect(b.backup.restorePart(place(b, 'broken.zip', bytes))).rejects.toThrow();
      untouched();
    });

    it('one row the database refuses rolls the whole restore back', async () => {
      const { data } = await unzip(good);
      const bundle = JSON.parse(new TextDecoder().decode(data));
      bundle.tables.site_notes[0].body = '  ';
      const text = new TextEncoder().encode(JSON.stringify(bundle));
      const bytes = await withManifest(await withData(good, text), { data_sha256: await a.bundle.sha256Hex(text) });
      await expect(b.backup.restorePart(place(b, 'refused.zip', bytes))).rejects.toThrow(/constraint/i);
      untouched();
    });
  });
});

describe('makeBackup (the full backup with photos)', () => {
  async function dataWithPhotos() {
    seedDemo();
    const school = a.db.first<{ id: string }>("SELECT id FROM projects WHERE name LIKE 'Welimada%'")?.id as string;
    const expense = a.db.first<{ id: string }>('SELECT id FROM expenses WHERE project_id = ? LIMIT 1', [school])?.id as string;
    queuePhotos(2);
    await addPhotos('expenses', expense, 'gallery');
    queuePhotos(1);
    await addPhotos('projects', school, 'gallery');
    return a.db.all<Attachment>('SELECT * FROM attachments ORDER BY created_at, id');
  }

  it('makes one zip, named by the minute, holding the records and every photo', async () => {
    const atts = await dataWithPhotos();
    const parts = await a.backup.makeBackup();
    expect(parts).toHaveLength(1);
    // named in the phone's own time, not UTC
    expect(parts[0].name).toBe(`Bluemoon-backup-${localStamp(new Date('2026-10-22T06:30:45.000Z'))}.zip`);
    expect(parts[0].uri.startsWith(Paths.cache.uri)).toBe(true);

    const { zip, manifest } = await unzip(parts[0].bytesSync());
    expect(manifest).toMatchObject({ part: 1, parts: 1 });
    expect(Object.keys(zip.files).filter((n) => n.startsWith('attachments/') && !n.endsWith('/')).sort()).toEqual(atts.map((x) => `attachments/${x.file_name}`).sort());
    expect(await a.backup.verifyBackup(parts[0].bytesSync())).toBe(true);
  });

  it('restores on a new phone: every row and every photo, each photo with its own SHA-256', async () => {
    const atts = await dataWithPhotos();
    const [part] = await a.backup.makeBackup();
    const res = await b.backup.restorePart(part.uri);
    expect(res.photos).toBe(3);
    expect(res.plan.badFiles).toEqual([]);
    expect(dump(b)).toEqual(dump(a));
    for (const att of atts) {
      const f = b.files.fileFor(att);
      expect(f.exists).toBe(true);
      expect(await b.files.sha256(f)).toBe(att.sha256);
    }
  });

  it('reports progress per part, and writing it twice in a minute replaces the earlier file', async () => {
    await dataWithPhotos();
    const seen: [number, number][] = [];
    const first = await a.backup.makeBackup((p, n) => seen.push([p, n]));
    const second = await a.backup.makeBackup();
    expect(seen).toEqual([[1, 1]]);
    expect(second[0].uri).toBe(first[0].uri);
    expect(a.run(() => Paths.cache.list().filter((e) => e.name.startsWith('Bluemoon-backup-')))).toHaveLength(1);
  });

  it('one damaged photo is left out and logged; it does not spoil the backup or the other photos', async () => {
    const atts = await dataWithPhotos();
    const f = a.files.fileFor(atts[1]);
    const bytes = f.bytesSync().slice();
    bytes[Math.floor(bytes.length / 2)] ^= 0xff; // same size, wrong content
    f.writeSync(bytes);

    const mute = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const [part] = await a.backup.makeBackup();
    mute.mockRestore();

    const { zip } = await unzip(part.bytesSync());
    const inZip = Object.keys(zip.files).filter((n) => n.startsWith('attachments/') && !n.endsWith('/'));
    expect(inZip.sort()).toEqual([atts[0], atts[2]].map((x) => `attachments/${x.file_name}`).sort());
    expect(readErrorLog()).toContain('attachment does not match its hash');
    expect(readErrorLog()).toContain(atts[1].file_name);
    expect(await a.backup.verifyBackup(part.bytesSync())).toBe(true);

    const res = await b.backup.restorePart(part.uri);
    expect(res.plan.badFiles).toEqual([]);
    expect(count(b, 'attachments')).toBe(3); // the row is there; its file is not
    expect(b.files.fileFor(atts[1]).exists).toBe(false);
    expect(b.files.fileFor(atts[0]).exists).toBe(true);
  });

  it('a photo that is missing from the phone is left out without failing the backup', async () => {
    const atts = await dataWithPhotos();
    a.files.fileFor(atts[0]).delete();
    const [part] = await a.backup.makeBackup();
    const { zip } = await unzip(part.bytesSync());
    expect(Object.keys(zip.files).some((n) => n.endsWith(atts[0].file_name))).toBe(false);
    expect(count(a, 'attachments')).toBe(3);
  });

  it('deleted photos are not packed', async () => {
    const atts = await dataWithPhotos();
    a.files.removeAttachment(atts[2].id);
    const [part] = await a.backup.makeBackup();
    const { zip } = await unzip(part.bytesSync());
    expect(Object.keys(zip.files).filter((n) => n.startsWith('attachments/') && !n.endsWith('/'))).toHaveLength(2);
  });

  it('splits into parts of at most about 40 MB; each part restores on its own, in any order', async () => {
    seedDemo();
    const school = a.db.first<{ id: string }>("SELECT id FROM projects WHERE name LIKE 'Welimada%'")?.id as string;
    const MB = 1024 * 1024;
    const made: string[] = [];
    for (const fill of [11, 22, 33]) {
      const src = new File(Paths.cache, `big-${fill}.bin`);
      src.create();
      src.writeSync(new Uint8Array(15 * MB).fill(fill));
      made.push(await addFile('projects', school, src.uri, 'application/octet-stream'));
      src.delete();
    }

    const parts = await a.backup.makeBackup();
    const stamp = localStamp(new Date('2026-10-22T06:30:45.000Z'));
    expect(parts.map((p) => p.name)).toEqual([`Bluemoon-backup-${stamp}-part1of2.zip`, `Bluemoon-backup-${stamp}-part2of2.zip`]);
    const m = await Promise.all(parts.map(async (p) => (await unzip(p.bytesSync())).manifest));
    expect(m.map((x) => [x.part, x.parts])).toEqual([[1, 2], [2, 2]]);
    expect(m[0].data_sha256).toBe(m[1].data_sha256); // the same records ride in every part
    for (const p of parts) expect(p.size).toBeLessThan(41 * MB);

    // restore the second part first
    const r2 = await b.backup.restorePart(parts[1].uri);
    expect(r2).toMatchObject({ part: 2, parts: 2, photos: 1 });
    expect(count(b, 'attachments')).toBe(3); // every row is already there
    const r1 = await b.backup.restorePart(parts[0].uri);
    expect(r1).toMatchObject({ part: 1, parts: 2, photos: 2 });

    const rows = b.db.all<Attachment>("SELECT * FROM attachments WHERE kind = 'file'");
    expect(rows).toHaveLength(3);
    for (const att of rows) {
      const f = b.files.fileFor(att);
      expect(f.size).toBe(15 * MB);
      expect(await b.files.sha256(f)).toBe(att.sha256);
    }
    expect(made).toHaveLength(3);
    expect(dump(b)).toEqual(dump(a));
  });
});

describe('markBackedUp', () => {
  it('records when the last full backup was shared', () => {
    clock.set('2026-10-22T09:15:00.000Z');
    a.backup.markBackedUp();
    expect(a.db.getSetting('last_backup_at')).toBe('2026-10-22T09:15:00.000Z');
  });
});

describe('a year of records', () => {
  it('snapshots and restores a larger database exactly', async () => {
    seedDemo();
    const school = a.db.first<{ id: string }>("SELECT id FROM projects WHERE name LIKE 'Welimada%'")?.id as string;
    const nimal = a.db.first<{ id: string }>("SELECT id FROM workers WHERE name LIKE 'Nimal%'")?.id as string;
    tx(() => {
      for (let i = 0; i < 600; i++) {
        const day = new Date(Date.UTC(2026, 0, 1 + (i % 300))).toISOString().slice(0, 10);
        a.repo.saveExpense({ project_id: school, day, category: 'materials', amount_cents: 10_000 + i, method: 'cash', note: `Delivery ${i}` });
        a.repo.recordWorkDay({ project_id: school, worker_id: nimal, day, days: 1, amount_cents: 350_000 + i });
      }
    });
    const bytes = await a.backup.dataSnapshot();
    expect(await a.backup.verifyBackup(bytes)).toBe(true);
    const res = await b.backup.restorePart(place(b, 'year.zip', bytes));
    expect(res.plan.counts.skipped + res.plan.counts.updated).toBe(0);
    expect(dump(b)).toEqual(dump(a));
    expect(b.db.first('SELECT expense_cents, labour_cents FROM v_project_cost WHERE project_id = ?', [school])).toEqual(
      a.db.first('SELECT expense_cents, labour_cents FROM v_project_cost WHERE project_id = ?', [school]),
    );
  });
});
