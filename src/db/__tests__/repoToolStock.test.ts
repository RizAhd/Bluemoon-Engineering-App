/**
 * Tools and materials counted by quantity (migration 6). saveTool keeps the total, moveTool moves some of
 * it, and no write may leave the count impossible: more out than there is, or more back than went out. A
 * tool kept as one piece (every tool from before quantities) behaves and speaks exactly as it always did.
 */
import { all, first, save } from '@/db';
import { deleteRecord, moveTool, saveProject, saveTool, saveWorker, ValidationError } from '@/db/repo';
import type { ToolStatus, ToolStock } from '@/db/types';
import { resetDb } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

let clock: ReturnType<typeof useClock>;
let school: string;
let culvert: string;
let nimal: string;
let sunil: string;

beforeEach(() => {
  resetDb();
  clock = useClock('2026-10-20T04:00:00.000Z');
  school = saveProject({ name: 'Welimada school' });
  culvert = saveProject({ name: 'Badulla culvert' });
  nimal = saveWorker({ name: 'Nimal Perera', daily_rate_cents: 350_000 });
  sunil = saveWorker({ name: 'Sunil Fernando', daily_rate_cents: 380_000 });
});
afterEach(() => clock.restore());

type Move = Parameters<typeof moveTool>[0];

const stock = (tool: string) => first<ToolStock>('SELECT * FROM v_tool_stock WHERE tool_id = ?', [tool]);
const counts = (tool: string) => {
  const s = stock(tool);
  return { out: s?.out_milli, inStore: s?.in_store_milli };
};
/** Who has how much of a tool, by name, in a stable order: [project, person, count]. */
const held = (tool: string) =>
  all<{ project: string | null; who: string | null; qty_milli: number }>(
    `SELECT p.name AS project, COALESCE(w.name, h.taken_by) AS who, h.qty_milli AS qty_milli
     FROM v_tool_holders h LEFT JOIN projects p ON p.id = h.project_id LEFT JOIN workers w ON w.id = h.worker_id
     WHERE h.tool_id = ? ORDER BY p.name, who`,
    [tool],
  ).map((r) => [r.project, r.who, r.qty_milli]);
const status = (tool: string) => first<ToolStatus>('SELECT * FROM v_tool_status WHERE tool_id = ?', [tool]);

/** Ten ladders in the store. */
const ladders = () => saveTool({ name: 'Aluminium ladder', code: 'BM-T-005', quantity_milli: 10_000 });

/** Entered one after the other, so "the one entered last" is well defined. */
function move(tool: string, kind: Move['kind'], qty: number | null, over: Partial<Move> = {}) {
  clock.tick(10);
  return moveTool({ tool_id: tool, kind, day: '2026-10-20', worker_id: nimal, project_id: school, qty_milli: qty, ...over });
}

const written = () => ({
  tools: first<{ n: number }>('SELECT COUNT(*) AS n, SUM(version) AS v FROM tools'),
  movements: first<{ n: number }>('SELECT COUNT(*) AS n, SUM(version) AS v FROM tool_movements'),
  audit: first<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n,
});

/** The refused write: {field, key}, with proof that nothing was written or changed. */
function refused(fn: () => unknown): { field: string; key: string } {
  const before = written();
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ValidationError);
  expect(written()).toEqual(before);
  const err = caught as ValidationError;
  return { field: err.field, key: err.key };
}

