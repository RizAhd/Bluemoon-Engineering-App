import { decodeUtf8, encodeUtf8 } from '@/lib/utf8';

const SAMPLES: [name: string, text: string][] = [
  ['an empty string', ''],
  ['ASCII', 'Bluemoon Engineering, Welimada - site #12 (2026) <a href="x">&amp;</a>'],
  ['2-byte characters', 'café façade naïve £50 ©'],
  ['Sinhala', 'සුභ උදෑසනක්'],
  ['Tamil', 'காலை வணக்கம்'],
  ['emoji with ZWJ and variation selectors', '👷‍♂️🏗️ 🧱'],
  ['a 4-byte code point', '\u{1D11E}'],
  ['the last code point', '\u{10FFFF}'],
  ['mixed scripts', 'Rs 12,500.50 – සුභ – வணக்கம் – 😀'],
  ['control characters', 'line1\nline2\r\n\ttab\0null'],
];

/** Hand-checked UTF-8 byte sequences. */
const KNOWN: [text: string, bytes: number[]][] = [
  ['A', [0x41]],
  ['\u007f', [0x7f]],
  ['\u0080', [0xc2, 0x80]],
  ['é', [0xc3, 0xa9]],
  ['߿', [0xdf, 0xbf]],
  ['ࠀ', [0xe0, 0xa0, 0x80]],
  ['€', [0xe2, 0x82, 0xac]],
  ['ස', [0xe0, 0xb7, 0x83]],
  ['க', [0xe0, 0xae, 0x95]],
  ['￿', [0xef, 0xbf, 0xbf]],
  ['\u{10000}', [0xf0, 0x90, 0x80, 0x80]],
  ['😀', [0xf0, 0x9f, 0x98, 0x80]],
  ['\u{1D11E}', [0xf0, 0x9d, 0x84, 0x9e]],
  ['\u{10FFFF}', [0xf4, 0x8f, 0xbf, 0xbf]],
];

/** Every Unicode scalar value in the BMP plus the first and last supplementary planes' edges. */
function everyScalarValue(): string {
  const parts: string[] = [];
  for (let cp = 0; cp < 0x10000; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue; // surrogates are not scalar values
    parts.push(String.fromCodePoint(cp));
  }
  for (let cp = 0x10000; cp < 0x10400; cp++) parts.push(String.fromCodePoint(cp));
  for (let cp = 0x1f300; cp < 0x1fb00; cp++) parts.push(String.fromCodePoint(cp));
  for (let cp = 0x10fc00; cp <= 0x10ffff; cp++) parts.push(String.fromCodePoint(cp));
  return parts.join('');
}

function codecBehaviour() {
  it.each(SAMPLES)('round-trips %s', (_name, text) => {
    const bytes = encodeUtf8(text);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(decodeUtf8(bytes)).toBe(text);
  });

  it.each(KNOWN)('encodes %j to the standard bytes and back', (text, bytes) => {
    expect(Array.from(encodeUtf8(text))).toEqual(bytes);
    expect(decodeUtf8(Uint8Array.from(bytes))).toBe(text);
  });

  it('uses 1 to 4 bytes per code point', () => {
    expect(encodeUtf8('abc')).toHaveLength(3);
    expect(encodeUtf8('é')).toHaveLength(2);
    expect(encodeUtf8('ස')).toHaveLength(3);
    expect(encodeUtf8('😀')).toHaveLength(4);
    expect(encodeUtf8('සුභ උදෑසනක්')).toHaveLength(31);
    expect(encodeUtf8('காலை வணக்கம்')).toHaveLength(34);
  });

  it('round-trips every scalar value, including runs longer than the decoder chunk', () => {
    const text = everyScalarValue();
    expect(text.length).toBeGreaterThan(65_000);
    expect(decodeUtf8(encodeUtf8(text))).toBe(text);
  });

  it('round-trips a long multilingual document', () => {
    const text = 'සුභ උදෑසනක් – காலை வணக்கம் – Good morning 😀\n'.repeat(2_000);
    expect(decodeUtf8(encodeUtf8(text))).toBe(text);
  });

  it('round-trips JSON the way backup and PDF bundles use it', () => {
    const bundle = { project: 'වැලිමඩ පාලම', worker: 'முருகன்', note: '👷‍♂️ 12,500.50', n: [1, 2, 3] };
    const json = JSON.stringify(bundle);
    expect(JSON.parse(decodeUtf8(encodeUtf8(json)))).toEqual(bundle);
  });
}

type Globals = Record<string, unknown>;
const g = globalThis as unknown as Globals;

describe('utf8 with the engine TextEncoder/TextDecoder', () => {
  beforeAll(() => {
    // Make sure this block really exercises the native path.
    expect(typeof TextEncoder).toBe('function');
    expect(typeof TextDecoder).toBe('function');
  });

  codecBehaviour();
});

describe('utf8 fallback codec (engine without TextEncoder/TextDecoder)', () => {
  let NativeEncoder: typeof TextEncoder;
  let NativeDecoder: typeof TextDecoder;

  beforeAll(() => {
    NativeEncoder = g.TextEncoder as typeof TextEncoder;
    NativeDecoder = g.TextDecoder as typeof TextDecoder;
    delete g.TextEncoder;
    delete g.TextDecoder;
    // Make sure this block really exercises the fallback path.
    expect(typeof TextEncoder).toBe('undefined');
    expect(typeof TextDecoder).toBe('undefined');
  });

  afterAll(() => {
    g.TextEncoder = NativeEncoder;
    g.TextDecoder = NativeDecoder;
    expect(typeof TextEncoder).toBe('function');
    expect(typeof TextDecoder).toBe('function');
  });

  codecBehaviour();

  it('produces exactly the bytes the engine encoder produces', () => {
    const native = new NativeEncoder();
    for (const [, text] of SAMPLES) {
      expect(Array.from(encodeUtf8(text))).toEqual(Array.from(native.encode(text)));
    }
    const all = everyScalarValue();
    expect(encodeUtf8(all)).toEqual(native.encode(all));
  });

  it('decodes engine-encoded bytes identically to the engine decoder', () => {
    const encoder = new NativeEncoder();
    const decoder = new NativeDecoder();
    for (const [, text] of SAMPLES) {
      const bytes = encoder.encode(text);
      expect(decodeUtf8(bytes)).toBe(decoder.decode(bytes));
    }
  });
});
