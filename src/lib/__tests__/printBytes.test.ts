/**
 * printBytes: the base64 decoder used for expo-print's output, and the "base64 first, file second"
 * rule that lets PDF export work in Expo Go (which cannot read expo-print's cache file).
 */
import { File, Paths } from 'expo-file-system';

import { base64ToBytes, printedPdfBytes } from '@/lib/printBytes';

const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');
const arr = (u: Uint8Array) => Array.from(u);

describe('base64ToBytes', () => {
  it('decodes an empty string to no bytes', () => {
    expect(base64ToBytes('')).toHaveLength(0);
    expect(base64ToBytes('====')).toHaveLength(0);
  });

  it('decodes text, with one, two or no padding characters', () => {
    expect(Buffer.from(base64ToBytes('TQ==')).toString('latin1')).toBe('M');
    expect(Buffer.from(base64ToBytes('TWE=')).toString('latin1')).toBe('Ma');
    expect(Buffer.from(base64ToBytes('TWFu')).toString('latin1')).toBe('Man');
    expect(Buffer.from(base64ToBytes('aGVsbG8gd29ybGQ=')).toString('latin1')).toBe('hello world');
  });

  it('accepts missing padding', () => {
    expect(Buffer.from(base64ToBytes('TQ')).toString('latin1')).toBe('M');
    expect(Buffer.from(base64ToBytes('TWE')).toString('latin1')).toBe('Ma');
  });

  it('round-trips every byte value, matching Node', () => {
    const all = Array.from({ length: 256 }, (_, i) => i);
    for (const n of [1, 2, 3, 4, 5, 255, 256]) {
      const bytes = all.slice(0, n).reverse();
      expect(arr(base64ToBytes(b64(bytes)))).toEqual(bytes);
    }
  });

  it('ignores whitespace and line breaks (MIME-wrapped base64)', () => {
    const bytes = Array.from({ length: 120 }, (_, i) => (i * 37) % 256);
    const wrapped = (b64(bytes).match(/.{1,76}/g) ?? []).join('\r\n');
    expect(arr(base64ToBytes(`  ${wrapped}\n`))).toEqual(bytes);
  });

  it('decodes URL-safe base64 (- and _ instead of + and /)', () => {
    const bytes = [0xfb, 0xff, 0xbf, 0xfe, 0x3e, 0x00];
    const std = b64(bytes);
    expect(std).toMatch(/[+/]/);
    const urlSafe = std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(arr(base64ToBytes(urlSafe))).toEqual(bytes);
    expect(arr(base64ToBytes(std))).toEqual(bytes);
  });

  it('throws on characters that are not base64', () => {
    expect(() => base64ToBytes('TW*u')).toThrow('Invalid base64 data');
    expect(() => base64ToBytes('abc!')).toThrow('Invalid base64 data');
    expect(() => base64ToBytes('TWFué')).toThrow('Invalid base64 data');
    expect(() => base64ToBytes('ab.c')).toThrow('Invalid base64 data');
  });

  it('decodes a real PDF header', () => {
    const pdf = Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'latin1');
    expect(arr(base64ToBytes(pdf.toString('base64')))).toEqual(Array.from(pdf));
  });
});

describe('printedPdfBytes', () => {
  const fileWith = (bytes: number[]) => {
    const f = new File(Paths.cache, `printed-${Math.random().toString(36).slice(2)}.pdf`);
    f.create();
    f.writeSync(new Uint8Array(bytes));
    return f;
  };

  it('prefers the base64 the print call returned over the file', () => {
    const f = fileWith([1, 2, 3]);
    expect(arr(printedPdfBytes({ uri: f.uri, base64: b64([7, 8, 9, 10]) }))).toEqual([7, 8, 9, 10]);
  });

  it('never touches the file when base64 is there (Expo Go cannot read it)', () => {
    const missing = new File(Paths.cache, 'never-written.pdf');
    expect(missing.exists).toBe(false);
    expect(arr(printedPdfBytes({ uri: missing.uri, base64: b64([37, 80, 68, 70]) }))).toEqual([37, 80, 68, 70]);
  });

  it('reads the file when no base64 came back (undefined, null or empty)', () => {
    const f = fileWith([4, 5, 6]);
    expect(arr(printedPdfBytes({ uri: f.uri }))).toEqual([4, 5, 6]);
    expect(arr(printedPdfBytes({ uri: f.uri, base64: null }))).toEqual([4, 5, 6]);
    expect(arr(printedPdfBytes({ uri: f.uri, base64: '' }))).toEqual([4, 5, 6]);
  });

  it('fails when there is neither base64 nor a readable file', () => {
    expect(() => printedPdfBytes({ uri: new File(Paths.cache, 'gone.pdf').uri })).toThrow();
  });

  it('passes bad base64 on as an error instead of returning garbage', () => {
    const f = fileWith([1]);
    expect(() => printedPdfBytes({ uri: f.uri, base64: 'not base64!' })).toThrow('Invalid base64 data');
  });
});
