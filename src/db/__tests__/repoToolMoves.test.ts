/**
 * moveTool judges a movement against the tool's latest one, ordered the way v_tool_status orders them
 * (newest day, then the one entered last): a tool goes out only when it is in, comes back only when it
 * is out, and a record is never dated before the last one. A refused move writes nothing.
 */
import { first, save } from '@/db';
import { deleteRecord, moveTool, saveProject, saveTool, saveWorker, ValidationError } from '@/db/repo';
import { DATA_TABLES } from '@/db/schema';
import { en } from '@/i18n/en';
import { si } from '@/i18n/si';
import { ta } from '@/i18n/ta';
import { today } from '@/lib/dates';
import { resetDb, seedDemo } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

let clock: ReturnType<typeof useClock>;
let drill: string;
let nimal: string;
let sunil: string;
let project: string;

beforeEach(() => {
  resetDb();
  clock = useClock('2026-10-20T04:00:00.000Z');
  project = saveProject({ name: 'Welimada school' });
  nimal = saveWorker({ name: 'Nimal Perera', daily_rate_cents: 350_000 });
  sunil = saveWorker({ name: 'Sunil Fernando', daily_rate_cents: 380_000 });
  drill = saveTool({ name: 'Hilti drill' });
});
afterEach(() => clock.restore());

type Move = Parameters<typeof moveTool>[0];

/** Entered one after the other, so "the one entered last" is well defined. */
function move(kind: Move['kind'], day: string, over: Partial<Move> = {}) {
  clock.tick(10);
  return moveTool({ tool_id: drill, kind, day, worker_id: nimal, project_id: project, ...over });
}
/** Written without the checks, as merged data from another phone can be. */
function raw(kind: Move['kind'], day: string, over: Record<string, string | number | null> = {}) {
  clock.tick(10);
  return save('tool_movements', { tool_id: drill, kind, day, worker_id: nimal, project_id: project, ...over });
}

const counts = () => ({
  movements: first<{ n: number }>('SELECT COUNT(*) AS n FROM tool_movements')?.n,
  audit: first<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n,
});
const isOut = (tool = drill) => first<{ is_out: number }>('SELECT is_out FROM v_tool_status WHERE tool_id = ?', [tool])?.is_out;

/** The refused move: {field, key}, with proof that nothing was written. */
function refused(fn: () => unknown): { field: string; key: string } {
  const before = counts();
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ValidationError);
  expect(counts()).toEqual(before);
  const err = caught as ValidationError;
  return { field: err.field, key: err.key };
}

describe('the tool must be in to go out, and out to come back', () => {
  it('issuing a tool that is already out is refused', () => {
    move('issue', '2026-10-19');
    expect(refused(() => move('issue', '2026-10-19', { worker_id: sunil }))).toEqual({ field: 'tool_id', key: 'errToolState' });
    expect(refused(() => move('issue', '2026-10-20', { worker_id: sunil }))).toEqual({ field: 'tool_id', key: 'errToolState' });
    expect(isOut()).toBe(1);
  });

  it('returning a tool that was never moved is refused', () => {
    expect(refused(() => move('return', '2026-10-19'))).toEqual({ field: 'tool_id', key: 'errToolState' });
  });

  it('returning a tool that is already back is refused', () => {
    move('issue', '2026-10-18');
    move('return', '2026-10-19');
    expect(refused(() => move('return', '2026-10-19'))).toEqual({ field: 'tool_id', key: 'errToolState' });
    expect(refused(() => move('return', '2026-10-20'))).toEqual({ field: 'tool_id', key: 'errToolState' });
    expect(isOut()).toBe(0);
  });

  it('a tool can go out and come back again and again', () => {
    for (const [i, day] of ['2026-10-10', '2026-10-12', '2026-10-14', '2026-10-16'].entries()) {
      move(i % 2 === 0 ? 'issue' : 'return', day, { worker_id: i % 2 === 0 ? sunil : nimal });
      expect(isOut()).toBe(i % 2 === 0 ? 1 : 0);
    }
    expect(first('SELECT COUNT(*) AS n FROM tool_movements')).toEqual({ n: 4 });
  });

  it('one tool being out does not stop another tool from going out or coming back', () => {
    const mixer = saveTool({ name: 'Mixer' });
    move('issue', '2026-10-19');
    expect(() => moveTool({ tool_id: mixer, kind: 'issue', worker_id: nimal, day: '2026-10-19' })).not.toThrow();
    clock.tick(10);
    expect(() => moveTool({ tool_id: mixer, kind: 'return', worker_id: nimal, day: '2026-10-19' })).not.toThrow();
    expect(isOut(mixer)).toBe(0);
    expect(isOut()).toBe(1);
  });

  it('a deleted movement no longer counts: deleting the return makes the tool out again, deleting the issue makes it new', () => {
    const out = move('issue', '2026-10-19');
    const back = move('return', '2026-10-20');
    deleteRecord('tool_movements', back);
    expect(refused(() => move('issue', '2026-10-21')).key).toBe('errToolState'); // it is out again
    // ... and with everything deleted the tool has never been moved
    deleteRecord('tool_movements', move('return', '2026-10-21'));
    deleteRecord('tool_movements', out);
    expect(refused(() => move('return', '2026-10-22')).key).toBe('errToolState');
    expect(() => move('issue', '2026-10-22')).not.toThrow();
  });
});

