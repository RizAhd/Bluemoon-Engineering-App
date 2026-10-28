/**
 * v_tool_status: a tool is "out" when its latest movement is an issue.
 * "Latest" = the newest day, and within one day the one entered last.
 */
import { all, first, save } from '@/db';
import { deleteRecord, moveTool, saveProject, saveTool, saveWorker } from '@/db/repo';
import type { ToolStatus } from '@/db/types';
import { addDays } from '@/lib/dates';
import { resetDb, seedDemo } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

let clock: ReturnType<typeof useClock>;
beforeEach(() => {
  resetDb();
  clock = useClock(new Date(2026, 9, 22, 12, 0, 0));
});
afterEach(() => clock.restore());

const status = (tool: string) => first<ToolStatus>('SELECT * FROM v_tool_status WHERE tool_id = ?', [tool]);
const isOut = (tool: string) => status(tool)?.is_out;

describe('the demo data', () => {
  it('has the drill and the mixer out, everything else in (by the latest movement; the counted tools are judged by v_tool_holders)', () => {
    seedDemo();
    const today = '2026-10-22';
    const rows = all<ToolStatus & { worker_name: string | null }>(
      'SELECT s.*, w.name AS worker_name FROM v_tool_status s LEFT JOIN workers w ON w.id = s.worker_id ORDER BY s.name',
    );
    expect(rows.map((r) => [r.name, r.is_out])).toEqual([
      ['Aluminium ladder 12 ft', 0],
      ['Cement', 1], // a material: its latest movement is the issue of 20 bags
      ['Concrete mixer', 1],
      ['Hilti drill', 1],
      ['Total station', 0],
      ['Vibrator poker', 0],
      ['Wheelbarrow', 0], // four pieces, two still out; the latest movement is the return of one
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    // drill issued to Sunil two days ago, mixer to Nimal three days ago
    expect(by['Hilti drill']).toMatchObject({ last_kind: 'issue', last_day: addDays(today, -2), worker_name: 'Sunil Fernando', code: 'BM-T-001' });
    expect(by['Concrete mixer']).toMatchObject({ last_kind: 'issue', last_day: addDays(today, -3), worker_name: 'Nimal Perera' });
    // the ladder went out 6 days ago and came back 4 days ago
    expect(by['Aluminium ladder 12 ft']).toMatchObject({ last_kind: 'return', last_day: addDays(today, -4) });
    // never moved
    expect(by['Total station']).toMatchObject({ last_kind: null, last_day: null, project_id: null, worker_id: null });
  });
});

describe('one tool', () => {
  let tool: string;
  let nimal: string;
  let sunil: string;
  let school: string;

  beforeEach(() => {
    tool = saveTool({ name: 'Drill' });
    nimal = saveWorker({ name: 'Nimal', daily_rate_cents: 1 });
    sunil = saveWorker({ name: 'Sunil', daily_rate_cents: 1 });
    school = saveProject({ name: 'School' });
  });

  const move = (kind: 'issue' | 'return', dayStr: string, over: Partial<Parameters<typeof moveTool>[0]> = {}) => {
    clock.tick(1); // entered one after the other
    return moveTool({ tool_id: tool, kind, day: dayStr, worker_id: nimal, project_id: school, ...over });
  };
  // moveTool refuses a movement that does not follow from the last one (see repoToolMoves.test.ts). Data merged
  // from another phone can still hold one, and the view must order it by day, so these tests write it directly.
  const raw = (kind: 'issue' | 'return', dayStr: string, over: Record<string, string | number | null> = {}) => {
    clock.tick(1);
    return save('tool_movements', { tool_id: tool, kind, day: dayStr, worker_id: nimal, project_id: school, ...over });
  };

  it('never moved: in, with nothing known', () => {
    expect(status(tool)).toMatchObject({ is_out: 0, last_kind: null, last_day: null, project_id: null, worker_id: null, taken_by: null });
  });

  it('issued: out, with who has it, where and since when', () => {
    move('issue', '2026-10-20');
    expect(status(tool)).toMatchObject({ is_out: 1, last_kind: 'issue', last_day: '2026-10-20', project_id: school, worker_id: nimal, taken_by: null });
  });

  it('issued to someone outside the company by name', () => {
    move('issue', '2026-10-20', { worker_id: null, taken_by: 'Contractor Silva', project_id: null });
    expect(status(tool)).toMatchObject({ is_out: 1, worker_id: null, taken_by: 'Contractor Silva', project_id: null });
  });

  it('returned: in again', () => {
    move('issue', '2026-10-20');
    move('return', '2026-10-21');
    expect(status(tool)).toMatchObject({ is_out: 0, last_kind: 'return', last_day: '2026-10-21' });
  });

  it('issued again to somebody else: out, now with the second person', () => {
    move('issue', '2026-10-18');
    move('return', '2026-10-19');
    move('issue', '2026-10-20', { worker_id: sunil });
    expect(status(tool)).toMatchObject({ is_out: 1, worker_id: sunil, last_day: '2026-10-20' });
  });

  describe('latest means the newest day, not the newest entry', () => {
    it('a return written up late for an earlier day does not bring back a tool that was issued since', () => {
      move('issue', '2026-10-05');
      raw('return', '2026-10-03'); // entered afterwards, but it happened before
      expect(isOut(tool)).toBe(1);
      expect(status(tool)?.last_day).toBe('2026-10-05');
    });

    it('an issue written up late for an earlier day does not take a returned tool out again', () => {
      raw('return', '2026-10-05');
      raw('issue', '2026-10-03');
      expect(isOut(tool)).toBe(0);
    });

    it('correcting the day of the issue to before the return puts the tool back in', () => {
      const issue = move('issue', '2026-10-05');
      raw('return', '2026-10-03');
      expect(isOut(tool)).toBe(1);
      raw('issue', '2026-10-01', { id: issue }); // the issue really happened on the 1st
      expect(isOut(tool)).toBe(0);
    });
  });

  describe('on the same day the one entered last wins', () => {
    it('issue, then return: in', () => {
      move('issue', '2026-10-20');
      move('return', '2026-10-20');
      expect(isOut(tool)).toBe(0);
    });

    it('return, then issue: out', () => {
      raw('return', '2026-10-20');
      move('issue', '2026-10-20');
      expect(isOut(tool)).toBe(1);
    });

    it('issue, return, issue: out, with the last person', () => {
      move('issue', '2026-10-20');
      move('return', '2026-10-20');
      move('issue', '2026-10-20', { worker_id: sunil });
      expect(status(tool)).toMatchObject({ is_out: 1, worker_id: sunil });
    });

    it('a later day beats an earlier day even when entered first', () => {
      raw('return', '2026-10-21');
      raw('issue', '2026-10-20');
      expect(isOut(tool)).toBe(0);
    });
  });

  describe('deleted movements', () => {
    it('deleting the latest return makes the tool out again', () => {
      move('issue', '2026-10-19');
      const back = move('return', '2026-10-20');
      expect(isOut(tool)).toBe(0);
      deleteRecord('tool_movements', back);
      expect(isOut(tool)).toBe(1);
      expect(status(tool)).toMatchObject({ last_kind: 'issue', last_day: '2026-10-19', worker_id: nimal });
    });

    it('deleting the latest issue makes the tool in again', () => {
      move('issue', '2026-10-19');
      move('return', '2026-10-20');
      const again = move('issue', '2026-10-21');
      expect(isOut(tool)).toBe(1);
      deleteRecord('tool_movements', again);
      expect(isOut(tool)).toBe(0);
    });

    it('deleting the only movement leaves a tool that was never moved', () => {
      const only = move('issue', '2026-10-19');
      deleteRecord('tool_movements', only);
      expect(status(tool)).toMatchObject({ is_out: 0, last_kind: null, last_day: null });
    });

    it('the history is kept: deleted movements are still rows', () => {
      move('issue', '2026-10-19');
      const back = move('return', '2026-10-20');
      deleteRecord('tool_movements', back);
      expect(first('SELECT COUNT(*) AS n FROM tool_movements')).toEqual({ n: 2 });
    });
  });

  it('a deleted tool is not listed', () => {
    move('issue', '2026-10-19');
    deleteRecord('tools', tool);
    expect(status(tool)).toBeNull();
    expect(all('SELECT * FROM v_tool_status')).toEqual([]);
  });
});

describe('several tools', () => {
  it('each tool has its own status; the number out is the number of tools whose last movement is an issue', () => {
    const w = saveWorker({ name: 'W', daily_rate_cents: 1 });
    const tools = ['A', 'B', 'C', 'D'].map((name) => saveTool({ name }));
    const go = (tool: string, kind: 'issue' | 'return', day: string) => {
      clock.tick(1);
      moveTool({ tool_id: tool, kind, worker_id: w, day });
    };
    go(tools[0], 'issue', '2026-10-20');
    go(tools[1], 'issue', '2026-10-20');
    go(tools[1], 'return', '2026-10-21');
    go(tools[2], 'issue', '2026-10-19');
    go(tools[2], 'return', '2026-10-19');
    go(tools[2], 'issue', '2026-10-22');
    expect(tools.map(isOut)).toEqual([1, 0, 1, 0]);
    expect(first('SELECT COUNT(*) AS n FROM v_tool_status WHERE is_out = 1')).toEqual({ n: 2 });
    expect(first('SELECT COUNT(*) AS n FROM v_tool_status')).toEqual({ n: 4 });
  });
});
