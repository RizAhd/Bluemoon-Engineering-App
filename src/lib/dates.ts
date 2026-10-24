/** Dates are stored as local calendar days "YYYY-MM-DD"; timestamps as ISO strings. */

export function today(): string {
  return toDay(new Date());
}

export function toDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Whole days since an ISO timestamp, or null if there is none. */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.floor((Date.now() - at) / 86400000);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return toDay(new Date(y, m - 1, d + n));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-21" -> "21 Oct 2026" */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function isValidDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export type Period = 'day' | 'week' | 'month';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parts(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return { y, m, d };
}

/** First and last day of the period that holds `anchor`. Weeks run Monday to Sunday. */
export function periodRange(period: Period, anchor: string): { from: string; to: string } {
  if (period === 'day') return { from: anchor, to: anchor };
  const { y, m, d } = parts(anchor);
  if (period === 'week') {
    const back = (new Date(y, m - 1, d).getDay() + 6) % 7; // days since Monday
    const from = addDays(anchor, -back);
    return { from, to: addDays(from, 6) };
  }
  return { from: toDay(new Date(y, m - 1, 1)), to: toDay(new Date(y, m, 0)) };
}

/** The same period one step earlier (-1) or later (+1). */
export function shiftPeriod(period: Period, anchor: string, by: -1 | 1): string {
  if (period === 'day') return addDays(anchor, by);
  if (period === 'week') return addDays(anchor, 7 * by);
  const { y, m } = parts(anchor);
  return toDay(new Date(y, m - 1 + by, 1));
}

/** "2026-10-05" -> "October 2026" */
export function monthName(day: string): string {
  const { y, m } = parts(day);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