describe('a record is not dated before the last one for the tool', () => {
  it('a return dated before the issue is refused, on the day field', () => {
    move('issue', '2026-10-19');
    expect(refused(() => move('return', '2026-10-18'))).toEqual({ field: 'day', key: 'errDateBeforeLast' });
    expect(isOut()).toBe(1);
  });

  it('an issue dated before the last return is refused', () => {
    move('issue', '2026-10-15');
    move('return', '2026-10-18');
    expect(refused(() => move('issue', '2026-10-17', { worker_id: sunil }))).toEqual({ field: 'day', key: 'errDateBeforeLast' });
    expect(isOut()).toBe(0);
  });

  it('the same day is fine, in both directions, and so is any later day', () => {
    move('issue', '2026-10-19');
    expect(() => move('return', '2026-10-19')).not.toThrow();
    expect(() => move('issue', '2026-10-19', { worker_id: sunil })).not.toThrow();
    expect(() => move('return', '2026-10-25')).not.toThrow();
    expect(() => move('issue', '2026-11-02')).not.toThrow();
  });

  it('is judged across a month and a year, by date and not by text length', () => {
    move('issue', '2026-12-31');
    expect(refused(() => move('return', '2026-12-30')).key).toBe('errDateBeforeLast');
    expect(() => move('return', '2027-01-01')).not.toThrow();
    expect(refused(() => move('issue', '2026-09-30')).key).toBe('errDateBeforeLast');
  });

  it('only this tool counts: another tool used on a later day does not matter', () => {
    const mixer = saveTool({ name: 'Mixer' });
    moveTool({ tool_id: mixer, kind: 'issue', worker_id: nimal, day: '2026-10-25' });
    expect(() => move('issue', '2026-10-19')).not.toThrow();
  });

  it('a deleted later record no longer counts', () => {
    move('issue', '2026-10-15');
    const back = move('return', '2026-10-18');
    deleteRecord('tool_movements', back);
    expect(() => move('return', '2026-10-16')).not.toThrow();
  });
});

describe('"latest" is the view\'s latest: newest day first, then the one entered last', () => {
  it('goes by day, not by the order of entry', () => {
    // the issue is dated the 10th but was entered first, the return is dated the 5th and entered after it:
    // the view says the tool is out (newest day), so it can come back but cannot be issued again
    raw('issue', '2026-10-10');
    raw('return', '2026-10-05');
    expect(isOut()).toBe(1);
    expect(refused(() => move('issue', '2026-10-11', { worker_id: sunil })).key).toBe('errToolState');
    expect(() => move('return', '2026-10-11')).not.toThrow();
    expect(isOut()).toBe(0);
  });

  it('on one day the movement entered last decides', () => {
    move('issue', '2026-10-19');
    move('return', '2026-10-19');
    expect(refused(() => move('return', '2026-10-19')).key).toBe('errToolState');
    move('issue', '2026-10-19', { worker_id: sunil });
    expect(refused(() => move('issue', '2026-10-19')).key).toBe('errToolState');
    expect(isOut()).toBe(1);
  });

  it('agrees with v_tool_status after every accepted move', () => {
    const plan: [Move['kind'], string][] = [
      ['issue', '2026-10-01'],
      ['return', '2026-10-01'],
      ['issue', '2026-10-02'],
      ['return', '2026-10-09'],
      ['issue', '2026-10-09'],
      ['return', '2026-10-30'],
    ];
    for (const [kind, day] of plan) {
      move(kind, day);
      expect(isOut()).toBe(kind === 'issue' ? 1 : 0);
    }
  });
});

