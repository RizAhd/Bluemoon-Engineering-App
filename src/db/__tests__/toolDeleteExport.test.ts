/**
 * Deleting a tool takes its movements with it (deleteRecord), and that deletion has to reach the other
 * phone through a hand-over: bundles carry deleted rows on purpose ("deletions travel too"), so the
 * other phone ends up with the same tool status as the sender and no live movement of a deleted tool.
 */
import { DATA_TABLES } from '@/db/schema';
import type { ToolStatus } from '@/db/types';
import { mainPhone, openSecondPhone, resetDb, transfer, type Phone } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(120_000);

let a: Phone; // the sender
let b: Phone;
let clock: ReturnType<typeof useClock>;
let p1: string;
let p2: string;
let drill: string;
let mixer: string;
let worker: string;
let moves: string[]; // the drill's three movements, oldest first

beforeAll(() => {
  b = openSecondPhone();
});
afterAll(() => b.dispose());

beforeEach(() => {
  resetDb();
  b.resetDb();
  a = mainPhone();
  clock = useClock(new Date(2026, 9, 22, 12, 0, 0));
  p1 = a.repo.saveProject({ name: 'Project one' });
  p2 = a.repo.saveProject({ name: 'Project two' });
  worker = a.repo.saveWorker({ name: 'Nimal', daily_rate_cents: 350_000 });
  drill = a.repo.saveTool({ name: 'Hilti drill' });
  mixer = a.repo.saveTool({ name: 'Concrete mixer' });
  const mv = (tool: string, kind: 'issue' | 'return', project: string, day: string) => {
    clock.tick(10);
    return a.repo.moveTool({ tool_id: tool, kind, project_id: project, worker_id: worker, day });
  };
  moves = [mv(drill, 'issue', p1, '2026-10-18'), mv(drill, 'return', p1, '2026-10-19'), mv(drill, 'issue', p2, '2026-10-20')];
  mv(mixer, 'issue', p1, '2026-10-20');
});
afterEach(() => clock.restore());

const live = (phone: Phone, where: string, params: string[] = []) =>
  phone.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM tool_movements WHERE deleted_at IS NULL AND ${where}`, params)?.n ?? 0;
const statusRows = (phone: Phone) => phone.db.all<ToolStatus>('SELECT * FROM v_tool_status ORDER BY name');

describe('the export of a deleted tool', () => {
  it('carries the tool and every movement of it as deleted, none as live', () => {
    a.repo.deleteRecord('tools', drill);

    for (const tables of [a.bundle.collectProject(p1), a.bundle.collectProject(p2), a.bundle.collectAll()]) {
      const drillMoves = (tables.tool_movements ?? []).filter((m) => m.tool_id === drill);
      expect(drillMoves.length).toBeGreaterThan(0);
      expect(drillMoves.filter((m) => !m.deleted_at)).toEqual([]);
      expect((tables.tools ?? []).filter((t) => t.id === drill).every((t) => t.deleted_at)).toBe(true);
    }
  });

  it('carries the movement history of the tool that is still in use, deleted or not, and keeps the bundle format', () => {
    a.repo.deleteRecord('tool_movements', moves[2]);
    const tables = a.bundle.collectProject(p1);
    expect(Object.keys(tables).sort()).toEqual([...DATA_TABLES].sort());
    // the drill's whole history (incl. the one deleted on project two), the mixer's single movement
    expect((tables.tool_movements ?? []).map((m) => m.id).sort()).toEqual([...moves, ...a.db.all<{ id: string }>('SELECT id FROM tool_movements WHERE tool_id = ?', [mixer]).map((r) => r.id)].sort());
    expect((tables.tool_movements ?? []).filter((m) => m.deleted_at).map((m) => m.id)).toEqual([moves[2]]);
  });
});

describe('handing a project over after a tool was deleted', () => {
  beforeEach(async () => {
    await transfer(a, b, { projectId: p1 });
    await transfer(a, b, { projectId: p2 });
    clock.tick(60_000);
  });

  it('starts with both phones agreeing that the drill and the mixer are out', () => {
    expect(statusRows(b).map((s) => [s.name, s.is_out])).toEqual([['Concrete mixer', 1], ['Hilti drill', 1]]);
    expect(live(b, 'tool_id = ?', [drill])).toBe(3);
  });

  it('the deletion arrives: no live movement of the tool is left on the other phone, and its status is gone', async () => {
    a.repo.deleteRecord('tools', drill);

    const plan = await transfer(a, b, { projectId: p1 });

    expect(plan.perTable.tools).toEqual({ inserted: 0, updated: 1, skipped: 1 }); // the drill is updated, the mixer is unchanged
    expect(plan.perTable.tool_movements).toEqual({ inserted: 0, updated: 3, skipped: 1 }); // the drill's three, not the mixer's
    expect(live(b, 'tool_id = ?', [drill])).toBe(0);
    expect(b.db.first('SELECT deleted_at IS NOT NULL AS gone FROM tools WHERE id = ?', [drill])).toEqual({ gone: 1 });
    expect(b.db.all('SELECT * FROM tool_movements WHERE tool_id = ?', [drill])).toHaveLength(3); // kept as history
    expect(statusRows(b)).toEqual(statusRows(a));
    expect(statusRows(b).map((s) => s.name)).toEqual(['Concrete mixer']);
  });

  it('a movement deleted on the sender is deleted on the other phone too, so both show the same status', async () => {
    a.repo.deleteRecord('tool_movements', moves[2]); // the issue to project two: the drill is back in
    expect(statusRows(a).find((s) => s.tool_id === drill)?.is_out).toBe(0);
    expect(statusRows(b).find((s) => s.tool_id === drill)?.is_out).toBe(1);

    // only project one is handed over: the tool's whole history travels with it, deletions included
    await transfer(a, b, { projectId: p1 });

    expect(statusRows(b)).toEqual(statusRows(a));
    expect(b.db.first('SELECT deleted_at IS NOT NULL AS gone FROM tool_movements WHERE id = ?', [moves[2]])).toEqual({ gone: 1 });
  });

  it('importing the same hand-over again changes nothing', async () => {
    a.repo.deleteRecord('tools', drill);
    await transfer(a, b, { projectId: p1 });
    const again = await transfer(a, b, { projectId: p1 });
    expect(again.counts.inserted + again.counts.updated).toBe(0);
  });
});
