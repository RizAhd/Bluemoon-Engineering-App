/**
 * A realistic database as the PREVIOUS app version (schema version 1) left it on a phone,
 * with hand-computed expectations. Used by the migration tests.
 *
 * Money is whole cents (Rs 3,500.00 = 350000).
 */
import type * as SQLite from 'expo-sqlite';

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const L = {
  device: 'old-phone-device-id',
  school: uid(1),
  culvert: uid(2),
  drain: uid(3),
  cancelled: uid(4), // soft-deleted project
  nimal: uid(11),
  sunil: uid(12),
  kamal: uid(13), // inactive
  retired: uid(14), // soft-deleted worker
  drill: uid(31),
  mixer: uid(32),
  ladder: uid(33),
  survey: uid(34), // never moved
} as const;

const T0 = '2026-10-01T04:30:00.000Z';

function base(id: string, n: number, extra: { version?: number; deleted?: boolean } = {}) {
  // n makes created_at unique and ordered, like rows written one after another
  const at = new Date(Date.parse(T0) + n * 60_000).toISOString();
  return {
    id,
    created_at: at,
    updated_at: at,
    deleted_at: extra.deleted ? new Date(Date.parse(at) + 3_600_000).toISOString() : null,
    version: extra.version ?? 1,
    device_id: 'old-phone-device-id',
  };
}

export function insertRow(db: SQLite.SQLiteDatabase, table: string, row: Record<string, string | number | null>) {
  const cols = Object.keys(row);
  db.runSync(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c]));
}

let seq = 0;
const next = () => ++seq;

