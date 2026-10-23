/**
 * crypto.ts: the encrypted backup envelope and the PIN hash. Low iteration counts keep the tests fast;
 * the count is stored in the envelope / hash, so the code path is the same as with the real one.
 */
import { createCipheriv, createDecipheriv } from 'node:crypto';

import { decryptBytes, encryptBytes, hashPin, isEncrypted, MAGIC, pinLengthOf, setNativeAesForTests, verifyPin, WrongPasswordError, type NativeAes } from '@/lib/crypto';

const FAST = 1000;
const bytes = (n: number, seed = 7) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

describe('encryptBytes / decryptBytes', () => {
  it('round-trips, starts with the magic, and carries the iteration count', async () => {
    const plain = bytes(10_000);
    const sealed = await encryptBytes(plain, 'site-office-2026', FAST);
    expect(new TextDecoder().decode(sealed.slice(0, 6))).toBe(MAGIC);
    expect(sealed[6]).toBe(1);
    expect(new DataView(sealed.buffer).getUint32(7)).toBe(FAST);
    expect(sealed.byteLength).toBe(plain.byteLength + 39 + 16);
    expect(isEncrypted(sealed)).toBe(true);
    expect(await decryptBytes(sealed, 'site-office-2026')).toEqual(plain);
  });

  it('never repeats: the same input twice gives different files (random salt and nonce)', async () => {
    const plain = bytes(64);
    const one = await encryptBytes(plain, 'password1', FAST);
    const two = await encryptBytes(plain, 'password1', FAST);
    expect(Buffer.from(one).equals(Buffer.from(two))).toBe(false);
  });

  it('does not contain the plain bytes', async () => {
    const plain = new TextEncoder().encode('Nimal Perera 077 123 4567 '.repeat(50));
    const sealed = await encryptBytes(plain, 'password1', FAST);
    expect(Buffer.from(sealed).includes(Buffer.from('Nimal Perera'))).toBe(false);
  });

  it('a wrong password is refused', async () => {
    const sealed = await encryptBytes(bytes(100), 'right-password', FAST);
    await expect(decryptBytes(sealed, 'wrong-password')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('a changed byte anywhere (header, ciphertext or tag) is refused', async () => {
    const sealed = await encryptBytes(bytes(100), 'password1', FAST);
    for (const at of [8, 15, 30, 45, sealed.byteLength - 1]) {
      const bad = sealed.slice();
      bad[at] ^= 1;
      await expect(decryptBytes(bad, 'password1')).rejects.toBeInstanceOf(WrongPasswordError);
    }
  });

  it('plain zips and short or random files are not taken for encrypted ones', async () => {
    expect(isEncrypted(new Uint8Array([0x50, 0x4b, 3, 4, ...bytes(100)]))).toBe(false);
    expect(isEncrypted(new TextEncoder().encode('BMENC1'))).toBe(false);
    await expect(decryptBytes(bytes(200), 'x')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('refuses a file that asks for an absurd amount of work', async () => {
    const sealed = await encryptBytes(bytes(10), 'password1', FAST);
    new DataView(sealed.buffer).setUint32(7, 0xffffffff);
    await expect(decryptBytes(sealed, 'password1')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('keeps Sinhala and Tamil passwords exact', async () => {
    const sealed = await encryptBytes(bytes(32), 'බ්ලූමූන්-நீலநிலா', FAST);
    expect(await decryptBytes(sealed, 'බ්ලූමූන්-நீலநிலா')).toEqual(bytes(32));
    await expect(decryptBytes(sealed, 'බ්ලූමූන්')).rejects.toBeInstanceOf(WrongPasswordError);
  });
});

describe('native AES (expo-crypto) and the JavaScript fallback make the same files', () => {
  // A stand-in for expo-crypto's native AES, built on node's own AES-GCM.
  function nativeStandIn() {
    class Key {
      constructor(readonly raw: Uint8Array) {}
      static async import(raw: Uint8Array) {
        return new Key(raw);
      }
    }
    class Sealed {
      constructor(
        readonly iv: Uint8Array,
        readonly body: Uint8Array,
      ) {}
      static fromParts(iv: Uint8Array, body: Uint8Array) {
        return new Sealed(iv, body);
      }
      async ciphertext() {
        return this.body;
      }
    }
    return {
      AESEncryptionKey: Key,
      AESSealedData: Sealed,
      aesEncryptAsync: jest.fn(async (plain: Uint8Array, key: Key, o: { nonce: { bytes: Uint8Array }; additionalData: Uint8Array }) => {
        const c = createCipheriv('aes-256-gcm', key.raw, o.nonce.bytes);
        c.setAAD(o.additionalData);
        const body = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
        return new Sealed(o.nonce.bytes, new Uint8Array(body));
      }),
      aesDecryptAsync: jest.fn(async (s: Sealed, key: Key, o: { additionalData: Uint8Array }) => {
        const d = createDecipheriv('aes-256-gcm', key.raw, s.iv);
        d.setAAD(o.additionalData);
        d.setAuthTag(s.body.subarray(s.body.length - 16));
        return new Uint8Array(Buffer.concat([d.update(s.body.subarray(0, s.body.length - 16)), d.final()]));
      }),
    };
  }

  afterEach(() => setNativeAesForTests(undefined));

  it('a file sealed natively opens with the JavaScript code, and the other way round', async () => {
    const plain = bytes(5000, 3);
    const native = nativeStandIn();
    setNativeAesForTests(native as unknown as NativeAes);
    const nativeSealed = await encryptBytes(plain, 'password1', FAST);
    expect(native.aesEncryptAsync).toHaveBeenCalled();
    const jsSealed = await (async () => {
      setNativeAesForTests(null);
      return encryptBytes(plain, 'password1', FAST);
    })();
    expect(await decryptBytes(nativeSealed, 'password1')).toEqual(plain);

    setNativeAesForTests(native as unknown as NativeAes);
    expect(await decryptBytes(jsSealed, 'password1')).toEqual(plain);
    expect(native.aesDecryptAsync).toHaveBeenCalled();
  });

  it('a wrong password is still a WrongPasswordError when native AES is used', async () => {
    const sealed = await encryptBytes(bytes(50), 'password1', FAST);
    setNativeAesForTests(nativeStandIn() as unknown as NativeAes);
    await expect(decryptBytes(sealed, 'nope-nope')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('a native module that throws falls back to JavaScript instead of failing the backup', async () => {
    const broken = nativeStandIn();
    broken.aesEncryptAsync.mockRejectedValue(new Error('native AES unavailable'));
    setNativeAesForTests(broken as unknown as NativeAes);
    const sealed = await encryptBytes(bytes(40), 'password1', FAST);
    setNativeAesForTests(null);
    expect(await decryptBytes(sealed, 'password1')).toEqual(bytes(40));
  });
});

describe('PIN hash', () => {
  it('verifies the right PIN only, and stores no digits in the clear', async () => {
    const stored = await hashPin('482915', FAST);
    expect(stored).not.toContain('482915');
    expect(stored.split('$')).toHaveLength(5);
    expect(pinLengthOf(stored)).toBe(6);
    expect(await verifyPin('482915', stored)).toBe(true);
    expect(await verifyPin('482916', stored)).toBe(false);
    expect(await verifyPin('48291', stored)).toBe(false);
    expect(await verifyPin('', stored)).toBe(false);
  });

  it('the same PIN hashes differently each time (random salt)', async () => {
    expect(await hashPin('1357', FAST)).not.toBe(await hashPin('1357', FAST));
  });

  it('a malformed stored value never verifies', async () => {
    for (const bad of ['', 'plain1234', 'pbkdf2$x$4$00$00', 'md5$1000$4$aa$bb', 'pbkdf2$99999999$4$aa$bb']) {
      expect(await verifyPin('1234', bad)).toBe(false);
    }
    expect(pinLengthOf(null)).toBeNull();
    expect(pinLengthOf('pbkdf2$1000$9$aa$bb')).toBeNull();
  });
});
