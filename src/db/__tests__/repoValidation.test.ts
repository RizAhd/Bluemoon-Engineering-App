/**
 * Every domain write checks its input before it reaches the database. A refused write must
 * name the field and the translation key, and must leave no row and no audit entry behind.
 */
import { all, first, newId } from '@/db';
import {
  deleteRecord,
  moveTool,
  saveExpense,
  saveNote,
  saveProject,
  saveTool,
  saveWageEntry,
  saveWorker,
  ValidationError,
} from '@/db/repo';
import { DATA_TABLES } from '@/db/schema';
import { en } from '@/i18n/en';
import { si } from '@/i18n/si';
import { ta } from '@/i18n/ta';
import { friendlyMessage } from '@/lib/errors';
import { resetDb, silenceConsoleError } from '@/test-utils';

jest.setTimeout(60_000);

let project: string;
let worker: string;
let tool: string;

beforeEach(() => {
  resetDb();
  project = saveProject({ name: 'Welimada school' });
  worker = saveWorker({ name: 'Nimal', daily_rate_cents: 350_000 });
  tool = saveTool({ name: 'Drill' });
});

function snapshot() {
  return {
    audit: first<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n,
    tables: Object.fromEntries(DATA_TABLES.map((t) => [t, first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n])),
  };
}

/** The refused write: returns {field, key}, and proves nothing was written. */
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
  const err = caught as ValidationError;
  return { field: err.field, key: err.key };
}

const expense = (over: Partial<Parameters<typeof saveExpense>[0]> = {}) =>
  saveExpense({ project_id: project, day: '2026-10-21', category: 'materials', amount_cents: 250_000, method: 'cash', ...over });
const wage = (over: Partial<Parameters<typeof saveWageEntry>[0]> = {}) =>
  saveWageEntry({ worker_id: worker, project_id: project, day: '2026-10-21', kind: 'payment', amount_cents: 100_000, ...over });

describe('saveProject', () => {
  it.each([['empty', ''], ['spaces', '   '], ['tabs and newlines', ' \t\n ']])('refuses a %s name', (_label, name) => {
    expect(refused(() => saveProject({ name }))).toEqual({ field: 'name', key: 'errName' });
  });

  it.each(['2026-13-01', '2026-02-30', '2026-00-10', '26-1-1', '2026/10/21', '21-10-2026', 'today', '2026-10-2'])('refuses the start date %s', (d) => {
    expect(refused(() => saveProject({ name: 'X', start_date: d }))).toEqual({ field: 'start_date', key: 'errDate' });
  });

  it('refuses a bad end date and names that field', () => {
    expect(refused(() => saveProject({ name: 'X', end_date: '2026-02-31' }))).toEqual({ field: 'end_date', key: 'errDate' });
  });

  it('accepts a leap day and rejects the same day in a normal year', () => {
    expect(() => saveProject({ name: 'Leap', start_date: '2028-02-29' })).not.toThrow();
    expect(refused(() => saveProject({ name: 'Not leap', start_date: '2026-02-29' })).field).toBe('start_date');
  });

  it.each([-1, 12.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60])('refuses the contract value %p (whole, non-negative cents only)', (cents) => {
    expect(refused(() => saveProject({ name: 'X', contract_cents: cents }))).toEqual({ field: 'contract', key: 'errAmount' });
  });

  it('accepts no contract value, a zero contract and a Rs 18.5 million contract', () => {
    const none = saveProject({ name: 'None' });
    const zero = saveProject({ name: 'Zero', contract_cents: 0 });
    const big = saveProject({ name: 'Big', contract_cents: 1_850_000_000 });
    expect(first('SELECT contract_cents FROM projects WHERE id = ?', [none])).toEqual({ contract_cents: null });
    expect(first('SELECT contract_cents FROM projects WHERE id = ?', [zero])).toEqual({ contract_cents: 0 });
    expect(first('SELECT contract_cents, typeof(contract_cents) AS t FROM projects WHERE id = ?', [big])).toEqual({ contract_cents: 1_850_000_000, t: 'integer' });
  });

  it('trims text, stores blanks as NULL and defaults the status to active', () => {
    const id = saveProject({ name: '  Culvert  ', client: '  RDA  ', location: '   ', notes: '' });
    expect(first('SELECT name, client, location, notes, status FROM projects WHERE id = ?', [id])).toEqual({
      name: 'Culvert',
      client: 'RDA',
      location: null,
      notes: null,
      status: 'active',
    });
  });

  it('a status outside active / on_hold / completed is stopped by the database', () => {
    const mute = silenceConsoleError();
    const before = snapshot();
    expect(() => saveProject({ name: 'X', status: 'cancelled' as never })).toThrow(/constraint/i);
    expect(snapshot()).toEqual(before);
    mute.mockRestore();
  });

  it('an edit that fails validation leaves the saved project as it was', () => {
    const before = first('SELECT * FROM projects WHERE id = ?', [project]);
    expect(refused(() => saveProject({ id: project, name: '' })).field).toBe('name');
    expect(first('SELECT * FROM projects WHERE id = ?', [project])).toEqual(before);
  });
});