describe('saveTool', () => {
  it('an old-style call (name and code only) makes one piece of a tool, with no unit', () => {
    const drill = saveTool({ name: 'Hilti drill', code: 'BM-T-001' });
    expect(first('SELECT quantity_milli, unit, is_material FROM tools WHERE id = ?', [drill])).toEqual({ quantity_milli: 1000, unit: null, is_material: 0 });
    expect(stock(drill)).toMatchObject({ quantity_milli: 1000, out_milli: 0, in_store_milli: 1000, is_material: 0, unit: null });
    // and an old-style movement moves that one piece
    const out = move(drill, 'issue', null);
    expect(first('SELECT qty_milli FROM tool_movements WHERE id = ?', [out])).toEqual({ qty_milli: 1000 });
    expect(counts(drill)).toEqual({ out: 1000, inStore: 0 });
  });

  it('editing an old-style tool without mentioning its count keeps the count it has', () => {
    const tool = ladders();
    clock.tick(1_000);
    saveTool({ id: tool, name: 'Aluminium ladder 12 ft', code: 'BM-T-005' });
    expect(first('SELECT name, quantity_milli, version FROM tools WHERE id = ?', [tool])).toEqual({ name: 'Aluminium ladder 12 ft', quantity_milli: 10_000, version: 2 });
  });

  it('a tool is counted in whole pieces and has at least one; a material may have decimals and may be at 0', () => {
    expect(refused(() => saveTool({ name: 'Ladder', quantity_milli: 2500 }))).toEqual({ field: 'qty', key: 'errQtyWhole' });
    expect(refused(() => saveTool({ name: 'Ladder', quantity_milli: 0 }))).toEqual({ field: 'qty', key: 'errQty' });
    expect(refused(() => saveTool({ name: 'Ladder', quantity_milli: -1000 }))).toEqual({ field: 'qty', key: 'errQty' });
    expect(refused(() => saveTool({ name: 'Ladder', quantity_milli: 1000.5 }))).toEqual({ field: 'qty', key: 'errQty' });
    expect(refused(() => saveTool({ name: 'Ladder', quantity_milli: 1_000_000_001 }))).toEqual({ field: 'qty', key: 'errQty' });

    const cement = saveTool({ name: 'Cement', unit: 'bags', quantity_milli: 2500, is_material: true });
    expect(stock(cement)).toMatchObject({ quantity_milli: 2500, in_store_milli: 2500, unit: 'bags', is_material: 1 });
    const sand = saveTool({ name: 'Sand', unit: 'cube', quantity_milli: 0, is_material: true });
    expect(stock(sand)).toMatchObject({ quantity_milli: 0, in_store_milli: 0, out_milli: 0 });
    expect(refused(() => saveTool({ name: 'Sand', is_material: true, quantity_milli: -500 }))).toEqual({ field: 'qty', key: 'errQty' });
  });
});

