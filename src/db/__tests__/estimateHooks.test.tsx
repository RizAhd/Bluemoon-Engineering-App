/**
 * The estimate hooks re-render on every write, and show what the database says: the list with
 * its totals, one estimate, its lines, its stages, its total and the estimates of a project.
 */
import { act, renderHook } from '@testing-library/react-native';

import {
  applyStandardSchedule,
  createProjectFromEstimate,
  deleteEstimate,
  removeEstimateItem,
  saveEstimate,
  saveEstimateItem,
  setEstimateStatus,
} from '@/db/estimates';
import { saveCompanyProfile, useCompanyProfile } from '@/lib/company';
import { useEstimate, useEstimateItems, useEstimatePayments, useEstimates, useEstimateTotal, useProjectEstimates } from '@/hooks/data';
import { resetDb } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

let clock: ReturnType<typeof useClock>;
beforeEach(() => {
  resetDb();
  clock = useClock(new Date(2026, 9, 22, 12, 0, 0));
});
afterEach(() => clock.restore());

const mk = (over: Partial<Parameters<typeof saveEstimate>[0]> = {}) => saveEstimate({ client_name: 'Mr. Perera', title: 'Boundary wall', ...over });
const line = (estimate_id: string, rate_cents = 500_000) => saveEstimateItem({ estimate_id, description: 'Blockwork', unit: 'm²', qty_milli: 10_000, rate_cents });

describe('useEstimates', () => {
  it('is empty with no estimates', async () => {
    const { result } = await renderHook(() => useEstimates());
    expect(result.current).toEqual([]);
  });

  it('lists live estimates with their total and number of lines, newest issue day first', async () => {
    const old = mk({ issue_day: '2026-09-01', title: 'Old' });
    line(old);
    clock.tick(1000);
    const recent = mk({ issue_day: '2026-10-20', title: 'Recent', tax_bp: 1800 });
    line(recent);
    line(recent, 100_000);
    clock.tick(1000);
    const empty = mk({ issue_day: '2026-10-20', title: 'Empty' });
    const { result } = await renderHook(() => useEstimates());
    // same day: the one created later first
    expect(result.current.map((e) => [e.id, e.title, e.item_count, e.total_cents])).toEqual([
      [empty, 'Empty', 0, 0],
      [recent, 'Recent', 2, Math.round((5_000_000 + 1_000_000) * 1.18)],
      [old, 'Old', 1, 5_000_000],
    ]);
    expect(result.current[1]).toMatchObject({ number: 'EST-2026-002', status: 'draft', client_name: 'Mr. Perera', version: expect.any(Number) });
  });

  it('re-renders after a write and drops a deleted estimate', async () => {
    const { result } = await renderHook(() => useEstimates());
    expect(result.current).toHaveLength(0);
    let id = '';
    await act(async () => {
      id = mk();
      line(id);
    });
    expect(result.current.map((e) => e.total_cents)).toEqual([5_000_000]);
    await act(async () => {
      line(id);
    });
    expect(result.current.map((e) => [e.item_count, e.total_cents])).toEqual([[2, 10_000_000]]);
    await act(async () => {
      deleteEstimate(id);
    });
    expect(result.current).toEqual([]);
  });
});

describe('useEstimate, useEstimateItems, useEstimatePayments, useEstimateTotal', () => {
  it('show one estimate, and are null or empty for an unknown or missing id', async () => {
    const { result } = await renderHook(() => ({
      e: useEstimate(undefined),
      none: useEstimate('nope'),
      items: useEstimateItems(null),
      payments: useEstimatePayments('nope'),
      total: useEstimateTotal(undefined),
    }));
    expect(result.current).toEqual({ e: null, none: null, items: [], payments: [], total: null });
  });

  it('follow every change of the estimate, its lines, stages and totals', async () => {
    const id = mk({ tax_bp: 800 });
    const { result } = await renderHook(() => ({
      e: useEstimate(id),
      items: useEstimateItems(id),
      payments: useEstimatePayments(id),
      total: useEstimateTotal(id),
    }));
    expect(result.current.e).toMatchObject({ id, status: 'draft', number: 'EST-2026-001' });
    expect(result.current.total).toMatchObject({ item_count: 0, total_cents: 0, scheduled_bp: 0 });

    let a = '';
    await act(async () => {
      a = line(id);
      line(id, 100_000);
      applyStandardSchedule(id);
    });
    expect(result.current.items.map((i) => [i.position, i.rate_cents])).toEqual([[1, 500_000], [2, 100_000]]);
    expect(result.current.payments.map((p) => [p.label, p.percent_bp])).toEqual([['Advance', 3000], ['Progress payment', 4000], ['On completion', 3000]]);
    expect(result.current.total).toMatchObject({ item_count: 2, subtotal_cents: 6_000_000, tax_cents: 480_000, total_cents: 6_480_000, scheduled_bp: 10_000 });

    await act(async () => {
      removeEstimateItem(a);
      setEstimateStatus(id, 'sent');
    });
    expect(result.current.items.map((i) => i.position)).toEqual([1]);
    expect(result.current.e?.status).toBe('sent');
    expect(result.current.total).toMatchObject({ item_count: 1, subtotal_cents: 1_000_000 });

    await act(async () => {
      deleteEstimate(id);
    });
    expect(result.current).toEqual({ e: null, items: [], payments: [], total: null });
  });
});

describe('useProjectEstimates', () => {
  it('finds the estimate a project was made from, and nothing for another project', async () => {
    const id = mk();
    line(id);
    setEstimateStatus(id, 'accepted');
    const { result } = await renderHook(() => ({ none: useProjectEstimates(null), other: useProjectEstimates('some-project') }));
    expect(result.current).toEqual({ none: [], other: [] });

    let project = '';
    await act(async () => {
      project = createProjectFromEstimate(id);
    });
    const linked = await renderHook(() => useProjectEstimates(project));
    expect(linked.result.current.map((e) => [e.id, e.number])).toEqual([[id, 'EST-2026-001']]);
    await act(async () => {
      deleteEstimate(id);
    });
    expect(linked.result.current).toEqual([]);
  });
});

describe('useCompanyProfile', () => {
  it('shows the defaults, then the saved details as soon as they are saved', async () => {
    const { result } = await renderHook(() => useCompanyProfile());
    expect(result.current.name).toBe('Bluemoon Engineering (Pvt) Ltd');
    expect(result.current.bank_name).toBe('');
    await act(async () => {
      saveCompanyProfile({ bank_name: 'Bank of Ceylon', account_no: '1234567', default_valid_days: 14 });
    });
    expect(result.current).toMatchObject({ bank_name: 'Bank of Ceylon', account_no: '1234567', default_valid_days: 14, name: 'Bluemoon Engineering (Pvt) Ltd' });
  });

  it('keeps the same object between renders when nothing changed', async () => {
    const { result, rerender } = await renderHook(() => useCompanyProfile());
    const first = result.current;
    await rerender({});
    expect(result.current).toBe(first);
  });
});
