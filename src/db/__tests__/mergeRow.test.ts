/**
 * mergeRow / classifyRow: how a row that comes from another phone meets the one already here.
 * Higher version wins; on a tie the later update wins; a deletion is just a newer version.
 */
import { all, classifyRow, first, mergeRow } from '@/db';
import { resetDb, silenceConsoleError } from '@/test-utils';

jest.setTimeout(60_000);

beforeEach(() => {
  resetDb();
});

const ID = '11111111-2222-4333-8444-555555555555';

function project(over: Record<string, string | number | null> = {}) {
  return {
    id: ID,
    created_at: '2026-10-01T04:00:00.000Z',
    updated_at: '2026-10-01T04:00:00.000Z',
    deleted_at: null,
    version: 1,
    device_id: 'other-phone',
    name: 'Welimada school',
    client: null,
    location: null,
    contract_cents: null,
    start_date: null,
    end_date: null,
    status: 'active',
    notes: null,
    ...over,
  };
}
const stored = () => first<Record<string, unknown>>('SELECT * FROM projects WHERE id = ?', [ID]);
const auditFor = () => all<{ action: string; device_id: string; data: string | null }>('SELECT action, device_id, data FROM audit_log WHERE row_id = ? ORDER BY seq', [ID]);

describe('a row this phone has never seen', () => {
  it('is inserted exactly as it arrived: version, times and device are the sender\'s', () => {
    const row = project({ version: 4, updated_at: '2026-10-05T09:30:00.000Z', device_id: 'phone-b' });
    expect(classifyRow('projects', row)).toBe('inserted');
    expect(mergeRow('projects', row)).toBe('inserted');
    expect(stored()).toEqual(row);
  });

  it('is audited as an import, with only its identity (the audit log stays small)', () => {
    mergeRow('projects', project({ version: 3 }));
    const [entry] = auditFor();
    expect(entry.action).toBe('import-insert');
    expect(JSON.parse(entry.data as string)).toEqual({ id: ID, version: 3 });
  });

  it('is inserted already deleted when it was deleted on the other phone', () => {
    mergeRow('projects', project({ version: 2, deleted_at: '2026-10-02T00:00:00.000Z' }));
    expect(stored()).toMatchObject({ version: 2, deleted_at: '2026-10-02T00:00:00.000Z' });
    expect(all('SELECT * FROM v_project_cost')).toEqual([]);
  });

  it('ignores columns this version of the app does not have (a newer sender)', () => {
    expect(mergeRow('projects', { ...project(), colour: 'blue' })).toBe('inserted');
    expect(stored()).toEqual(project());
  });
});

describe('a row this phone already has', () => {
  beforeEach(() => {
    mergeRow('projects', project({ version: 3, updated_at: '2026-10-03T00:00:00.000Z', name: 'Local v3' }));
  });

  it('a higher version replaces it', () => {
    const incoming = project({ version: 4, updated_at: '2026-10-04T00:00:00.000Z', name: 'Newer v4', device_id: 'phone-b' });
    expect(classifyRow('projects', incoming)).toBe('updated');
    expect(mergeRow('projects', incoming)).toBe('updated');
    expect(stored()).toEqual(incoming);
    expect(auditFor().map((a) => a.action)).toEqual(['import-insert', 'import-update']);
  });

  it('a lower version is skipped, even if it claims to be newer by the clock', () => {
    const incoming = project({ version: 2, updated_at: '2030-01-01T00:00:00.000Z', name: 'Older v2' });
    expect(classifyRow('projects', incoming)).toBe('skipped');
    expect(mergeRow('projects', incoming)).toBe('skipped');
    expect(stored()).toMatchObject({ name: 'Local v3', version: 3 });
  });

  it('the same version: the later update wins', () => {
    expect(mergeRow('projects', project({ version: 3, updated_at: '2026-10-03T00:00:01.000Z', name: 'Same version, later' }))).toBe('updated');
    expect(stored()).toMatchObject({ name: 'Same version, later' });
  });

  it('the same version and an earlier or identical update time is skipped', () => {
    expect(mergeRow('projects', project({ version: 3, updated_at: '2026-10-02T23:59:59.000Z', name: 'Same version, earlier' }))).toBe('skipped');
    expect(mergeRow('projects', project({ version: 3, updated_at: '2026-10-03T00:00:00.000Z', name: 'The very same' }))).toBe('skipped');
    expect(stored()).toMatchObject({ name: 'Local v3' });
  });

  it('skipping writes nothing: no audit entry, no change', () => {
    const before = auditFor().length;
    mergeRow('projects', project({ version: 1 }));
    mergeRow('projects', project({ version: 3, updated_at: '2026-10-03T00:00:00.000Z', name: 'Local v3' }));
    expect(auditFor()).toHaveLength(before);
  });

  it('a deletion with a higher version reaches this phone', () => {
    expect(mergeRow('projects', project({ version: 4, updated_at: '2026-10-04T00:00:00.000Z', deleted_at: '2026-10-04T00:00:00.000Z', name: 'Local v3' }))).toBe('updated');
    expect(stored()).toMatchObject({ version: 4, deleted_at: '2026-10-04T00:00:00.000Z' });
    expect(all('SELECT * FROM v_project_cost')).toEqual([]);
  });

  it('an older live copy never brings a deleted row back to life', () => {
    mergeRow('projects', project({ version: 5, updated_at: '2026-10-05T00:00:00.000Z', deleted_at: '2026-10-05T00:00:00.000Z' }));
    expect(mergeRow('projects', project({ version: 4, updated_at: '2026-10-06T00:00:00.000Z', deleted_at: null, name: 'Resurrected?' }))).toBe('skipped');
    expect(stored()).toMatchObject({ version: 5, deleted_at: '2026-10-05T00:00:00.000Z' });
  });

  it('applying the same row twice changes nothing the second time', () => {
    const incoming = project({ version: 7, updated_at: '2026-10-07T00:00:00.000Z', name: 'v7' });
    expect(mergeRow('projects', incoming)).toBe('updated');
    const after = stored();
    expect(mergeRow('projects', incoming)).toBe('skipped');
    expect(stored()).toEqual(after);
  });

  it('a version that arrives as text is compared as a number (9 < 10)', () => {
    mergeRow('projects', project({ version: 9, updated_at: '2026-10-09T00:00:00.000Z' }));
    expect(classifyRow('projects', project({ version: '10' as unknown as number, updated_at: '2026-10-01T00:00:00.000Z' }))).toBe('updated');
    expect(classifyRow('projects', project({ version: '8' as unknown as number }))).toBe('skipped');
  });
});