describe('moveTool with several pieces', () => {
  it('issue 3 of 10: 3 out, 7 in store', () => {
    const tool = ladders();
    move(tool, 'issue', 3000);
    expect(counts(tool)).toEqual({ out: 3000, inStore: 7000 });
  });

  it('issuing more than is in store is refused (errStockShort) and nothing is written', () => {
    const tool = ladders();
    move(tool, 'issue', 3000);
    expect(refused(() => move(tool, 'issue', 8000, { worker_id: sunil }))).toEqual({ field: 'qty', key: 'errStockShort' });
    expect(refused(() => move(tool, 'issue', 10_000))).toEqual({ field: 'qty', key: 'errStockShort' });
    expect(() => move(tool, 'issue', 7000, { worker_id: sunil })).not.toThrow(); // exactly what is left is fine
    expect(counts(tool)).toEqual({ out: 10_000, inStore: 0 });
  });

  it('return 2 of the 3 that are out: 1 out, 9 in store', () => {
    const tool = ladders();
    move(tool, 'issue', 3000);
    move(tool, 'return', 2000);
    expect(counts(tool)).toEqual({ out: 1000, inStore: 9000 });
  });

  it('returning more than is out is refused (errReturnTooMany)', () => {
    const tool = ladders();
    move(tool, 'issue', 3000);
    move(tool, 'return', 2000);
    expect(refused(() => move(tool, 'return', 5000))).toEqual({ field: 'qty', key: 'errReturnTooMany' });
    expect(refused(() => move(tool, 'return', 2000))).toEqual({ field: 'qty', key: 'errReturnTooMany' });
    expect(() => move(tool, 'return', 1000)).not.toThrow();
    expect(counts(tool)).toEqual({ out: 0, inStore: 10_000 });
    // nothing out at all: a return of anything is too many
    expect(refused(() => move(tool, 'return', 1000))).toEqual({ field: 'qty', key: 'errReturnTooMany' });
  });

  it('a tool refuses a count that is not whole pieces (errQtyWhole), a material does not; nothing moves 0', () => {
    const tool = ladders();
    expect(refused(() => move(tool, 'issue', 2500))).toEqual({ field: 'qty', key: 'errQtyWhole' });
    expect(refused(() => move(tool, 'issue', 0))).toEqual({ field: 'qty', key: 'errQty' });
    expect(refused(() => move(tool, 'issue', -1000))).toEqual({ field: 'qty', key: 'errQty' });
    const cement = saveTool({ name: 'Cement', unit: 'bags', quantity_milli: 100_000, is_material: true });
    expect(() => move(cement, 'issue', 2500)).not.toThrow();
    expect(counts(cement)).toEqual({ out: 2500, inStore: 97_500 });
    expect(refused(() => move(cement, 'issue', 0))).toEqual({ field: 'qty', key: 'errQty' });
    // a material can be issued down to nothing left
    expect(() => move(cement, 'issue', 97_500, { worker_id: sunil })).not.toThrow();
    expect(counts(cement)).toEqual({ out: 100_000, inStore: 0 });
    expect(refused(() => move(cement, 'issue', 500))).toEqual({ field: 'qty', key: 'errStockShort' });
  });

  it('editing a movement counts the tool without the movement itself', () => {
    const tool = ladders();
    const id = move(tool, 'issue', 3000);
    clock.tick(10);
    // raise the same issue to all 10: fine, because its old 3 are not counted twice
    expect(moveTool({ id, tool_id: tool, kind: 'issue', day: '2026-10-20', worker_id: nimal, project_id: school, qty_milli: 10_000 })).toBe(id);
    expect(counts(tool)).toEqual({ out: 10_000, inStore: 0 });
    expect(first('SELECT COUNT(*) AS n FROM tool_movements WHERE tool_id = ?', [tool])).toEqual({ n: 1 });
    // but not to 11
    expect(refused(() => moveTool({ id, tool_id: tool, kind: 'issue', day: '2026-10-20', worker_id: nimal, project_id: school, qty_milli: 11_000 }))).toEqual({ field: 'qty', key: 'errStockShort' });
    expect(first('SELECT qty_milli, version FROM tool_movements WHERE id = ?', [id])).toEqual({ qty_milli: 10_000, version: 2 });
  });

  it('lowering the total below what is out is refused (errStockInvalid); lowering to it and raising it are fine', () => {
    const tool = ladders();
    move(tool, 'issue', 3000);
    expect(refused(() => saveTool({ id: tool, name: 'Aluminium ladder', quantity_milli: 2000 }))).toEqual({ field: 'qty', key: 'errStockInvalid' });
    expect(first('SELECT quantity_milli FROM tools WHERE id = ?', [tool])).toEqual({ quantity_milli: 10_000 });
    expect(() => saveTool({ id: tool, name: 'Aluminium ladder', quantity_milli: 3000 })).not.toThrow();
    expect(counts(tool)).toEqual({ out: 3000, inStore: 0 });
    expect(() => saveTool({ id: tool, name: 'Aluminium ladder', quantity_milli: 25_000 })).not.toThrow();
    expect(counts(tool)).toEqual({ out: 3000, inStore: 22_000 });
  });

  it('deleting an issue that a later return depends on is refused (errStockInvalid); the row stays live', () => {
    const tool = ladders();
    const out = move(tool, 'issue', 3000);
    move(tool, 'return', 2000);
    let caught: unknown;
    try {
      deleteRecord('tool_movements', out);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).key).toBe('errStockInvalid');
    expect(first('SELECT deleted_at, version FROM tool_movements WHERE id = ?', [out])).toEqual({ deleted_at: null, version: 1 });
    expect(counts(tool)).toEqual({ out: 1000, inStore: 9000 });
    // deleting the return first is fine, and then the issue can go too
    const back = first<{ id: string }>("SELECT id FROM tool_movements WHERE tool_id = ? AND kind = 'return'", [tool])?.id as string;
    expect(() => deleteRecord('tool_movements', back)).not.toThrow();
    expect(counts(tool)).toEqual({ out: 3000, inStore: 7000 });
    expect(() => deleteRecord('tool_movements', out)).not.toThrow();
    expect(counts(tool)).toEqual({ out: 0, inStore: 10_000 });
  });

  it('a count that is already wrong (merged from another phone) may be repaired, but never made worse', () => {
    const tool = ladders();
    // a return with nothing issued before it, written the way an import writes rows: 1 piece "out" below zero
    clock.tick(10);
    save('tool_movements', { tool_id: tool, kind: 'return', day: '2026-10-19', worker_id: nimal, project_id: school, qty_milli: 1000 });
    expect(counts(tool)).toEqual({ out: -1000, inStore: 11_000 });
    expect(refused(() => move(tool, 'return', 1000))).toEqual({ field: 'qty', key: 'errReturnTooMany' }); // worse
    expect(() => move(tool, 'issue', 1000)).not.toThrow(); // better: back to 0
    expect(counts(tool)).toEqual({ out: 0, inStore: 10_000 });
  });
});