/** Fill a version-1 database. Returns nothing: the ids are in `L`. */
export function fillVersion1(db: SQLite.SQLiteDatabase): void {
  seq = 0;
  const ins = (table: string, row: Record<string, string | number | null>) => insertRow(db, table, row);

  // ---- projects
  ins('projects', {
    ...base(L.school, next(), { version: 4 }),
    name: 'Welimada Primary School Building',
    client: 'Zonal Education Office, Welimada',
    location: 'Welimada',
    contract_cents: 1_850_000_000,
    start_date: '2026-08-01',
    end_date: null,
    status: 'active',
    notes: 'Two storey, 6 classrooms',
  });
  ins('projects', {
    ...base(L.culvert, next()),
    name: 'Badulla Culvert Repair',
    client: 'RDA Badulla',
    location: 'Badulla',
    contract_cents: 420_000_000,
    start_date: '2026-09-15',
    end_date: null,
    status: 'active',
    notes: null,
  });
  ins('projects', {
    ...base(L.drain, next(), { version: 3 }),
    name: 'Bandarawela Drain Renovation',
    client: 'Bandarawela UC',
    location: 'Bandarawela',
    contract_cents: 275_000_000,
    start_date: '2026-05-01',
    end_date: '2026-08-20',
    status: 'completed',
    notes: null,
  });
  ins('projects', { ...base(L.cancelled, next(), { deleted: true, version: 2 }), name: 'Cancelled quotation', client: null, location: null, contract_cents: null, start_date: null, end_date: null, status: 'on_hold', notes: null });

  // ---- workers
  ins('workers', { ...base(L.nimal, next()), name: 'Nimal Perera', phone: '0771234567', trade: 'Mason', daily_rate_cents: 350_000, active: 1 });
  ins('workers', { ...base(L.sunil, next()), name: 'Sunil Fernando', phone: null, trade: 'Carpenter', daily_rate_cents: 380_000, active: 1 });
  ins('workers', { ...base(L.kamal, next()), name: 'Kamal Silva', phone: '0712345678', trade: 'Helper', daily_rate_cents: 220_000, active: 0 });
  ins('workers', { ...base(L.retired, next(), { deleted: true }), name: 'Retired Worker', phone: null, trade: null, daily_rate_cents: 100_000, active: 0 });

  // ---- wages: version 1 let a wage entry have NO project
  const wage = (n: number, o: { worker: string; project: string | null; day: string; kind: 'work' | 'advance' | 'payment'; days?: number | null; cents: number; note?: string | null; deleted?: boolean }) =>
    ins('wage_entries', {
      ...base(uid(100 + n), next(), { deleted: o.deleted }),
      worker_id: o.worker,
      project_id: o.project,
      day: o.day,
      kind: o.kind,
      days: o.days ?? null,
      amount_cents: o.cents,
      note: o.note ?? null,
    });
  wage(1, { worker: L.nimal, project: L.school, day: '2026-10-01', kind: 'work', days: 1, cents: 350_000 });
  wage(2, { worker: L.nimal, project: L.school, day: '2026-10-02', kind: 'work', days: 1, cents: 350_000 });
  wage(3, { worker: L.nimal, project: L.culvert, day: '2026-10-03', kind: 'work', days: 0.5, cents: 175_000 });
  wage(4, { worker: L.nimal, project: null, day: '2026-10-04', kind: 'work', days: 1, cents: 350_000, note: 'before projects were chosen' });
  wage(5, { worker: L.nimal, project: L.school, day: '2026-10-04', kind: 'payment', cents: 400_000, note: 'Weekly pay' });
  wage(6, { worker: L.nimal, project: null, day: '2026-10-05', kind: 'advance', cents: 100_000 });
  wage(7, { worker: L.sunil, project: L.school, day: '2026-10-01', kind: 'work', days: 1, cents: 380_000 });
  wage(8, { worker: L.sunil, project: L.school, day: '2026-10-01', kind: 'advance', cents: 50_000 });
  wage(9, { worker: L.kamal, project: L.culvert, day: '2026-10-03', kind: 'work', days: 1.5, cents: 330_000 });
  wage(10, { worker: L.kamal, project: L.culvert, day: '2026-10-03', kind: 'payment', cents: 100_000 });
  wage(11, { worker: L.sunil, project: L.school, day: '2026-10-02', kind: 'work', days: 1, cents: 380_000, deleted: true }); // removed by the user

  // ---- expenses
  const exp = (n: number, o: { project: string; day: string; category: string; cents: number; to?: string; method?: string; deleted?: boolean }) =>
    ins('expenses', {
      ...base(uid(200 + n), next(), { deleted: o.deleted }),
      project_id: o.project,
      day: o.day,
      category: o.category,
      amount_cents: o.cents,
      paid_to: o.to ?? null,
      method: o.method ?? 'cash',
      note: null,
    });
  exp(1, { project: L.school, day: '2026-10-01', category: 'materials', cents: 18_500_000, to: 'Lanka Cement Depot', method: 'bank' });
  exp(2, { project: L.school, day: '2026-10-02', category: 'food', cents: 420_000, to: 'Kumari Hotel' });
  exp(3, { project: L.culvert, day: '2026-10-03', category: 'transport', cents: 850_000, to: 'Silva Lorry Service' });
  exp(4, { project: L.school, day: '2026-10-03', category: 'fuel', cents: 999_900, deleted: true });
  exp(5, { project: L.cancelled, day: '2026-09-01', category: 'other', cents: 5_000, deleted: true });

  // ---- tools
  ins('tools', { ...base(L.drill, next()), name: 'Hilti drill', code: 'BM-T-001', notes: null });
  ins('tools', { ...base(L.mixer, next()), name: 'Concrete mixer', code: 'BM-T-002', notes: null });
  ins('tools', { ...base(L.ladder, next()), name: 'Aluminium ladder 12 ft', code: 'BM-T-005', notes: null });
  ins('tools', { ...base(L.survey, next()), name: 'Total station', code: 'BM-T-004', notes: 'Hand over only to the engineer' });

  const mov = (n: number, o: { tool: string; kind: 'issue' | 'return'; project: string | null; worker: string | null; day: string; takenBy?: string | null; condition?: string | null }) =>
    ins('tool_movements', {
      ...base(uid(300 + n), next()),
      tool_id: o.tool,
      kind: o.kind,
      project_id: o.project,
      worker_id: o.worker,
      taken_by: o.takenBy ?? null,
      day: o.day,
      condition: o.condition ?? null,
      note: null,
    });
  mov(1, { tool: L.drill, kind: 'issue', project: L.school, worker: L.sunil, day: '2026-10-02', condition: 'Good' });
  mov(2, { tool: L.mixer, kind: 'issue', project: L.school, worker: L.nimal, day: '2026-10-03' });
  mov(3, { tool: L.mixer, kind: 'return', project: L.school, worker: L.nimal, day: '2026-10-05', condition: 'Good' });
  mov(4, { tool: L.ladder, kind: 'issue', project: L.culvert, worker: null, takenBy: 'Contractor Silva', day: '2026-10-06' });
  mov(5, { tool: L.ladder, kind: 'return', project: L.culvert, worker: null, takenBy: 'Contractor Silva', day: '2026-10-06', condition: 'One rung loose' }); // same day, written later

  // ---- notes and photos
  ins('site_notes', { ...base(uid(400), next()), project_id: L.school, day: '2026-10-02', body: 'Rain after 3 pm, work stopped.', weather: 'rain' });
  ins('site_notes', { ...base(uid(401), next()), project_id: L.culvert, day: '2026-10-03', body: 'Old pipes removed.', weather: null });
  ins('attachments', {
    ...base(uid(500), next()),
    owner_table: 'expenses',
    owner_id: uid(201),
    kind: 'photo',
    file_name: `${uid(500)}.jpg`,
    mime: 'image/jpeg',
    size: 240_117,
    sha256: 'ab'.repeat(32),
  });
  ins('attachments', {
    ...base(uid(501), next()),
    owner_table: 'projects',
    owner_id: L.school,
    kind: 'pdf',
    file_name: `${uid(501)}.pdf`,
    mime: 'application/pdf',
    size: 88_000,
    sha256: 'cd'.repeat(32),
  });

  // ---- what the old app also wrote
  db.runSync("INSERT INTO settings(key, value) VALUES ('device_id', ?)", [L.device]);
  db.runSync("INSERT INTO settings(key, value) VALUES ('language', 'si')");
  db.runSync("INSERT INTO settings(key, value) VALUES ('current_project', ?)", [L.school]);
  for (const [i, id] of [L.school, L.culvert, L.nimal].entries()) {
    db.runSync('INSERT INTO audit_log(at, device_id, table_name, row_id, action, data) VALUES (?, ?, ?, ?, ?, ?)', [
      new Date(Date.parse(T0) + i * 1000).toISOString(),
      L.device,
      i < 2 ? 'projects' : 'workers',
      id,
      'insert',
      JSON.stringify({ id }),
    ]);
  }
}

