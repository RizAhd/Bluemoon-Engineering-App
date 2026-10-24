import type { ProjectWorkerBalance, WageDay } from '@/db/types';

/**
 * What is still unpaid for one day's work on a project: per worker the day's wage minus what was paid that
 * day, but never more than the worker is owed on the project overall, since an advance (that day or earlier)
 * already covers part of it. Only workers on the roster count (a removed worker's day rows stay in v_wage_day).
 * The Today card, the Workers tab and the wage sheet all show this one figure.
 */
export function unpaidForDay(dayRows: WageDay[], roster: ProjectWorkerBalance[]): number {
  const owed = new Map(roster.map((r) => [r.worker_id, Math.max(0, r.balance_cents)]));
  return dayRows.reduce((sum, r) => {
    if (!owed.has(r.worker_id)) return sum;
    return sum + Math.max(0, Math.min((r.work_cents ?? 0) - (r.paid_cents ?? 0), owed.get(r.worker_id) ?? 0));
  }, 0);
}
