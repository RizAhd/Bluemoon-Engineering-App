/**
 * tx(): a group of writes is all-or-nothing, also when nested, and also after something
 * went wrong earlier (a busy database must not leave later writes unprotected).
 */
import * as SQLite from 'expo-sqlite';

import { all, DB_NAME, first, getDb, save, tx } from '@/db';
import { saveExpense, saveProject, saveWorker } from '@/db/repo';
import { resetDb, silenceConsoleError } from '@/test-utils';

jest.setTimeout(60_000);

beforeEach(() => {
  resetDb();
});

const projects = () => all<{ name: string }>('SELECT name FROM projects ORDER BY name').map((r) => r.name);
const audit = () => first<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n ?? 0;

describe('tx', () => {
  it('returns what the function returns and commits', () => {
    const out = tx(() => {
      saveProject({ name: 'A' });
      return 42;
    });
    expect(out).toBe(42);
    expect(projects()).toEqual(['A']);
    expect(getDb().isInTransactionSync()).toBe(false);
  });

  it('rolls everything back, rows and audit entries, when the function throws', () => {
    saveProject({ name: 'Before' });
    const n = audit();
    expect(() =>
      tx(() => {
        saveProject({ name: 'In tx 1' });
        saveProject({ name: 'In tx 2' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(projects()).toEqual(['Before']);
    expect(audit()).toBe(n);
    expect(getDb().isInTransactionSync()).toBe(false);
  });

  it('nested calls join the outer transaction: a failure in the inner one undoes the outer one too', () => {
    expect(() =>
      tx(() => {
        saveProject({ name: 'Outer' });
        tx(() => {
          saveProject({ name: 'Inner' });
          throw new Error('inner failed');
        });
      }),
    ).toThrow('inner failed');
    expect(projects()).toEqual([]);
  });

  it('a domain write that fails validation in the middle of a bigger operation undoes the earlier steps', () => {
    const mute = silenceConsoleError();
    const p = saveProject({ name: 'P' });
    expect(() =>
      tx(() => {
        saveWorker({ name: 'Created first', daily_rate_cents: 100 });
        saveExpense({ project_id: p, day: '2026-10-20', category: 'fuel', amount_cents: 0, method: 'cash' });
      }),
    ).toThrow();
    mute.mockRestore();
    expect(all('SELECT name FROM workers')).toEqual([]);
  });

  it('a nested success is committed once, with the outer', () => {
    tx(() => {
      saveProject({ name: 'A' });
      tx(() => saveProject({ name: 'B' }));
      saveProject({ name: 'C' });
    });
    expect(projects()).toEqual(['A', 'B', 'C']);
  });

  it('works again after a failure: the next group is again all-or-nothing', () => {
    expect(() =>
      tx(() => {
        saveProject({ name: 'X' });
        throw new Error('first');
      }),
    ).toThrow('first');
    expect(() =>
      tx(() => {
        saveProject({ name: 'Y' });
        throw new Error('second');
      }),
    ).toThrow('second');
    expect(projects()).toEqual([]);
    tx(() => saveProject({ name: 'Z' }));
    expect(projects()).toEqual(['Z']);
  });

  it('a single save() outside tx is atomic with its own audit entry', () => {
    const mute = silenceConsoleError();
    const p = saveProject({ name: 'P' });
    const n = audit();
    expect(() => save('expenses', { project_id: p, day: '2026-10-20', category: 'fuel', amount_cents: -1, method: 'cash' })).toThrow();
    mute.mockRestore();
    expect(audit()).toBe(n);
  });

  it('reports the original error when SQLite already rolled the transaction back itself', () => {
    expect(() =>
      tx(() => {
        saveProject({ name: 'X' });
        getDb().execSync('ROLLBACK'); // what SQLite does by itself on e.g. "disk full"
        throw new Error('database or disk is full');
      }),
    ).toThrow('database or disk is full');
    expect(projects()).toEqual([]);
    tx(() => saveProject({ name: 'Y' }));
    expect(projects()).toEqual(['Y']);
  });
});

describe('when the database is busy', () => {
  /** A second connection to the same file that holds the write lock, like another process would. */
  function lockedByAnother() {
    const other = SQLite.openDatabaseSync(DB_NAME);
    other.execSync('BEGIN IMMEDIATE');
    return {
      release() {
        other.execSync('ROLLBACK');
        other.closeSync();
      },
    };
  }

  it('a write is refused cleanly and nothing is saved; later writes are still all-or-nothing', () => {
    resetDb({ fileDb: true });
    saveProject({ name: 'Existing' });
    const mute = silenceConsoleError();

    const lock = lockedByAnother();
    expect(() => saveProject({ name: 'During the lock' })).toThrow(/locked|busy/i);
    lock.release();

    // The failed BEGIN must not leave the data layer thinking a transaction is open:
    // a later group that fails has to undo its earlier steps.
    expect(() =>
      tx(() => {
        saveProject({ name: 'Half of a group' });
        throw new Error('later step failed');
      }),
    ).toThrow('later step failed');
    mute.mockRestore();

    expect(projects()).toEqual(['Existing']);
    saveProject({ name: 'After the lock' });
    expect(projects()).toEqual(['After the lock', 'Existing']);
  });

  it('a nested failure after a busy refusal still rolls back the whole outer group', () => {
    resetDb({ fileDb: true });
    getDb(); // the app has the file open (and migrated) before the other process takes the lock
    const mute = silenceConsoleError();
    const lock = lockedByAnother();
    expect(() => tx(() => saveProject({ name: 'Never' }))).toThrow(/locked|busy/i);
    lock.release();

    expect(() =>
      tx(() => {
        saveProject({ name: 'Outer' });
        tx(() => {
          saveProject({ name: 'Inner' });
          throw new Error('inner');
        });
      }),
    ).toThrow('inner');
    mute.mockRestore();
    expect(projects()).toEqual([]);
  });
});
