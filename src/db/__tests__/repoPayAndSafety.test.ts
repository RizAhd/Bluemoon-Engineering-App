/**
 * Paying a worker with the work in one save, the new amount limit, the merge cleanup of a doubled work day, and the
 * business settings that now travel inside backups.
 */
import { all, first, getSetting, mergeRow, newId, setSetting } from '@/db';
import { assignWorker, MAX_ENTRY_CENTS, payWages, recordWorkAndPay, saveProject, saveWageEntry, saveWorker, ValidationError } from '@/db/repo';
import type { WageEntry } from '@/db/types';
import { dataMark } from '@/lib/autoBackup';
import { applyBundle, applySettings, collectAll, collectSettings } from '@/lib/bundle';
import { nowIso } from '@/lib/dates';
import { dayWage } from '@/lib/wages';
import { resetDb } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

const DAY = '2026-10-20';
let school: string;
let nimal: string;
let clock: ReturnType<typeof useClock>;

beforeEach(() => {
  resetDb();
  clock = useClock('2026-10-20T04:00:00.000Z');
  school = saveProject({ name: 'Welimada school' });
  nimal = saveWorker({ name: 'Nimal Perera', daily_rate_cents: 350_000 });
  assignWorker({ project_id: school, worker_id: nimal, rate_cents: 350_000 });
});
afterEach(() => clock.restore());

const live = (kind: string) => all<WageEntry>('SELECT * FROM wage_entries WHERE kind = ? AND deleted_at IS NULL ORDER BY created_at, id', [kind]);
const work = { worker_id: '', project_id: '', day: DAY, days: 1, amount_cents: 350_000, note: null };

describe('recordWorkAndPay: one save for the work and the payment', () => {
  it('records the day and the payment together', () => {
    recordWorkAndPay({ ...work, worker_id: nimal, project_id: school }, 200_000);
    expect(live('work').map((e) => e.amount_cents)).toEqual([350_000]);
    expect(live('payment').map((e) => e.amount_cents)).toEqual([200_000]);
    expect(first<{ b: number }>('SELECT balance_cents AS b FROM v_project_worker_balance WHERE worker_id = ?', [nimal])?.b).toBe(150_000);
  });

  it('with nothing to pay it records only the work', () => {
    recordWorkAndPay({ ...work, worker_id: nimal, project_id: school }, 0);
    expect(live('work')).toHaveLength(1);
    expect(live('payment')).toHaveLength(0);
  });

  it('a payment that cannot be saved takes the work back with it: both or neither', () => {
    expect(() => recordWorkAndPay({ ...work, worker_id: nimal, project_id: school }, MAX_ENTRY_CENTS + 1)).toThrow(ValidationError);
    expect(live('work')).toHaveLength(0);
    expect(live('payment')).toHaveLength(0);
  });

  it('a bad pay amount is reported on the Pay now box and nothing is saved', () => {
    for (const bad of [Number.NaN, -5, 1.5]) {
      let error: ValidationError | undefined;
      try {
        recordWorkAndPay({ ...work, worker_id: nimal, project_id: school }, bad);
      } catch (e) {
        error = e as ValidationError;
      }
      expect(error?.field).toBe('pay');
      expect(error?.key).toBe('errAmount');
    }
    expect(live('work')).toHaveLength(0);
  });

  it('refuses a second work row for the same day, as saveWageEntry always did, and pays nothing', () => {
    recordWorkAndPay({ ...work, worker_id: nimal, project_id: school }, 0);
    expect(() => recordWorkAndPay({ ...work, worker_id: nimal, project_id: school }, 100_000)).toThrow('errWorkDayExists');
    expect(live('payment')).toHaveLength(0);
  });
});

describe('the limit on one amount', () => {
  it('accepts Rs 100,000,000 and refuses a cent more, with its own message', () => {
    expect(() => payWages({ project_id: school, worker_id: nimal, day: DAY, amount_cents: MAX_ENTRY_CENTS })).not.toThrow();
    let error: ValidationError | undefined;
    try {
      saveWageEntry({ worker_id: nimal, project_id: school, day: DAY, kind: 'advance', amount_cents: MAX_ENTRY_CENTS + 1 });
    } catch (e) {
      error = e as ValidationError;
    }
    expect(error?.key).toBe('errAmountTooBig');
  });
});

