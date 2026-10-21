/**
 * UTF-8 helpers. Uses TextEncoder/TextDecoder when the JS engine has them and
 * falls back to a small manual codec, so PDF and backup import never depend on
 * what a particular Hermes build ships.
 */

export function encodeUtf8(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}

export function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let s = '';
  let i = 0;
  const chunk: number[] = [];
  const flush = () => {
    s += String.fromCodePoint(...chunk);
    chunk.length = 0;
  };
  while (i < bytes.length) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b >> 5 === 6) cp = ((b & 31) << 6) | (bytes[i++] & 63);
    else if (b >> 4 === 14) cp = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    chunk.push(cp);
    if (chunk.length >= 4096) flush();
  }
  flush();
  return s;
}
