/**
 * Amounts in words for the estimate PDF: international scale (never lakh / crore), hyphenated
 * 21 to 99, "and" after the hundreds and before a closing group below one hundred.
 */
import { amountInWords, numberToWords } from '@/lib/numberToWords';

describe('numberToWords', () => {
  it.each([
    [0, 'Zero'],
    [1, 'One'],
    [9, 'Nine'],
    [10, 'Ten'],
    [11, 'Eleven'],
    [12, 'Twelve'],
    [13, 'Thirteen'],
    [15, 'Fifteen'],
    [19, 'Nineteen'],
    [20, 'Twenty'],
    [21, 'Twenty-One'],
    [30, 'Thirty'],
    [40, 'Forty'],
    [45, 'Forty-Five'],
    [50, 'Fifty'],
    [66, 'Sixty-Six'],
    [70, 'Seventy'],
    [80, 'Eighty'],
    [87, 'Eighty-Seven'],
    [90, 'Ninety'],
    [99, 'Ninety-Nine'],
  ])('%i -> %s', (n, words) => {
    expect(numberToWords(n)).toBe(words);
  });

  it.each([
    [100, 'One Hundred'],
    [101, 'One Hundred and One'],
    [110, 'One Hundred and Ten'],
    [111, 'One Hundred and Eleven'],
    [120, 'One Hundred and Twenty'],
    [125, 'One Hundred and Twenty-Five'],
    [200, 'Two Hundred'],
    [999, 'Nine Hundred and Ninety-Nine'],
  ])('hundreds: %i -> %s', (n, words) => {
    expect(numberToWords(n)).toBe(words);
  });

  it.each([
    [1000, 'One Thousand'],
    [1001, 'One Thousand and One'],
    [1010, 'One Thousand and Ten'],
    [1099, 'One Thousand and Ninety-Nine'],
    [1100, 'One Thousand One Hundred'],
    [1101, 'One Thousand One Hundred and One'],
    [2500, 'Two Thousand Five Hundred'],
    [10000, 'Ten Thousand'],
    [12345, 'Twelve Thousand Three Hundred and Forty-Five'],
    [21000, 'Twenty-One Thousand'],
    [100000, 'One Hundred Thousand'],
    [100001, 'One Hundred Thousand and One'],
    [125000, 'One Hundred and Twenty-Five Thousand'],
    [999999, 'Nine Hundred and Ninety-Nine Thousand Nine Hundred and Ninety-Nine'],
  ])('thousands: %i -> %s', (n, words) => {
    expect(numberToWords(n)).toBe(words);
  });

  it.each([
    [1_000_000, 'One Million'],
    [1_000_001, 'One Million and One'],
    [1_000_100, 'One Million One Hundred'],
    [1_001_000, 'One Million One Thousand'],
    [1_200_005, 'One Million Two Hundred Thousand and Five'],
    [2_050_000, 'Two Million Fifty Thousand'],
    [12_345_678, 'Twelve Million Three Hundred and Forty-Five Thousand Six Hundred and Seventy-Eight'],
    [1_000_000_000, 'One Billion'],
    [1_000_000_007, 'One Billion and Seven'],
    [1_000_000_000_000, 'One Trillion'],
    [
      999_999_999_999,
      'Nine Hundred and Ninety-Nine Billion Nine Hundred and Ninety-Nine Million Nine Hundred and Ninety-Nine Thousand Nine Hundred and Ninety-Nine',
    ],
  ])('millions and above: %i -> %s', (n, words) => {
    expect(numberToWords(n)).toBe(words);
  });

  it('goes up to the largest safe integer (in quadrillions)', () => {
    expect(numberToWords(1_000_000_000_000_000)).toBe('One Quadrillion');
    expect(numberToWords(Number.MAX_SAFE_INTEGER)).toBe(
      'Nine Quadrillion Seven Trillion One Hundred and Ninety-Nine Billion Two Hundred and Fifty-Four Million Seven Hundred and Forty Thousand Nine Hundred and Ninety-One',
    );
  });

  it('never uses lakh or crore', () => {
    for (const n of [100_000, 1_000_000, 10_000_000, 12_345_678, 1_234_567_890]) {
      expect(numberToWords(n)).not.toMatch(/lakh|crore/i);
    }
  });

  it('rounds fractions, writes negatives with Minus, and refuses what has no words', () => {
    expect(numberToWords(12.4)).toBe('Twelve');
    expect(numberToWords(12.6)).toBe('Thirteen');
    expect(numberToWords(-21)).toBe('Minus Twenty-One');
    expect(() => numberToWords(NaN)).toThrow(RangeError);
    expect(() => numberToWords(Infinity)).toThrow(RangeError);
    expect(() => numberToWords(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });
});

describe('amountInWords (cents)', () => {
  it('writes whole rupees with "Rupees ... Only"', () => {
    expect(amountInWords(12_500_000)).toBe('Rupees One Hundred and Twenty-Five Thousand Only');
    expect(amountInWords(100)).toBe('Rupees One Only');
    expect(amountInWords(11_00)).toBe('Rupees Eleven Only');
    expect(amountInWords(100_00)).toBe('Rupees One Hundred Only');
    expect(amountInWords(101_00)).toBe('Rupees One Hundred and One Only');
    expect(amountInWords(1_000_00)).toBe('Rupees One Thousand Only');
    expect(amountInWords(100_000_00)).toBe('Rupees One Hundred Thousand Only');
    expect(amountInWords(1_000_001_00)).toBe('Rupees One Million and One Only');
    expect(amountInWords(999_999_999_999_00)).toBe(
      'Rupees Nine Hundred and Ninety-Nine Billion Nine Hundred and Ninety-Nine Million Nine Hundred and Ninety-Nine Thousand Nine Hundred and Ninety-Nine Only',
    );
  });

  it('writes cents after "and"', () => {
    expect(amountInWords(12_500_050)).toBe('Rupees One Hundred and Twenty-Five Thousand and Fifty Cents Only');
    expect(amountInWords(1_01)).toBe('Rupees One and One Cent Only');
    expect(amountInWords(1_21)).toBe('Rupees One and Twenty-One Cents Only');
    expect(amountInWords(5_000_00 + 99)).toBe('Rupees Five Thousand and Ninety-Nine Cents Only');
    expect(amountInWords(1_000_000_01)).toBe('Rupees One Million and One Cent Only');
  });

  it('writes zero as "Rupees Zero Only"', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only');
  });

  it('writes less than a rupee as cents only', () => {
    expect(amountInWords(1)).toBe('One Cent Only');
    expect(amountInWords(50)).toBe('Fifty Cents Only');
    expect(amountInWords(99)).toBe('Ninety-Nine Cents Only');
    expect(amountInWords(21)).toBe('Twenty-One Cents Only');
  });

  it('every cent value from 0 to 99 over a few rupee amounts reads cleanly', () => {
    for (const rupees of [0, 1, 7, 20, 101, 1000, 12_345]) {
      for (let cents = 0; cents < 100; cents++) {
        const words = amountInWords(rupees * 100 + cents);
        expect(words).toMatch(/Only$/);
        expect(words).not.toMatch(/\s{2,}|undefined|NaN|null/);
        expect(words.includes('Cent')).toBe(cents > 0);
        if (rupees > 0) expect(words.startsWith('Rupees ')).toBe(true);
      }
    }
  });

  it('puts no "and" between large groups, only after hundreds and before a closing group below one hundred', () => {
    expect(amountInWords(1_100_00)).toBe('Rupees One Thousand One Hundred Only');
    expect(amountInWords(1_050_000_00)).toBe('Rupees One Million Fifty Thousand Only');
    expect(amountInWords(1_000_050_00)).toBe('Rupees One Million and Fifty Only');
  });

  it('rounds a stray fraction of a cent instead of failing, and rejects what cannot be written', () => {
    expect(amountInWords(100.4)).toBe('Rupees One Only');
    expect(amountInWords(-12_500)).toBe('Minus Rupees One Hundred and Twenty-Five Only');
    expect(() => amountInWords(NaN)).toThrow(RangeError);
    expect(() => amountInWords(Infinity)).toThrow(RangeError);
  });
});