describe('dayWage: days x rate, half up, in whole numbers', () => {
  it('has no float error and rounds half up', () => {
    expect(dayWage(0.29, 100_050)).toBe(29_015); // 0.29 x Rs 1,000.50 = Rs 290.145
    expect(dayWage(1.5, 350_000)).toBe(525_000);
    expect(dayWage(0.1 + 0.2, 100_000)).toBe(30_000); // 0.30000000000000004 days is 0.3
    expect(dayWage(2, 1)).toBe(2);
  });
});

describe('joining two phones: a doubled work day is kept once', () => {
  function otherPhonesWork(days: number, amount: number, updatedAt: string): string {
    const id = newId();
    mergeRow('wage_entries', {
      id,
      created_at: updatedAt,
      updated_at: updatedAt,
      deleted_at: null,
      version: 1,
      device_id: 'other-phone',
      worker_id: nimal,
      project_id: school,
      day: DAY,
      kind: 'work',
      days,
      amount_cents: amount,
      note: null,
    });
    return id;
  }

  it('keeps the newest edit and removes the other, so no total counts the day twice', async () => {
    recordWorkAndPay({ ...work, worker_id: nimal, project_id: school }, 0); // this phone's own record
    const theirs = otherPhonesWork(1, 360_000, new Date(Date.now() + 60_000).toISOString());
    expect(live('work')).toHaveLength(2); // the merge path allows it: this is the doubled day
    // a PDF / backup import runs the cleanup after merging its rows
    await applyBundle({ wage_entries: [] }, new Map());
    const left = live('work');
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe(theirs);
    expect(first<{ c: number }>('SELECT labour_cents AS c FROM v_project_cost WHERE project_id = ?', [school])?.c).toBe(360_000);
  });

  it('leaves different days and different workers alone', async () => {
    recordWorkAndPay({ ...work, worker_id: nimal, project_id: school }, 0);
    recordWorkAndPay({ ...work, worker_id: nimal, project_id: school, day: '2026-10-19' }, 0);
    const sunil = saveWorker({ name: 'Sunil', daily_rate_cents: 100_000 });
    assignWorker({ project_id: school, worker_id: sunil, rate_cents: 100_000 });
    recordWorkAndPay({ ...work, worker_id: sunil, project_id: school, amount_cents: 100_000 }, 0);
    await applyBundle({ wage_entries: [] }, new Map());
    expect(live('work')).toHaveLength(3);
  });
});

describe('business settings travel inside backups', () => {
  it('carries the company and bank details, estimate counters and language; not the phone-only settings', () => {
    setSetting('company_name', 'Bluemoon Engineering (Pvt) Ltd');
    setSetting('company_bank_name', 'Bank of Ceylon');
    setSetting('company_account_no', '0071234567');
    setSetting('estimate_seq_2026', '7');
    setSetting('lang', 'si');
    setSetting('backup_folder_uri', 'content://somewhere');
    setSetting('drive_email', 'owner@gmail.com');
    setSetting('company_account_name', ''); // empty values do not travel
    expect(collectSettings()).toEqual({
      company_name: 'Bluemoon Engineering (Pvt) Ltd',
      company_bank_name: 'Bank of Ceylon',
      company_account_no: '0071234567',
      estimate_seq_2026: '7',
      lang: 'si',
    });
  });

  it('on a new phone fills what is empty, keeps what is set, and never lowers an estimate counter', () => {
    setSetting('company_name', 'My own name');
    setSetting('estimate_seq_2026', '9');
    applySettings({ company_name: 'From the backup', company_bank_name: 'Bank of Ceylon', estimate_seq_2026: '7', estimate_seq_2025: '40', backup_folder_uri: 'x' });
    expect(getSetting('company_name')).toBe('My own name');
    expect(getSetting('company_bank_name')).toBe('Bank of Ceylon');
    expect(getSetting('estimate_seq_2026')).toBe('9');
    expect(getSetting('estimate_seq_2025')).toBe('40');
    expect(getSetting('backup_folder_uri')).toBeNull(); // not a business setting: ignored
    applySettings({ estimate_seq_2026: '12' });
    expect(getSetting('estimate_seq_2026')).toBe('12');
    applySettings(undefined); // an old backup has no settings: nothing happens
  });

  it('changing the bank details redoes today\'s snapshot (the change fingerprint moves)', () => {
    const before = dataMark();
    expect(dataMark()).toBe(before);
    setSetting('company_bank_name', 'Bank of Ceylon');
    expect(dataMark()).not.toBe(before);
    expect(Object.keys(collectAll())).toContain('wage_entries');
  });
});
