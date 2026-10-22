import { addDays, daysSince, formatDay, isValidDay, nowIso, toDay, today } from '@/lib/dates';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

describe('toDay', () => {
  it('formats a local date as YYYY-MM-DD with zero padding', () => {
    expect(toDay(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDay(new Date(2026, 9, 22))).toBe('2026-10-22');
    expect(toDay(new Date(2026, 11, 31))).toBe('2026-12-31');
    expect(toDay(new Date(2028, 1, 29))).toBe('2028-02-29');
  });

  it('uses the local calendar day, whatever the time of day', () => {
    expect(toDay(new Date(2026, 0, 5, 0, 0, 1))).toBe('2026-01-05');
    expect(toDay(new Date(2026, 0, 5, 23, 59, 59))).toBe('2026-01-05');
  });
});

describe('today', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns the current local day', () => {
    jest.setSystemTime(new Date(2026, 9, 22, 12, 0, 0));
    expect(today()).toBe('2026-10-22');
  });

  it('rolls over at local midnight', () => {
    jest.setSystemTime(new Date(2026, 11, 31, 23, 59, 59));
    expect(today()).toBe('2026-12-31');
    jest.setSystemTime(new Date(2027, 0, 1, 0, 0, 0));
    expect(today()).toBe('2027-01-01');
  });
});

describe('nowIso', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns the current instant as a UTC ISO timestamp', () => {
    jest.setSystemTime(new Date(Date.UTC(2026, 9, 22, 6, 30, 0)));
    expect(nowIso()).toBe('2026-10-22T06:30:00.000Z');
  });
});

describe('addDays', () => {
  it('adds and subtracts days within a month', () => {
    expect(addDays('2026-10-22', 0)).toBe('2026-10-22');
    expect(addDays('2026-10-22', 1)).toBe('2026-10-23');
    expect(addDays('2026-10-22', -1)).toBe('2026-10-21');
    expect(addDays('2026-10-01', 7)).toBe('2026-10-08');
  });

  it('crosses month ends in both directions', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-02-01', -1)).toBe('2026-01-31');
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-01-31', 31)).toBe('2026-03-03');
    expect(addDays('2026-03-15', -45)).toBe('2026-01-29');
  });

  it('crosses year ends in both directions', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
    expect(addDays('2028-01-01', 366)).toBe('2029-01-01');
    expect(addDays('2027-01-01', -365)).toBe('2026-01-01');
  });

  it('handles leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 365)).toBe('2029-02-28');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01'); // not a leap year
    expect(addDays('2100-02-28', 1)).toBe('2100-03-01'); // century rule
  });

  it('keeps the zero padding', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-10-10', -1)).toBe('2026-10-09');
  });

  it('is consistent with itself', () => {
    let day = '2027-12-20';
    for (let i = 0; i < 400; i++) {
      const next = addDays(day, 1);
      expect(addDays(next, -1)).toBe(day);
      expect(addDays(day, 30)).toBe(addDays(addDays(day, 10), 20));
      day = next;
    }
    expect(day).toBe('2029-01-23');
  });
});

describe('formatDay', () => {
  it('renders "D Mon YYYY"', () => {
    expect(formatDay('2026-10-21')).toBe('21 Oct 2026');
    expect(formatDay('2026-01-05')).toBe('5 Jan 2026');
    expect(formatDay('2028-02-29')).toBe('29 Feb 2028');
    expect(formatDay('2026-12-31')).toBe('31 Dec 2026');
  });

  it('knows every month name', () => {
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    names.forEach((name, i) => {
      expect(formatDay(`2026-${String(i + 1).padStart(2, '0')}-10`)).toBe(`10 ${name} 2026`);
    });
  });

  it('returns input it cannot parse unchanged', () => {
    expect(formatDay('')).toBe('');
    expect(formatDay('never')).toBe('never');
    expect(formatDay('2026-00-10')).toBe('2026-00-10');
    expect(formatDay('2026-10-00')).toBe('2026-10-00');
  });
});

