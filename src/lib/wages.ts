import type { ProjectWorkerBalance, WageDay } from '@/db/types';

import { lineAmount } from './estimate';

/**
 * What one worker is still owed for one day's work: the day's wage minus what was paid that day, but never
 * more than the worker is owed on the project overall (`owedOnProject`, the project balance), since an
 * advance (that day or earlier) already covers part of it. Never below zero.
 */
export function unpaidForWorker(workCents: number | null | undefined, paidCents: number | null | undefined, owedOnProject: number): number {
  return Math.max(0, Math.min((workCents ?? 0) - (paidCents ?? 0), Math.max(0, owedOnProject)));
}

/**
 * What is still unpaid for one day's work on a project: per worker the day's wage minus what was paid that
 * day, but never more than the worker is owed on the project overall, since an advance (that day or earlier)
 * already covers part of it. Only workers on the roster count (a removed worker's day rows stay in v_wage_day).
 * The Today card, the Workers tab, the wage sheet and the day sheet PDF all show this one figure.
 */
export function unpaidForDay(dayRows: WageDay[], roster: ProjectWorkerBalance[]): number {
  const owed = new Map(roster.map((r) => [r.worker_id, Math.max(0, r.balance_cents)]));
  return dayRows.reduce((sum, r) => {
    if (!owed.has(r.worker_id)) return sum;
    return sum + unpaidForWorker(r.work_cents, r.paid_cents, owed.get(r.worker_id) ?? 0);
  }, 0);
}

/**
 * A day's wage in cents: days x the daily rate, rounded half up in exact integer arithmetic (days as thousandths, the
 * way estimate lines are priced), so 0.29 days at Rs 1,000.50 is Rs 290.15 and no float error can move a cent.
 */
export function dayWage(days: number, rateCents: number): number {
  return lineAmount(Math.round(days * 1000), rateCents);
}