/** Hand-computed totals of the data above, in cents. */
export const EXPECTED = {
  workers: {
    // earned: all 'work' rows, even without a project. advance + payment: money given.
    [L.nimal]: { earned: 1_225_000, advance: 100_000, paid: 400_000, balance: 725_000 },
    [L.sunil]: { earned: 380_000, advance: 50_000, paid: 0, balance: 330_000 },
    [L.kamal]: { earned: 330_000, advance: 0, paid: 100_000, balance: 230_000 },
  },
  projects: {
    [L.school]: { expense: 18_920_000, labour: 1_080_000, labourPaid: 450_000 },
    [L.culvert]: { expense: 850_000, labour: 505_000, labourPaid: 100_000 },
    [L.drain]: { expense: 0, labour: 0, labourPaid: 0 },
  },
} as const;

/** The columns migration 6 added (the counts of tools and movements): a comparison with a phone from before it leaves them out. */
const COUNT_COLUMNS: Record<string, string[]> = { tools: ['quantity_milli', 'unit', 'is_material'], tool_movements: ['qty_milli'] };

export function withoutCounts<T extends Record<string, unknown>>(table: string, rows: T[]): T[] {
  const drop = COUNT_COLUMNS[table];
  return drop ? rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))) as T) : rows;
}

/** Tables of schema version 1, in the order a full-row comparison reads them. */
export const V1_DATA_TABLES = ['projects', 'workers', 'tools', 'expenses', 'wage_entries', 'tool_movements', 'site_notes', 'attachments', 'audit_log', 'settings'] as const;
