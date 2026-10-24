import type { ProjectWorkerBalance, WageDay } from '@/db/types';
import { unpaidForDay } from '@/lib/wages';

const day = (worker_id: string, work_cents: number, paid_cents = 0): WageDay => ({
  project_id: 'p',
  worker_id,
  day: '2026-10-24',
  days: 1,
  work_cents,
  paid_cents,
  advance_cents: 0,
});
const roster = (worker_id: string, balance_cents: number) => ({ project_id: 'p', worker_id, balance_cents }) as ProjectWorkerBalance;

describe('unpaidForDay: "Unpaid for today\'s work" on Today, Workers and the wage sheet', () => {
  it('is the day\'s wage minus what was paid that day', () => {
    expect(unpaidForDay([day('a', 300_000, 100_000)], [roster('a', 200_000)])).toBe(200_000);
  });

  it('an advance already given lowers it to what the worker is owed overall', () => {
    // earned 5,250, paid 1,000 and an advance of 2,000 today: owed 2,250, not 4,250
    expect(unpaidForDay([day('a', 525_000, 100_000)], [roster('a', 225_000)])).toBe(225_000);
  });

  it('a worker paid ahead adds nothing, and a worker not on the roster is left out', () => {
    expect(unpaidForDay([day('a', 270_000), day('gone', 500_000)], [roster('a', -150_000)])).toBe(0);
  });

  it('adds up several workers', () => {
    expect(unpaidForDay([day('a', 300_000), day('b', 350_000, 50_000)], [roster('a', 900_000), roster('b', 300_000)])).toBe(600_000);
  });
});
