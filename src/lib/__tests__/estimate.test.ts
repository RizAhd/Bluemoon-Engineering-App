/**
 * The pure estimate helpers: typed quantities and percentages, exact money arithmetic, payment
 * allocation, dates and numbers. No database. Money is whole cents and never goes through a float
 * division that could round the wrong way.
 */
import {
  allocatePayments,
  estimateSums,
  formatPercent,
  formatQty,
  lineAmount,
  MAX_QTY_MILLI,
  MAX_RATE_CENTS,
  nextEstimateNumber,
  parseEstimateNumber,
  parsePercent,
  parseQty,
  STANDARD_SCHEDULE,
  validUntil,
} from '@/lib/estimate';

/** A repeatable pseudo-random stream, so a failing case can be reproduced. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const exactLine = (qty: number, rate: number) => Number((BigInt(qty) * BigInt(rate) + 500n) / 1000n);

describe('parseQty', () => {
  it.each([
    ['12.5', 12500],
    ['12,5', 12500],
    ['3', 3000],
    ['0.001', 1],
    ['0,001', 1],
    ['.5', 500],
    ['5.', 5000],
    ['  7  ', 7000],
    ['007', 7000],
    ['0', 0],
    ['1000000', 1_000_000_000],
    ['2.50', 2500],
    ['12.345', 12345],
  ])('reads %j as %d thousandths', (input, milli) => {
    expect(parseQty(input)).toBe(milli);
  });

  it.each([
    ['', 'nothing'],
    ['   ', 'only spaces'],
    ['.', 'only a separator'],
    [',', 'only a comma'],
    ['12.3456', 'four decimals'],
    ['0.0001', 'a ten-thousandth'],
    ['1.2.3', 'two separators'],
    ['1,200.5', 'thousands and decimals mixed'],
    ['1 000', 'a space inside'],
    ['-1', 'a minus sign'],
    ['+1', 'a plus sign'],
    ['1e3', 'an exponent'],
    ['abc', 'letters'],
    ['12 m', 'a unit'],
    ['١٢', 'Arabic-Indic digits'],
    ['9007199254740993', 'more than a safe integer'],
    ['99999999999999', 'too big to be stored exactly'],
  ])('refuses %j (%s)', (input) => {
    expect(parseQty(input)).toBeNull();
  });

  it('does not judge the range: 0 and very large quantities parse, the repo refuses them', () => {
    expect(parseQty('0')).toBe(0);
    expect(parseQty('2000000')).toBe(2_000_000_000);
  });
});

describe('formatQty', () => {
  it.each([
    [12500, '12.5'],
    [3000, '3'],
    [1, '0.001'],
    [10, '0.01'],
    [100, '0.1'],
    [0, '0'],
    [1_000_000_000, '1000000'],
    [12345, '12.345'],
  ])('shows %d thousandths as %j', (milli, text) => {
    expect(formatQty(milli)).toBe(text);
  });

  it('round-trips through parseQty for every kind of value', () => {
    const next = rng(7);
    const values = [0, 1, 9, 10, 99, 100, 999, 1000, 1001, 12500, MAX_QTY_MILLI, MAX_QTY_MILLI - 1];
    for (let i = 0; i < 2000; i++) values.push(Math.floor(next() * MAX_QTY_MILLI));
    for (const v of values) expect({ v, back: parseQty(formatQty(v)) }).toEqual({ v, back: v });
  });
});

describe('parsePercent', () => {
  it.each([
    ['18', 1800],
    ['12.5', 1250],
    ['12,5', 1250],
    ['0.01', 1],
    ['0,05', 5],
    ['100', 10000],
    ['30', 3000],
    ['18 %', 1800],
    ['18%', 1800],
    ['.5', 50],
    ['33.33', 3333],
  ])('reads %j as %d basis points', (input, bp) => {
    expect(parsePercent(input)).toBe(bp);
  });

  it.each(['', ' ', '%', '12.555', '1.2.3', '-5', 'abc', '5 percent', '1e2', '1 8'])('refuses %j', (input) => {
    expect(parsePercent(input)).toBeNull();
  });

  it('formatPercent shows basis points the way they are typed, and round-trips', () => {
    expect([1800, 1250, 1, 5, 10000, 1205, 3333, 0].map(formatPercent)).toEqual(['18', '12.5', '0.01', '0.05', '100', '12.05', '33.33', '0']);
    for (let bp = 0; bp <= 10000; bp++) expect(parsePercent(formatPercent(bp))).toBe(bp);
  });
});

describe('lineAmount', () => {
  it('multiplies a quantity in thousandths by a rate in cents', () => {
    expect(lineAmount(1000, 15_000)).toBe(15_000); // 1 x Rs 150
    expect(lineAmount(12_500, 20_000)).toBe(250_000); // 12.5 x Rs 200
    expect(lineAmount(3_000, 0)).toBe(0);
  });

  it('rounds half a cent up and anything less down', () => {
    expect(lineAmount(1, 500)).toBe(1); // 0.5 cent
    expect(lineAmount(1, 499)).toBe(0); // 0.499
    expect(lineAmount(3, 500)).toBe(2); // 1.5
    expect(lineAmount(12_500, 3_333)).toBe(41_663); // 12.5 x 33.33 = 416.625
    expect(lineAmount(999, 1)).toBe(1); // 0.999
    expect(lineAmount(499, 1)).toBe(0);
    expect(lineAmount(500, 1)).toBe(1);
  });

  it('is exact at the top of the allowed range, where the product no longer fits a double', () => {
    expect(Number.isSafeInteger(MAX_QTY_MILLI * MAX_RATE_CENTS)).toBe(false);
    expect(lineAmount(MAX_QTY_MILLI, MAX_RATE_CENTS)).toBe(5_000_000_000_000_000);
    expect(lineAmount(MAX_QTY_MILLI - 1, MAX_RATE_CENTS - 1)).toBe(exactLine(MAX_QTY_MILLI - 1, MAX_RATE_CENTS - 1));
    // either side of 2^53 (the product still fits a double / no longer does)
    expect(lineAmount(1_000_000_000, 9_007_199)).toBe(exactLine(1_000_000_000, 9_007_199));
    expect(lineAmount(1_000_000_000, 9_007_200)).toBe(exactLine(1_000_000_000, 9_007_200));
    // above 2^53 an odd product cannot be held by a double: this one ends in .499 cents and a float would carry it into the next cent
    expect(Number.isSafeInteger(999_999_999 * 9_007_501 + 500)).toBe(false);
    expect(lineAmount(999_999_999, 9_007_501)).toBe(9_007_500_990_992);
    expect(lineAmount(999_999_999, 9_000_501)).toBe(9_000_500_990_999); // still inside the safe range
  });

  it('agrees with BigInt arithmetic for random quantities and rates', () => {
    const next = rng(11);
    for (let i = 0; i < 5000; i++) {
      const qty = 1 + Math.floor(next() * MAX_QTY_MILLI);
      const rate = Math.floor(next() * (i % 2 ? MAX_RATE_CENTS : 100_000));
      expect({ qty, rate, got: lineAmount(qty, rate) }).toEqual({ qty, rate, got: exactLine(qty, rate) });
    }
  });
});

describe('estimateSums', () => {
  const line = (qty_milli: number, rate_cents: number) => ({ qty_milli, rate_cents });

  it('has no sums for no lines', () => {
    expect(estimateSums([], 0, 0)).toEqual({ subtotal_cents: 0, discount_cents: 0, tax_cents: 0, total_cents: 0 });
  });

  it('subtracts the discount, then adds the tax on what is left', () => {
    // Rs 1,000 + Rs 500, Rs 100 off, 18 % tax on Rs 1,400
    expect(estimateSums([line(1000, 100_000), line(2000, 25_000)], 10_000, 1800)).toEqual({
      subtotal_cents: 150_000,
      discount_cents: 10_000,
      tax_cents: 25_200,
      total_cents: 165_200,
    });
  });

  it('never takes the taxable amount below zero, and charges no tax on nothing', () => {
    expect(estimateSums([line(1000, 5_000)], 9_000, 1800)).toEqual({ subtotal_cents: 5_000, discount_cents: 9_000, tax_cents: 0, total_cents: 0 });
  });

  it('rounds the tax half a cent up', () => {
    expect(estimateSums([line(1000, 10)], 0, 500).tax_cents).toBe(1); // 0.5
    expect(estimateSums([line(1000, 9)], 0, 500).tax_cents).toBe(0); // 0.45
    expect(estimateSums([line(1000, 30)], 0, 1250).tax_cents).toBe(4); // 3.75
  });
});

describe('allocatePayments', () => {
  it('works out each stage from the total', () => {
    expect(allocatePayments(1_000_000, [3000, 4000, 3000])).toEqual([300_000, 400_000, 300_000]);
  });

  it('gives the last stage the remainder when the stages add up to 100 %', () => {
    // 100,001 cents: 30 % = 30000.3, 40 % = 40000.4, the last takes what is left
    expect(allocatePayments(100_001, [3000, 4000, 3000])).toEqual([30_000, 40_000, 30_001]);
    expect(allocatePayments(100, [3333, 3333, 3334])).toEqual([33, 33, 34]);
    expect(allocatePayments(1, [10000])).toEqual([1]);
  });

  it('rounds each earlier stage half a cent up', () => {
    // 25 cents: 50 % = 12.5 -> 13, the last takes 12
    expect(allocatePayments(25, [5000, 5000])).toEqual([13, 12]);
  });

  it('never hands out more than the total or a negative amount, even for one cent', () => {
    expect(allocatePayments(1, [5000, 5000])).toEqual([1, 0]);
    expect(allocatePayments(1, [3333, 3333, 3334])).toEqual([0, 0, 1]);
    expect(allocatePayments(0, [3000, 7000])).toEqual([0, 0]);
    // six stages of 16.67 % on 3 cents: each earlier one would round up to a cent, so the last would have to be negative
    expect(allocatePayments(3, [1667, 1667, 1667, 1667, 1667, 1665])).toEqual([1, 1, 1, 0, 0, 0]);
  });

  it('leaves each stage on its own when the stages are not 100 %', () => {
    expect(allocatePayments(1000, [3000])).toEqual([300]);
    expect(allocatePayments(1, [5000])).toEqual([1]); // 0.5 rounds up
    expect(allocatePayments(1000, [3000, 4000])).toEqual([300, 400]);
    expect(allocatePayments(1000, [])).toEqual([]);
  });

  it('adds up to the total to the cent for any total and any split into 100 %', () => {
    const next = rng(3);
    const totals = [0, 1, 2, 3, 99, 100, 101, 9_999, 10_001, 123_456_789, 200_000_000_000_000];
    for (let i = 0; i < 400; i++) totals.push(Math.floor(next() * 10 ** (1 + Math.floor(next() * 12))));
    for (const total of totals) {
      const stages = 1 + Math.floor(next() * 6);
      // a random split of 10000 into `stages` positive parts
      const cuts = new Set<number>();
      while (cuts.size < stages - 1) cuts.add(1 + Math.floor(next() * 9999));
      const edges = [0, ...[...cuts].sort((a, b) => a - b), 10000];
      const bps = edges.slice(1).map((e, k) => e - edges[k]);
      const amounts = allocatePayments(total, bps);
      expect({ total, bps, sum: amounts.reduce((a, b) => a + b, 0) }).toEqual({ total, bps, sum: total });
      expect({ total, bps, negative: amounts.some((a) => a < 0) }).toEqual({ total, bps, negative: false });
      // every stage but the last is within a cent of its exact share
      amounts.slice(0, -1).forEach((a, k) => {
        const exact = Number((BigInt(total) * BigInt(bps[k]) + 5000n) / 10000n);
        expect(a).toBeLessThanOrEqual(exact);
        expect(a).toBeGreaterThanOrEqual(0);
      });
    }
  });

  it('is exact for the largest totals, where total x percent no longer fits a double', () => {
    const total = 200_000_000_000_000; // Rs 2 trillion
    expect(Number.isSafeInteger(total * 3333)).toBe(false);
    const [a, b, c] = allocatePayments(total, [3333, 3333, 3334]);
    expect(a).toBe(Number((BigInt(total) * 3333n + 5000n) / 10000n));
    expect(a + b + c).toBe(total);
  });

  it('the standard schedule is 30 / 40 / 30 and adds up to 100 %', () => {
    expect(STANDARD_SCHEDULE.map((s) => [s.label, s.percent_bp])).toEqual([
      ['Advance', 3000],
      ['Progress payment', 4000],
      ['On completion', 3000],
    ]);
  });

  it('refuses a total that is not whole cents or is negative', () => {
    expect(() => allocatePayments(-1, [10000])).toThrow(RangeError);
    expect(() => allocatePayments(10.5, [10000])).toThrow(RangeError);
  });
});

describe('validUntil', () => {
  it.each([
    ['2026-10-22', 30, '2026-11-21'],
    ['2026-12-15', 30, '2027-01-14'],
    ['2028-02-01', 29, '2028-03-01'], // leap year
    ['2027-02-01', 28, '2027-03-01'],
    ['2026-01-31', 1, '2026-02-01'],
    ['2026-10-22', 365, '2027-10-22'],
    ['2026-03-28', 1, '2026-03-29'],
  ])('%s + %d days is %s', (issue, days, until) => {
    expect(validUntil(issue, days)).toBe(until);
  });

  it('hands back a day it cannot read instead of printing nonsense', () => {
    expect(validUntil('', 30)).toBe('');
    expect(validUntil('2026-02-30', 30)).toBe('2026-02-30');
    expect(validUntil('2026-10-22', 1.5)).toBe('2026-10-22');
  });
});

describe('estimate numbers', () => {
  it('pads the sequence to three digits and lets it grow', () => {
    expect(nextEstimateNumber(2026, 1)).toBe('EST-2026-001');
    expect(nextEstimateNumber(2026, 42)).toBe('EST-2026-042');
    expect(nextEstimateNumber(2026, 999)).toBe('EST-2026-999');
    expect(nextEstimateNumber(2026, 1000)).toBe('EST-2026-1000');
  });

  it('reads back the numbers the app makes and ignores hand-typed ones', () => {
    expect(parseEstimateNumber('EST-2026-007')).toEqual({ year: 2026, seq: 7 });
    expect(parseEstimateNumber(' EST-2027-1000 ')).toEqual({ year: 2027, seq: 1000 });
    for (const typed of ['EST-26-001', 'EST-2026-01', 'Q-2026-001', 'EST-2026-', '2026-001', 'EST-2026-001-A', '']) expect(parseEstimateNumber(typed)).toBeNull();
    expect(parseEstimateNumber(nextEstimateNumber(2031, 12))).toEqual({ year: 2031, seq: 12 });
  });
});