describe('isValidDay', () => {
  it('accepts real calendar days', () => {
    expect(isValidDay('2026-10-22')).toBe(true);
    expect(isValidDay('2026-01-01')).toBe(true);
    expect(isValidDay('2026-12-31')).toBe(true);
    expect(isValidDay('2026-04-30')).toBe(true);
    expect(isValidDay('2026-02-28')).toBe(true);
  });

  it('accepts leap days only in leap years', () => {
    expect(isValidDay('2028-02-29')).toBe(true);
    expect(isValidDay('2024-02-29')).toBe(true);
    expect(isValidDay('2000-02-29')).toBe(true);
    expect(isValidDay('2026-02-29')).toBe(false);
    expect(isValidDay('2027-02-29')).toBe(false);
    expect(isValidDay('2100-02-29')).toBe(false);
  });

  it('rejects days that overflow the month', () => {
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('2026-02-31')).toBe(false);
    expect(isValidDay('2026-04-31')).toBe(false);
    expect(isValidDay('2026-06-31')).toBe(false);
    expect(isValidDay('2026-09-31')).toBe(false);
    expect(isValidDay('2026-11-31')).toBe(false);
    expect(isValidDay('2026-01-32')).toBe(false);
  });

  it('rejects impossible months and days', () => {
    expect(isValidDay('2026-13-01')).toBe(false);
    expect(isValidDay('2026-00-01')).toBe(false);
    expect(isValidDay('2026-01-00')).toBe(false);
    expect(isValidDay('2026-99-99')).toBe(false);
  });

  it('rejects anything that is not strictly YYYY-MM-DD', () => {
    expect(isValidDay('')).toBe(false);
    expect(isValidDay('2026-1-5')).toBe(false);
    expect(isValidDay('26-01-05')).toBe(false);
    expect(isValidDay('2026/01/05')).toBe(false);
    expect(isValidDay('05-01-2026')).toBe(false);
    expect(isValidDay('2026-01-05T00:00:00Z')).toBe(false);
    expect(isValidDay(' 2026-01-05')).toBe(false);
    expect(isValidDay('2026-01-05 ')).toBe(false);
    expect(isValidDay('today')).toBe(false);
    expect(isValidDay('2026-01-05\n')).toBe(false);
  });

  it('accepts everything toDay/addDays produce', () => {
    let day = '2027-12-20';
    for (let i = 0; i < 400; i++) {
      expect(isValidDay(day)).toBe(true);
      day = addDays(day, 1);
    }
    expect(isValidDay(toDay(new Date()))).toBe(true);
  });
});

describe('daysSince', () => {
  const NOW = Date.UTC(2026, 9, 22, 9, 0, 0);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  it('is null when there is no timestamp', () => {
    expect(daysSince(null)).toBeNull();
    expect(daysSince('')).toBeNull();
  });

  it('counts whole days', () => {
    expect(daysSince(ago(0))).toBe(0);
    expect(daysSince(ago(DAY_MS))).toBe(1);
    expect(daysSince(ago(3 * DAY_MS))).toBe(3);
    expect(daysSince(ago(7 * DAY_MS))).toBe(7);
    expect(daysSince(ago(365 * DAY_MS))).toBe(365);
  });

  it('rounds partial days down', () => {
    expect(daysSince(ago(1000))).toBe(0);
    expect(daysSince(ago(23 * HOUR_MS))).toBe(0);
    expect(daysSince(ago(3 * DAY_MS - HOUR_MS))).toBe(2);
    expect(daysSince(ago(3 * DAY_MS + HOUR_MS))).toBe(3);
  });

  it('understands timestamps written with an explicit offset', () => {
    // The same instant as three days ago, written in Sri Lanka time (+05:30).
    const local = new Date(NOW - 3 * DAY_MS + 5.5 * HOUR_MS).toISOString().replace('Z', '+05:30');
    expect(daysSince(local)).toBe(3);
  });

  it('is null for a timestamp it cannot parse', () => {
    expect(daysSince('not a date')).toBeNull();
    expect(daysSince('2026-13-45T99:00:00Z')).toBeNull();
  });
});
