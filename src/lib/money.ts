/**
 * Money is stored as whole cents (LKR × 100) in INTEGER columns.
 * Never use floats for stored amounts.
 */

/** Parse what the user typed ("12,500.50") into cents, or null if invalid. */
export function parseCents(input: string): number | null {
  const clean = input.replace(/[,\s]/g, '').replace(/^Rs\.?/i, '');
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 1250050 -> "12,500.50" (always Western digits, two decimals only when needed). */
export function formatAmount(cents: number, opts: { forceDecimals?: boolean } = {}): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = abs % 100;
  const tail = frac || opts.forceDecimals ? '.' + String(frac).padStart(2, '0') : '';
  return (negative ? '-' : '') + whole + tail;
}

export function formatLKR(cents: number, opts?: { forceDecimals?: boolean }): string {
  return 'Rs ' + formatAmount(cents, opts);
}

/** Cents back to the editable string shown in an input. */
export function centsToInput(cents: number): string {
  const abs = Math.abs(cents);
  const frac = abs % 100;
  return Math.floor(abs / 100) + (frac ? '.' + String(frac).padStart(2, '0') : '');
}
