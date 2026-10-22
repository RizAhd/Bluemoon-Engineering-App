/**
 * Amounts in English words, as they are written on Sri Lankan cheques, invoices and quotations:
 * "Rupees One Hundred and Twenty-Five Thousand and Fifty Cents Only".
 *
 * Documents here are written in English words even when the digits are grouped the local way, so
 * the scale is the international one (thousand, million, billion ...), never lakh or crore.
 * Pure and dependency free. Works on whole numbers (cents are integers everywhere in this app).
 *
 * Style:
 *  - 21 to 99 are hyphenated ("Twenty-One", "Ninety-Nine")
 *  - "and" goes after the hundreds ("One Hundred and One") and before a last group below one
 *    hundred ("One Thousand and One", "One Million and Fifty"), never between larger groups
 *    ("One Million Two Hundred Thousand", "One Thousand One Hundred")
 */

const ONES = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
] as const;

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'] as const;

/** Index = power of 1000. Number.MAX_SAFE_INTEGER (about 9.0e15) needs up to quadrillions. */
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion', 'Quadrillion'] as const;

/** 1 to 99. */
function underHundred(n: number): string {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const ones = n % 10;
  return ones ? `${tens}-${ONES[ones]}` : tens;
}

/** 1 to 999, with the "and" after the hundreds. */
function underThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundreds) return underHundred(rest);
  const head = `${ONES[hundreds]} Hundred`;
  return rest ? `${head} and ${underHundred(rest)}` : head;
}

/** A whole number, not negative, as words. 0 is "Zero". */
function wholeToWords(n: number): string {
  if (n === 0) return 'Zero';
  const groups: number[] = [];
  for (let rest = n; rest > 0; rest = Math.floor(rest / 1000)) groups.push(rest % 1000);
  if (groups.length > SCALES.length) throw new RangeError('Number is too large to write in words');

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    parts.push(SCALES[i] ? `${underThousand(g)} ${SCALES[i]}` : underThousand(g));
  }

  // "One Thousand and One": a closing group below one hundred, after something larger, is joined with "and".
  const last = groups[0];
  if (parts.length > 1 && last > 0 && last < 100) parts.splice(parts.length - 1, 0, 'and');
  return parts.join(' ');
}

function assertSafeInteger(n: number): number {
  if (!Number.isFinite(n)) throw new RangeError('Cannot write a non-finite number in words');
  const whole = Math.round(n);
  if (!Number.isSafeInteger(whole)) throw new RangeError('Number is too large to write in words');
  return whole;
}

/**
 * A whole number in words: 125 -> "One Hundred and Twenty-Five", 0 -> "Zero".
 * Fractions are rounded; negatives get "Minus"; NaN, Infinity and unsafe integers throw a RangeError.
 */
export function numberToWords(n: number): string {
  const whole = assertSafeInteger(n);
  return whole < 0 ? `Minus ${wholeToWords(-whole)}` : wholeToWords(whole);
}

/**
 * An amount in cents as words for a document:
 *
 *   12500000 -> "Rupees One Hundred and Twenty-Five Thousand Only"
 *   12500050 -> "Rupees One Hundred and Twenty-Five Thousand and Fifty Cents Only"
 *   0        -> "Rupees Zero Only"
 *   50       -> "Fifty Cents Only"   (less than one rupee: no rupees part)
 *   101      -> "Rupees One and One Cent Only"
 */
export function amountInWords(cents: number): string {
  const whole = assertSafeInteger(cents);
  const negative = whole < 0;
  const abs = Math.abs(whole);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;

  let words: string;
  if (rupees === 0 && paise > 0) {
    words = `${underHundred(paise)} ${paise === 1 ? 'Cent' : 'Cents'} Only`;
  } else {
    const rupeeWords = `Rupees ${wholeToWords(rupees)}`;
    words = paise ? `${rupeeWords} and ${underHundred(paise)} ${paise === 1 ? 'Cent' : 'Cents'} Only` : `${rupeeWords} Only`;
  }
  return negative ? `Minus ${words}` : words;
}
