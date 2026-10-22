import { File } from 'expo-file-system';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  // URL-safe variants, in case a platform hands them back
  t['-'.charCodeAt(0)] = 62;
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

/** Decodes standard or URL-safe base64; whitespace and padding are ignored. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const v = code < 128 ? LOOKUP[code] : -1;
    if (v < 0) throw new Error('Invalid base64 data');
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/**
 * The PDF expo-print just made. Prefers the base64 the print call returns: Expo Go's scoped file
 * system refuses to read expo-print's cache file ("Missing 'READ' permission"), so reading the file
 * back only works in the installed app. Falls back to the file when no base64 came back.
 */
export function printedPdfBytes(out: { uri: string; base64?: string | null }): Uint8Array {
  if (out.base64) return base64ToBytes(out.base64);
  return new File(out.uri).bytesSync();
}