describe('saveExpense', () => {
  it.each([
    ['no project', null],
    ['an unknown project', newId()],
  ])('refuses %s', (_label, project_id) => {
    expect(refused(() => expense({ project_id }))).toEqual({ field: 'project_id', key: 'errProject' });
  });

  it('refuses a project that was deleted', () => {
    const gone = saveProject({ name: 'Gone' });
    deleteRecord('projects', gone);
    expect(refused(() => expense({ project_id: gone })).field).toBe('project_id');
  });

  it('refuses an expense without a category', () => {
    expect(refused(() => expense({ category: null })).field).toBe('category');
  });

  it.each(['', '2026-1-1', '2026-02-30', '31/12/2026', 'yesterday'])('refuses the day %p', (d) => {
    expect(refused(() => expense({ day: d }))).toEqual({ field: 'day', key: 'errDate' });
  });

  it.each([null, 0, -1, -250_000, 0.5, 2500.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])('refuses the amount %p', (amount) => {
    expect(refused(() => expense({ amount_cents: amount }))).toEqual({ field: 'amount', key: 'errAmount' });
  });

  it('accepts the smallest amount (1 cent) and a very large one, stored as integers', () => {
    const one = expense({ amount_cents: 1 });
    const large = expense({ amount_cents: 99_999_999_999 });
    expect(first('SELECT amount_cents, typeof(amount_cents) AS t FROM expenses WHERE id = ?', [one])).toEqual({ amount_cents: 1, t: 'integer' });
    expect(first('SELECT amount_cents FROM expenses WHERE id = ?', [large])).toEqual({ amount_cents: 99_999_999_999 });
  });

  it('a payment method outside cash / bank / cheque is stopped by the database', () => {
    const mute = silenceConsoleError();
    expect(() => expense({ method: 'credit' as never })).toThrow(/constraint/i);
    mute.mockRestore();
  });

  it('trims paid_to and note, and stores blanks as NULL', () => {
    const id = expense({ paid_to: '  Uva Hardware ', note: '   ' });
    expect(first('SELECT paid_to, note FROM expenses WHERE id = ?', [id])).toEqual({ paid_to: 'Uva Hardware', note: null });
  });
});

describe('saveWorker', () => {
  it('refuses a blank name', () => {
    expect(refused(() => saveWorker({ name: '  ', daily_rate_cents: 100 }))).toEqual({ field: 'name', key: 'errName' });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses the daily rate %p', (rate) => {
    expect(refused(() => saveWorker({ name: 'X', daily_rate_cents: rate }))).toEqual({ field: 'daily_rate', key: 'errAmount' });
  });

  it('a missing rate means 0 (the rate is agreed per project), and 0 is allowed', () => {
    const none = saveWorker({ name: 'No rate', daily_rate_cents: null });
    const zero = saveWorker({ name: 'Zero', daily_rate_cents: 0 });
    expect(first('SELECT daily_rate_cents FROM workers WHERE id = ?', [none])).toEqual({ daily_rate_cents: 0 });
    expect(first('SELECT daily_rate_cents FROM workers WHERE id = ?', [zero])).toEqual({ daily_rate_cents: 0 });
  });

  it('active defaults to 1, false stores 0, and phone/trade are trimmed', () => {
    const a = saveWorker({ name: 'A', daily_rate_cents: 1, phone: ' 0771234567 ', trade: ' Mason ' });
    const b = saveWorker({ name: 'B', daily_rate_cents: 1, active: false });
    expect(first('SELECT active, phone, trade FROM workers WHERE id = ?', [a])).toEqual({ active: 1, phone: '0771234567', trade: 'Mason' });
    expect(first('SELECT active FROM workers WHERE id = ?', [b])).toEqual({ active: 0 });
  });
});

describe('saveWageEntry', () => {
  it.each([
    ['no worker', { worker_id: null }, 'worker_id', 'errWorker'],
    ['an unknown worker', { worker_id: 'nobody' }, 'worker_id', 'errWorker'],
    ['no project (every wage entry belongs to a project now)', { project_id: null }, 'project_id', 'errProject'],
    ['an unknown project', { project_id: 'nowhere' }, 'project_id', 'errProject'],
    ['a bad day', { day: '2026-02-30' }, 'day', 'errDate'],
    ['a zero amount', { amount_cents: 0 }, 'amount', 'errAmount'],
    ['a negative amount', { amount_cents: -5 }, 'amount', 'errAmount'],
    ['a fractional amount', { amount_cents: 99.5 }, 'amount', 'errAmount'],
    ['no amount', { amount_cents: null }, 'amount', 'errAmount'],
  ] as const)('refuses %s', (_label, over, field, key) => {
    expect(refused(() => wage(over as never))).toEqual({ field, key });
  });

  it.each([null, undefined, 0, -1, 31.5, 32, 100, Number.NaN, Number.POSITIVE_INFINITY])('refuses a work entry with days = %p', (days) => {
    expect(refused(() => wage({ kind: 'work', days: days as number }))).toEqual({ field: 'days', key: 'errDays' });
  });

  it.each([0.25, 0.5, 1, 1.5, 2, 31])('accepts %p days of work', (days) => {
    const id = wage({ kind: 'work', days, amount_cents: 350_000 });
    expect(first('SELECT days FROM wage_entries WHERE id = ?', [id])).toEqual({ days });
  });

  it('days only apply to work: an advance or payment stores NULL days even if some are passed', () => {
    const adv = wage({ kind: 'advance', days: 3 });
    const pay = wage({ kind: 'payment', days: 3 });
    expect(all('SELECT days FROM wage_entries WHERE id IN (?, ?)', [adv, pay])).toEqual([{ days: null }, { days: null }]);
  });

  it('an unknown kind is stopped by the database', () => {
    const mute = silenceConsoleError();
    expect(() => wage({ kind: 'bonus' as never })).toThrow(/constraint/i);
    mute.mockRestore();
  });
});