describe('order does not matter', () => {
  const v = (n: number) => project({ version: n, updated_at: `2026-10-0${n}T00:00:00.000Z`, name: `v${n}`, device_id: `phone-${n}` });
  const permutations = [
    [1, 2, 3],
    [1, 3, 2],
    [2, 1, 3],
    [2, 3, 1],
    [3, 1, 2],
    [3, 2, 1],
  ];

  it.each(permutations.map((p) => [p.join(' then '), p] as const))('versions arriving %s end with version 3', (_label, order) => {
    resetDb();
    for (const n of order) mergeRow('projects', v(n));
    expect(stored()).toEqual(v(3));
  });

  it('two phones that edited the same version: both end with the later edit', () => {
    const a = project({ version: 2, updated_at: '2026-10-02T08:00:00.000Z', name: 'Edited on A', device_id: 'a' });
    const b = project({ version: 2, updated_at: '2026-10-02T09:00:00.000Z', name: 'Edited on B', device_id: 'b' });
    mergeRow('projects', a);
    mergeRow('projects', b);
    expect(stored()).toEqual(b);
    resetDb();
    mergeRow('projects', b);
    mergeRow('projects', a);
    expect(stored()).toEqual(b);
  });
});

describe('bad input', () => {
  it('a row without an id is skipped', () => {
    expect(classifyRow('projects', { name: 'no id' })).toBe('skipped');
    expect(mergeRow('projects', { name: 'no id' })).toBe('skipped');
    expect(classifyRow('projects', { id: '', name: 'empty id' })).toBe('skipped');
    expect(all('SELECT id FROM projects')).toEqual([]);
  });

  it('a table that is not business data is refused', () => {
    expect(() => mergeRow('audit_log' as never, { id: 'x' })).toThrow('Unknown table audit_log');
    expect(() => classifyRow('sqlite_master' as never, { id: 'x' })).toThrow('Unknown table');
  });

  it('a row the database rejects throws and stores nothing', () => {
    const mute = silenceConsoleError();
    expect(() => mergeRow('projects', project({ name: '   ' }))).toThrow(/constraint/i);
    expect(() => mergeRow('projects', project({ id: 'p2', status: 'cancelled' }))).toThrow(/constraint/i);
    mute.mockRestore();
    expect(all('SELECT id FROM projects')).toEqual([]);
  });

  it('a row that updates an existing one but breaks a rule leaves the existing one as it was', () => {
    mergeRow('projects', project({ version: 1 }));
    const before = stored();
    const mute = silenceConsoleError();
    expect(() => mergeRow('projects', project({ version: 2, updated_at: '2026-10-09T00:00:00.000Z', name: '' }))).toThrow(/constraint/i);
    mute.mockRestore();
    expect(stored()).toEqual(before);
  });
});