describe('editing a movement', () => {
  it('saving the latest movement again keeps its id; it is not its own predecessor', () => {
    const out = move('issue', '2026-10-19');
    expect(move('issue', '2026-10-19', { id: out, condition: 'Scratched' })).toBe(out);
    expect(first('SELECT condition, version FROM tool_movements WHERE id = ?', [out])).toEqual({ condition: 'Scratched', version: 2 });
    const back = move('return', '2026-10-20');
    expect(move('return', '2026-10-20', { id: back, condition: 'Chuck damaged' })).toBe(back);
    expect(first('SELECT COUNT(*) AS n FROM tool_movements')).toEqual({ n: 2 });
  });

  it('the latest movement can be moved to another day, but not to before the one before it', () => {
    move('issue', '2026-10-15');
    const back = move('return', '2026-10-18');
    expect(move('return', '2026-10-16', { id: back })).toBe(back);
    expect(refused(() => move('return', '2026-10-14', { id: back })).key).toBe('errDateBeforeLast');
    expect(first('SELECT day FROM tool_movements WHERE id = ?', [back])).toEqual({ day: '2026-10-16' });
  });

  it('an edit cannot turn the only movement of a tool into a return: a return needs an issue before it', () => {
    const only = move('issue', '2026-10-19');
    expect(refused(() => move('return', '2026-10-19', { id: only })).key).toBe('errToolState');
    expect(first('SELECT kind FROM tool_movements WHERE id = ?', [only])).toEqual({ kind: 'issue' });
  });

  it('a form id that is not saved yet is a new movement and is judged like one', () => {
    move('issue', '2026-10-19');
    expect(refused(() => move('issue', '2026-10-20', { id: '11111111-1111-4111-8111-111111111111', worker_id: sunil })).key).toBe('errToolState');
  });
});

describe('what is checked first', () => {
  it('an unknown tool is "choose a tool", not "enter a name"', () => {
    expect(refused(() => moveTool({ tool_id: 'nope', kind: 'issue', worker_id: nimal, day: '2026-10-19' }))).toEqual({ field: 'tool_id', key: 'errTool' });
    expect(refused(() => moveTool({ tool_id: '', kind: 'return', day: '2026-10-19' })).key).toBe('errTool');
    const gone = saveTool({ name: 'Gone' });
    deleteRecord('tools', gone);
    expect(refused(() => moveTool({ tool_id: gone, kind: 'issue', worker_id: nimal, day: '2026-10-19' })).key).toBe('errTool');
  });

  it('an issue with nobody to hand it to is still about the person, a bad date still about the date', () => {
    move('issue', '2026-10-19');
    expect(refused(() => move('issue', '2026-10-20', { worker_id: null, taken_by: null }))).toEqual({ field: 'taken_by', key: 'errWorker' });
    expect(refused(() => move('return', 'monday'))).toEqual({ field: 'day', key: 'errDate' });
  });
});

describe('the demo data and the tool tab flows still work', () => {
  it('returns the tools that are out and issues the ones that are in', () => {
    resetDb(); // the demo data is only made on an empty phone
    seedDemo();
    const id = (name: string) => first<{ id: string }>('SELECT id FROM tools WHERE name = ?', [name])?.id as string;
    const w = first<{ id: string }>('SELECT id FROM workers')?.id as string;
    const day = today();
    expect(refused(() => moveTool({ tool_id: id('Hilti drill'), kind: 'issue', worker_id: w, day })).key).toBe('errToolState');
    expect(() => moveTool({ tool_id: id('Hilti drill'), kind: 'return', worker_id: w, day })).not.toThrow();
    expect(() => moveTool({ tool_id: id('Total station'), kind: 'issue', worker_id: w, day })).not.toThrow();
    expect(refused(() => moveTool({ tool_id: id('Vibrator poker'), kind: 'return', worker_id: w, day })).key).toBe('errToolState');
    expect(() => moveTool({ tool_id: id('Aluminium ladder 12 ft'), kind: 'issue', worker_id: w, day })).not.toThrow(); // came back 4 days ago
  });
});

describe('what the person sees', () => {
  const KEYS = ['errTool', 'errToolState', 'errDateBeforeLast', 'errWorkDayExists', 'allToolsOut', 'noToolsOut'] as const;

  it.each(KEYS)('%s has its own words in English, Sinhala and Tamil', (key) => {
    for (const dict of [en, si, ta] as Record<string, string>[]) {
      expect(typeof dict[key]).toBe('string');
      expect(dict[key].trim().length).toBeGreaterThan(3);
    }
    expect(si[key]).not.toBe(en[key]);
    expect(ta[key]).not.toBe(en[key]);
  });

  it('English says what the owner asked for', () => {
    expect(en.errTool).toBe('Choose a tool');
    expect(en.errToolState).toBe('This tool is already out, or was already returned.');
    expect(en.errDateBeforeLast).toBe('Pick a day on or after the last record for this tool');
    expect(en.allToolsOut).toBe('All tools are already out');
    expect(en.noToolsOut).toBe('No tools are out right now');
    expect(en.errWorkDayExists).toBe('This worker already has a work entry for that day. Open it from the daily sheet to change it.');
  });

  it('a refused move leaves every table as it was', () => {
    const rows = () => Object.fromEntries(DATA_TABLES.map((t) => [t, first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n]));
    move('issue', '2026-10-19');
    const before = rows();
    expect(() => move('issue', '2026-10-20')).toThrow(ValidationError);
    expect(() => move('return', '2026-10-01')).toThrow(ValidationError);
    expect(rows()).toEqual(before);
  });
});
