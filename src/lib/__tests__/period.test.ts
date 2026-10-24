import { monthName, periodRange, shiftPeriod } from '@/lib/dates';

describe('periodRange: the days of the dashboard summary', () => {
  it('a day is just that day', () => {
    expect(periodRange('day', '2026-10-24')).toEqual({ from: '2026-10-24', to: '2026-10-24' });
  });

  it('a week runs Monday to Sunday, also from a Sunday and across a month end', () => {
    expect(periodRange('week', '2026-10-24')).toEqual({ from: '2026-10-19', to: '2026-10-25' }); // Saturday
    expect(periodRange('week', '2026-10-25')).toEqual({ from: '2026-10-19', to: '2026-10-25' }); // Sunday
    expect(periodRange('week', '2026-10-19')).toEqual({ from: '2026-10-19', to: '2026-10-25' }); // Monday
    expect(periodRange('week', '2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  });

  it('a month is its first to its last day, February in a leap year too', () => {
    expect(periodRange('month', '2026-10-24')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('shiftPeriod: ‹ and ›', () => {
  it('steps a day, a week or a month, across a year end', () => {
    expect(shiftPeriod('day', '2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftPeriod('week', '2026-10-24', -1)).toBe('2026-10-17');
    expect(shiftPeriod('month', '2026-01-31', -1)).toBe('2025-12-01');
    expect(shiftPeriod('month', '2026-12-05', 1)).toBe('2027-01-01');
  });

  it('names a month in full', () => {
    expect(monthName('2026-10-05')).toBe('October 2026');
  });
});
