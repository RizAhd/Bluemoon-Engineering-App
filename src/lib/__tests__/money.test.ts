import { centsToInput, formatAmount, formatLKR, parseCents } from '@/lib/money';

describe('parseCents', () => {
  it('parses whole rupee amounts', () => {
    expect(parseCents('0')).toBe(0);
    expect(parseCents('1')).toBe(100);
    expect(parseCents('1250')).toBe(125000);
    expect(parseCents('007')).toBe(700);
  });

  it('accepts thousands separators and whitespace', () => {
    expect(parseCents('12,500')).toBe(1250000);
    expect(parseCents('1,250,000')).toBe(125000000);
    expect(parseCents(' 1 250 ')).toBe(125000);
    expect(parseCents('12,500.50')).toBe(1250050);
    expect(parseCents('1,2,3')).toBe(12300);
  });

  it('accepts an "Rs" prefix', () => {
    expect(parseCents('Rs 1,250')).toBe(125000);
    expect(parseCents('Rs. 1250.5')).toBe(125050);
    expect(parseCents('rs1250')).toBe(125000);
  });

  it('parses one or two decimals', () => {
    expect(parseCents('12500.5')).toBe(1250050);
    expect(parseCents('12500.05')).toBe(1250005);
    expect(parseCents('12500.50')).toBe(1250050);
    expect(parseCents('0.99')).toBe(99);
    expect(parseCents('0.9')).toBe(90);
    expect(parseCents('0.01')).toBe(1);
    expect(parseCents('0.10')).toBe(10);
    // A trailing dot is what the input holds while the user is still typing.
    expect(parseCents('12500.')).toBe(1250000);
  });

  it('never produces floating point error', () => {
    for (const s of ['0.1', '0.2', '1.1', '19.99', '123456.78', '0.07', '4.35']) {
      const cents = parseCents(s);
      expect(cents).not.toBeNull();
      expect(Number.isInteger(cents)).toBe(true);
    }
    expect(parseCents('0.1')).toBe(10);
    expect(parseCents('19.99')).toBe(1999);
    expect(parseCents('0.07')).toBe(7);
    expect(parseCents('4.35')).toBe(435);
  });

  it('rejects letters and symbols', () => {
    expect(parseCents('abc')).toBeNull();
    expect(parseCents('12a')).toBeNull();
    expect(parseCents('1,2,3x')).toBeNull();
    expect(parseCents('$100')).toBeNull();
    expect(parseCents('1e5')).toBeNull();
    expect(parseCents('1.2.3')).toBeNull();
    expect(parseCents('0x10')).toBeNull();
    expect(parseCents('Infinity')).toBeNull();
    expect(parseCents('NaN')).toBeNull();
    expect(parseCents('१२३')).toBeNull(); // Devanagari digits
  });

  it('rejects negative amounts', () => {
    expect(parseCents('-5')).toBeNull();
    expect(parseCents('-0.50')).toBeNull();
    expect(parseCents('- 100')).toBeNull();
    expect(parseCents('Rs -100')).toBeNull();
  });

  it('rejects more than two decimals', () => {
    expect(parseCents('1.234')).toBeNull();
    expect(parseCents('0.001')).toBeNull();
    expect(parseCents('12,500.505')).toBeNull();
  });

  it('rejects empty and whitespace-only input', () => {
    expect(parseCents('')).toBeNull();
    expect(parseCents('   ')).toBeNull();
    expect(parseCents(',')).toBeNull();
    expect(parseCents('.')).toBeNull();
    expect(parseCents('Rs')).toBeNull();
    expect(parseCents('Rs. ')).toBeNull();
  });

  it('rejects values that do not fit in a safe integer number of cents', () => {
    expect(parseCents('99999999999999999999')).toBeNull();
    expect(parseCents('90071992547410')).toBeNull();
    // 2^53 cents exactly is no longer a safe integer ...
    expect(parseCents('90071992547409.92')).toBeNull();
    // ... but 2^53 - 1 still is.
    expect(parseCents('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('formatAmount', () => {
  it('groups thousands with commas', () => {
    expect(formatAmount(0)).toBe('0');
    expect(formatAmount(100)).toBe('1');
    expect(formatAmount(99900)).toBe('999');
    expect(formatAmount(100000)).toBe('1,000');
    expect(formatAmount(125000)).toBe('1,250');
    expect(formatAmount(1250000)).toBe('12,500');
    expect(formatAmount(12500000)).toBe('125,000');
    expect(formatAmount(100000000)).toBe('1,000,000');
    expect(formatAmount(123456789000)).toBe('1,234,567,890');
  });

  it('shows decimals only when there are cents', () => {
    expect(formatAmount(1250050)).toBe('12,500.50');
    expect(formatAmount(1250005)).toBe('12,500.05');
    expect(formatAmount(5)).toBe('0.05');
    expect(formatAmount(50)).toBe('0.50');
    expect(formatAmount(99)).toBe('0.99');
    expect(formatAmount(101)).toBe('1.01');
    expect(formatAmount(123456789)).toBe('1,234,567.89');
    expect(formatAmount(125000)).not.toContain('.');
  });

  it('forces two decimals when asked', () => {
    expect(formatAmount(0, { forceDecimals: true })).toBe('0.00');
    expect(formatAmount(100, { forceDecimals: true })).toBe('1.00');
    expect(formatAmount(125000, { forceDecimals: true })).toBe('1,250.00');
    expect(formatAmount(1250050, { forceDecimals: true })).toBe('12,500.50');
    expect(formatAmount(-125000, { forceDecimals: true })).toBe('-1,250.00');
    expect(formatAmount(125000, { forceDecimals: false })).toBe('1,250');
  });

  it('formats negative amounts with a leading minus', () => {
    expect(formatAmount(-1)).toBe('-0.01');
    expect(formatAmount(-100)).toBe('-1');
    expect(formatAmount(-1250050)).toBe('-12,500.50');
    expect(formatAmount(-100000000)).toBe('-1,000,000');
  });

  it('always uses Western digits, a dot and commas', () => {
    expect(formatAmount(1234567890)).toMatch(/^[0-9,]+\.[0-9]{2}$/);
    expect(formatAmount(1234567800)).toMatch(/^[0-9,]+$/);
  });

  it('round-trips with parseCents', () => {
    for (const cents of [0, 1, 5, 99, 100, 12345, 125000, 1250050, 99999999, 123456789012]) {
      expect(parseCents(formatAmount(cents))).toBe(cents);
      expect(parseCents(formatAmount(cents, { forceDecimals: true }))).toBe(cents);
    }
  });
});

describe('formatLKR', () => {
  it('prefixes the formatted amount with "Rs "', () => {
    expect(formatLKR(0)).toBe('Rs 0');
    expect(formatLKR(1250050)).toBe('Rs 12,500.50');
    expect(formatLKR(125000)).toBe('Rs 1,250');
    expect(formatLKR(125000, { forceDecimals: true })).toBe('Rs 1,250.00');
    expect(formatLKR(-125000)).toBe('Rs -1,250');
  });

  it('is accepted back by parseCents', () => {
    expect(parseCents(formatLKR(1250050))).toBe(1250050);
    expect(parseCents(formatLKR(0))).toBe(0);
  });
});

describe('centsToInput', () => {
  it('produces a plain editable number without grouping', () => {
    expect(centsToInput(0)).toBe('0');
    expect(centsToInput(100)).toBe('1');
    expect(centsToInput(125000)).toBe('1250');
    expect(centsToInput(1250050)).toBe('12500.50');
    expect(centsToInput(1250005)).toBe('12500.05');
    expect(centsToInput(5)).toBe('0.05');
    expect(centsToInput(123456789)).toBe('1234567.89');
    expect(centsToInput(100000000)).toBe('1000000');
    expect(centsToInput(125000)).not.toContain(',');
  });

  it('round-trips through parseCents', () => {
    for (const cents of [0, 1, 7, 99, 100, 101, 12345, 125000, 1250050, 99999999, 123456789012]) {
      expect(parseCents(centsToInput(cents))).toBe(cents);
    }
  });

  it('drops the sign, because inputs only ever hold non-negative amounts', () => {
    expect(centsToInput(-1250050)).toBe('12500.50');
  });
});