describe('saveTool and saveNote', () => {
  it('saveTool refuses a blank name and trims code and notes', () => {
    expect(refused(() => saveTool({ name: ' ' }))).toEqual({ field: 'name', key: 'errName' });
    const id = saveTool({ name: ' Mixer ', code: ' BM-T-002 ', notes: '  ' });
    expect(first('SELECT name, code, notes FROM tools WHERE id = ?', [id])).toEqual({ name: 'Mixer', code: 'BM-T-002', notes: null });
  });

  it('saveNote needs a real project, a body and a valid day', () => {
    const ok = { project_id: project, day: '2026-10-21', body: 'Slab poured' };
    expect(refused(() => saveNote({ ...ok, project_id: null }))).toEqual({ field: 'project_id', key: 'errProject' });
    expect(refused(() => saveNote({ ...ok, project_id: 'x' }))).toEqual({ field: 'project_id', key: 'errProject' });
    expect(refused(() => saveNote({ ...ok, body: '   ' }))).toEqual({ field: 'body', key: 'errNote' });
    expect(refused(() => saveNote({ ...ok, day: '2026-99-99' }))).toEqual({ field: 'day', key: 'errDate' });
  });

  it('saveNote trims the body and weather', () => {
    const id = saveNote({ project_id: project, day: '2026-10-21', body: '  Rain stopped work.  ', weather: ' rain ' });
    expect(first('SELECT body, weather FROM site_notes WHERE id = ?', [id])).toEqual({ body: 'Rain stopped work.', weather: 'rain' });
  });
});

describe('moveTool', () => {
  const issue = (over: Partial<Parameters<typeof moveTool>[0]> = {}) =>
    moveTool({ tool_id: tool, kind: 'issue', worker_id: worker, day: '2026-10-21', ...over });

  it('refuses an unknown tool', () => {
    expect(refused(() => issue({ tool_id: 'nope' })).field).toBe('tool_id');
  });

  it('an issue needs someone to hand the tool to: a worker or a name', () => {
    expect(refused(() => issue({ worker_id: null, taken_by: null }))).toEqual({ field: 'taken_by', key: 'errWorker' });
    expect(refused(() => issue({ worker_id: null, taken_by: '   ' })).field).toBe('taken_by');
    expect(() => issue({ worker_id: null, taken_by: 'Contractor Silva' })).not.toThrow();
    expect(() => issue({ worker_id: worker, taken_by: null })).not.toThrow();
  });

  it('a return does not need to name anybody', () => {
    expect(() => moveTool({ tool_id: tool, kind: 'return', day: '2026-10-22' })).not.toThrow();
  });

  it('refuses a bad day', () => {
    expect(refused(() => issue({ day: 'monday' }))).toEqual({ field: 'day', key: 'errDate' });
  });

  it('a movement to a worker or project that does not exist is stopped by the foreign key', () => {
    const mute = silenceConsoleError();
    const before = snapshot();
    expect(() => issue({ worker_id: newId() })).toThrow(/FOREIGN KEY|constraint/i);
    expect(() => issue({ project_id: newId() })).toThrow(/FOREIGN KEY|constraint/i);
    expect(snapshot()).toEqual(before);
    mute.mockRestore();
  });
});

describe('what the person sees', () => {
  const KEYS = ['errName', 'errProject', 'errAmount', 'errDate', 'errDays', 'errNote', 'errWorker', 'rateRequired'] as const;

  it.each(KEYS)('%s has its own words in English, Sinhala and Tamil', (key) => {
    for (const dict of [en, si, ta] as Record<string, string>[]) {
      expect(typeof dict[key]).toBe('string');
      expect(dict[key].trim().length).toBeGreaterThan(3);
    }
    expect(si[key]).not.toBe(en[key]);
    expect(ta[key]).not.toBe(en[key]);
  });

  it('friendlyMessage turns a ValidationError into the sentence for its key', () => {
    const err = refusedError(() => saveProject({ name: '' }));
    expect(friendlyMessage(err, (k) => `<${k}>`)).toBe('<errName>');
    expect(err.message).toBe('name: errName');
  });
});

function refusedError(write: () => unknown): ValidationError {
  try {
    write();
  } catch (e) {
    if (e instanceof ValidationError) return e;
  }
  throw new Error('expected a ValidationError');
}
