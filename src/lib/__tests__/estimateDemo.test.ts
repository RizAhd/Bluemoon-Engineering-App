/**
 * The developer demo data includes two estimates: a draft with several lines and the standard
 * schedule, and an accepted one that belongs to no project. Seeding twice adds nothing.
 */
import { all, first, getDb } from '@/db';
import { loadEstimate } from '@/db/estimates';
import { allocatePayments } from '@/lib/estimate';
import { resetDb, seedDemo } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

let clock: ReturnType<typeof useClock>;
beforeEach(() => {
  resetDb();
  clock = useClock(new Date(2026, 9, 22, 12, 0, 0));
});
afterEach(() => clock.restore());

const idOf = (title: string) => first<{ id: string }>('SELECT id FROM estimates WHERE title = ?', [title])?.id as string;
const count = (table: string) => first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n;

describe('the demo estimates', () => {
  it('are a draft with several lines and a complete schedule, and an accepted one linked to nothing', () => {
    expect(seedDemo()).toEqual({ created: true });
    expect(count('estimates')).toBe(2);

    const draft = loadEstimate(idOf('Boundary wall, Welimada'));
    expect(draft?.estimate).toMatchObject({ status: 'draft', number: 'EST-2026-001', project_id: null, issue_day: '2026-10-19', client_name: 'Mr. K. Wijesekara' });
    expect(draft?.items.length).toBeGreaterThanOrEqual(5);
    expect(draft?.items.map((i) => i.position)).toEqual(draft?.items.map((_i, k) => k + 1));
    expect(draft?.payments.map((p) => [p.label, p.percent_bp])).toEqual([['Advance', 3000], ['Progress payment', 4000], ['On completion', 3000]]);
    expect(draft?.total.scheduled_bp).toBe(10_000);
    expect(draft?.total.discount_cents).toBeGreaterThan(0);
    expect(draft?.total.total_cents).toBe(draft ? draft.total.subtotal_cents - draft.total.discount_cents : -1);

    const accepted = loadEstimate(idOf('Retaining wall, Bandarawela'));
    expect(accepted?.estimate).toMatchObject({ status: 'accepted', number: 'EST-2026-002', project_id: null, tax_bp: 1800 });
    expect(accepted?.items.length).toBeGreaterThanOrEqual(2);
    expect(accepted?.total.tax_cents).toBeGreaterThan(0);
    expect(accepted?.total.scheduled_bp).toBe(10_000);
  });

  it('the schedule amounts add up to the total of each estimate to the cent', () => {
    seedDemo();
    for (const e of all<{ id: string }>('SELECT id FROM estimates')) {
      const loaded = loadEstimate(e.id);
      const amounts = allocatePayments(loaded?.total.total_cents ?? 0, loaded?.payments.map((p) => p.percent_bp) ?? []);
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(loaded?.total.total_cents);
    }
  });

  it('seeding twice adds nothing, the estimates included', () => {
    seedDemo();
    const before = ['projects', 'estimates', 'estimate_items', 'estimate_payments', 'audit_log'].map(count);
    expect(seedDemo()).toEqual({ created: false });
    expect(['projects', 'estimates', 'estimate_items', 'estimate_payments', 'audit_log'].map(count)).toEqual(before);
  });

  it('a phone seeded before estimates existed gets the two estimates, and only those', () => {
    seedDemo();
    const d = getDb();
    d.execSync('DELETE FROM estimate_payments; DELETE FROM estimate_items; DELETE FROM estimates;');
    const projects = count('projects');
    expect(seedDemo()).toEqual({ created: true });
    expect(count('projects')).toBe(projects);
    expect(count('estimates')).toBe(2);
    expect(seedDemo()).toEqual({ created: false });
  });
});