describe('a single piece keeps the words it always had', () => {
  it('issued twice says errToolState, returned while in says errToolState', () => {
    const drill = saveTool({ name: 'Hilti drill' });
    expect(refused(() => move(drill, 'return', null))).toEqual({ field: 'tool_id', key: 'errToolState' });
    move(drill, 'issue', null);
    expect(refused(() => move(drill, 'issue', null, { worker_id: sunil }))).toEqual({ field: 'tool_id', key: 'errToolState' });
    expect(refused(() => move(drill, 'issue', 1000, { worker_id: sunil }))).toEqual({ field: 'tool_id', key: 'errToolState' });
    move(drill, 'return', null);
    expect(refused(() => move(drill, 'return', null))).toEqual({ field: 'tool_id', key: 'errToolState' });
    // and it cannot be issued as two pieces either
    expect(refused(() => move(drill, 'issue', 2000))).toEqual({ field: 'tool_id', key: 'errToolState' });
  });

  it('a material of exactly one unit is not "a single piece": it says there is not enough in store', () => {
    const paint = saveTool({ name: 'Paint', unit: 'can', quantity_milli: 1000, is_material: true });
    move(paint, 'issue', 1000);
    expect(refused(() => move(paint, 'issue', 1000, { worker_id: sunil }))).toEqual({ field: 'qty', key: 'errStockShort' });
    expect(refused(() => move(paint, 'return', 2000))).toEqual({ field: 'qty', key: 'errReturnTooMany' });
  });

  it('v_tool_status is what it was: the same columns, out after an issue, in after a return', () => {
    expect(all<{ name: string }>('PRAGMA table_info(v_tool_status)').map((c) => c.name)).toEqual([
      'tool_id',
      'name',
      'code',
      'last_kind',
      'last_day',
      'project_id',
      'worker_id',
      'taken_by',
      'is_out',
    ]);
    const drill = saveTool({ name: 'Hilti drill', code: 'BM-T-001' });
    expect(status(drill)).toEqual({ tool_id: drill, name: 'Hilti drill', code: 'BM-T-001', last_kind: null, last_day: null, project_id: null, worker_id: null, taken_by: null, is_out: 0 });
    move(drill, 'issue', null);
    expect(status(drill)).toMatchObject({ last_kind: 'issue', last_day: '2026-10-20', project_id: school, worker_id: nimal, is_out: 1 });
    move(drill, 'return', null, { day: '2026-10-21' });
    expect(status(drill)).toMatchObject({ last_kind: 'return', last_day: '2026-10-21', is_out: 0 });
    expect(held(drill)).toEqual([]);
  });
});

describe('v_tool_holders', () => {
  it('one row per tool, project and person with what each still has; a holder who gave everything back is gone', () => {
    const tool = ladders();
    move(tool, 'issue', 3000); // Nimal, school
    move(tool, 'issue', 2000, { worker_id: sunil, project_id: culvert });
    move(tool, 'issue', 1000, { worker_id: null, taken_by: 'Contractor Silva', project_id: culvert });
    move(tool, 'return', 1000); // Nimal brings one back
    expect(held(tool)).toEqual([
      ['Badulla culvert', 'Contractor Silva', 1000],
      ['Badulla culvert', 'Sunil Fernando', 2000],
      ['Welimada school', 'Nimal Perera', 2000],
    ]);
    expect(counts(tool)).toEqual({ out: 5000, inStore: 5000 });
    move(tool, 'return', 2000, { worker_id: sunil, project_id: culvert });
    expect(held(tool)).toEqual([
      ['Badulla culvert', 'Contractor Silva', 1000],
      ['Welimada school', 'Nimal Perera', 2000],
    ]);
    // a deleted movement no longer counts, a deleted tool has no holders
    const silva = first<{ id: string }>("SELECT id FROM tool_movements WHERE taken_by = 'Contractor Silva'", [])?.id as string;
    deleteRecord('tool_movements', silva);
    expect(held(tool)).toEqual([['Welimada school', 'Nimal Perera', 2000]]);
    deleteRecord('tools', tool);
    expect(held(tool)).toEqual([]);
    expect(stock(tool)).toBeNull();
  });

  it('a material: issued amounts stay with their holders (what was used up is never "returned")', () => {
    const cement = saveTool({ name: 'Cement', unit: 'bags', quantity_milli: 100_000, is_material: true });
    move(cement, 'issue', 20_000);
    move(cement, 'issue', 2500, { worker_id: sunil, project_id: culvert });
    expect(held(cement)).toEqual([
      ['Badulla culvert', 'Sunil Fernando', 2500],
      ['Welimada school', 'Nimal Perera', 20_000],
    ]);
    expect(stock(cement)).toMatchObject({ out_milli: 22_500, in_store_milli: 77_500 });
  });
});
