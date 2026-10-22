/**
 * Pure estimate helpers. No database, no floats for money: quantities are thousandths, money is
 * whole cents, percentages are basis points, and every division rounds half up on integers.
 * Screens, the PDF and the repo all call these, so a number is worked out in exactly one place
 * (the database view v_estimate_total does the same sums in SQL; a test keeps the two equal).
 */
import { addDays, isValidDay } from './dates';

/** At most this many price lines on one estimate. */
export const MAX_ESTIMATE_ITEMS = 200;

/** Largest amount of one price line: keeps every sum and the tax multiplication far inside 64-bit integers. */
export const MAX_LINE_CENTS = 1_000_000_000_000;

export const MAX_QTY_MILLI = 1_000_000_000;
export const MAX_RATE_CENTS = 5_000_000_000;

/** Stages offered by "Use standard schedule": 30 % advance, 40 % progress, 30 % on completion. */
export const STANDARD_SCHEDULE: readonly { label: string; percent_bp: number }[] = [
  { label: 'Advance', percent_bp: 3000 },
  { label: 'Progress payment', percent_bp: 4000 },
  { label: 'On completion', percent_bp: 3000 },
];

// ---------------------------------------------------------------- typed numbers

/**
 * What the user typed as a decimal with at most `decimals` digits after a comma or a dot,
 * as an integer scaled by 10^decimals. "12,5" and "12.5" are the same; ".5" and "5." are fine.
 * Anything else (signs, exponents, thousands separators, letters, too many decimals) is null.
 */
function parseScaled(input: string, decimals: number): number | null {
  const m = /^(\d*)(?:[.,](\d*))?$/.exec(input.trim());
  if (!m) return null;
  const whole = m[1];
  const frac = m[2] ?? '';
  if (!whole && !frac) return null;
  if (frac.length > decimals) return null;
  const n = Number(whole || '0') * 10 ** decimals + Number(frac.padEnd(decimals, '0') || '0');
  return Number.isSafeInteger(n) ? n : null;
}

/** 12.5 -> "12.5", 12500 thousandths -> no trailing zeros, no thousands separators (it goes back into an input). */
function formatScaled(value: number, decimals: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(value));
  const scale = 10 ** decimals;
  const whole = Math.floor(abs / scale);
  const frac = String(abs % scale).padStart(decimals, '0').replace(/0+$/, '');
  return sign + whole + (frac ? '.' + frac : '');
}

/** "12.5" or "12,5" -> 12500 (thousandths), up to 3 decimals; null when it is not a number. */
export function parseQty(input: string): number | null {
  return parseScaled(input, 3);
}

/** 12500 -> "12.5", 3000 -> "3". */
export function formatQty(milli: number): string {
  return formatScaled(milli, 3);
}

/** "18", "12.5", "12,5" or "18 %" -> basis points (1800, 1250), up to 2 decimals; null when it is not a number. */
export function parsePercent(input: string): number | null {
  return parseScaled(input.replace(/\s*%\s*$/, ''), 2);
}

/** 1800 -> "18", 1250 -> "12.5". */
export function formatPercent(bp: number): string {
  return formatScaled(bp, 2);
}

// ---------------------------------------------------------------- money

/**
 * Amount of one price line in cents: (qty_milli * rate_cents + 500) / 1000, rounded half up.
 * The product of the largest allowed quantity and rate is above 2^53, so it falls back to BigInt there.
 */
export function lineAmount(qtyMilli: number, rateCents: number): number {
  const p = qtyMilli * rateCents + 500;
  if (Number.isSafeInteger(p)) return (p - (p % 1000)) / 1000;
  return Number((BigInt(qtyMilli) * BigInt(rateCents) + 500n) / 1000n);
}

export interface EstimateSums {
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
}

/**
 * The same sums as the view v_estimate_total, for lines that are not in the database yet
 * (the import preview). The discount never takes the taxable amount below zero.
 */
export function estimateSums(lines: readonly { qty_milli: number; rate_cents: number }[], discountCents: number, taxBp: number): EstimateSums {
  const subtotal = lines.reduce((sum, l) => sum + lineAmount(l.qty_milli, l.rate_cents), 0);
  const taxable = Math.max(0, subtotal - discountCents);
  const tax = Number((BigInt(taxable) * BigInt(taxBp) + 5000n) / 10000n);
  return { subtotal_cents: subtotal, discount_cents: discountCents, tax_cents: tax, total_cents: taxable + tax };
}

/**
 * The amount of each payment stage: total x percent, rounded half up. When the stages add up to
 * exactly 100 % (10000 bp) the last one takes the remainder, so the amounts add up to the total to
 * the cent and none is negative. With less than 100 % each stage stands alone.
 */
export function allocatePayments(totalCents: number, percentsBp: readonly number[]): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new RangeError('allocatePayments: total must be whole cents, 0 or more');
  const total = BigInt(totalCents);
  const share = (bp: number) => Number((total * BigInt(bp) + 5000n) / 10000n);
  const complete = percentsBp.length > 0 && percentsBp.reduce((a, b) => a + b, 0) === 10000;
  const out: number[] = [];
  let given = 0;
  percentsBp.forEach((bp, i) => {
    if (complete && i === percentsBp.length - 1) {
      out.push(totalCents - given);
      return;
    }
    // earlier rounding can only ever hand out more than the total in a tiny-total corner (1 cent in two halves): cap it
    const amount = complete ? Math.min(share(bp), totalCents - given) : share(bp);
    out.push(amount);
    given += amount;
  });
  return out;
}

// ---------------------------------------------------------------- dates and numbers

/** The last day the quote stands: issue day + valid days. An unreadable day comes back as it was. */
export function validUntil(issueDay: string, validDays: number): string {
  if (!isValidDay(issueDay) || !Number.isSafeInteger(validDays)) return issueDay;
  return addDays(issueDay, validDays);
}

/** EST-2026-001. The sequence grows past three digits when it has to (EST-2026-1000). */
export function nextEstimateNumber(year: number, seq: number): string {
  return `EST-${year}-${String(seq).padStart(3, '0')}`;
}

/** The year and sequence of a number the app would have made (EST-2026-007), or null for a number typed by hand. */
export function parseEstimateNumber(number: string): { year: number; seq: number } | null {
  const m = /^EST-(\d{4})-(\d{3,})$/.exec(number.trim());
  if (!m) return null;
  const seq = Number(m[2]);
  return Number.isSafeInteger(seq) ? { year: Number(m[1]), seq } : null;
}
