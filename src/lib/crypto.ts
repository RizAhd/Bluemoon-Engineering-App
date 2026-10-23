/**
 * Password encryption for full backups, and PIN hashing for the app lock.
 *
 * Encrypted file ("envelope"), all integers big-endian:
 *
 *   0   6  magic "BMENC1"
 *   6   1  key derivation: 1 = PBKDF2-HMAC-SHA256
 *   7   4  iterations
 *   11 16  salt (random)
 *   27 12  nonce (random)
 *   39  …  AES-256-GCM ciphertext followed by its 16-byte tag
 *
 * The 39 header bytes are the GCM additional data, so changing the iteration count or the salt makes
 * the file fail to open instead of silently deriving another key. A wrong password and a damaged file
 * look the same to GCM: both are reported as `WrongPasswordError`.
 *
 * AES runs in the phone's native crypto (expo-crypto) when it is there, because pure JavaScript on
 * Hermes takes many seconds for a 40 MB part; otherwise @noble/ciphers does it. Both produce the same
 * bytes (standard GCM, 12-byte nonce, 16-byte tag), so a file made one way opens the other way.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as Crypto from 'expo-crypto';

import { encodeUtf8 } from './utf8';

export const MAGIC = 'BMENC1';
const KDF_PBKDF2_SHA256 = 1;
const HEADER = 39;
const TAG = 16;
/**
 * One-off work when a backup is made or opened. PBKDF2 runs in JavaScript here (Hermes has no JIT): about
 * 2,000 rounds a second on a mid-range phone, so 10,000 is a few seconds behind a busy state. Files made with
 * more rounds still open: the count is read from the file.
 */
export const BACKUP_ITERATIONS = 10_000;
/**
 * Typed every time the app opens, so it must answer in well under a second. The hash never leaves the phone's
 * keystore-backed secure storage and wrong PINs are rate-limited, which is what protects a 4-6 digit PIN;
 * more rounds would only make every unlock slow. Older, slower hashes are replaced after the next right PIN.
 */
export const PIN_ITERATIONS = 1_000;
/** Refuse files that would make the phone work for minutes. */
const MAX_ITERATIONS = 5_000_000;

export class WrongPasswordError extends Error {
  constructor() {
    super('wrong-password');
  }
}

function deriveKey(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, encodeUtf8(secret), salt, { c: iterations, dkLen: 32, asyncTick: 50 });
}

/** True when the bytes start with the envelope's magic. */
export function isEncrypted(bytes: Uint8Array): boolean {
  if (bytes.byteLength < HEADER + TAG) return false;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
  return true;
}

// ---------------------------------------------------------------- AES-GCM, native first

export type NativeAes = {
  AESEncryptionKey: { import(bytes: Uint8Array): Promise<unknown> };
  AESSealedData: { fromParts(iv: Uint8Array, ciphertextWithTag: Uint8Array, tagLength?: number): unknown };
  aesEncryptAsync(plain: Uint8Array, key: unknown, options: object): Promise<{ ciphertext(o: { includeTag: boolean }): Promise<Uint8Array> }>;
  aesDecryptAsync(sealed: unknown, key: unknown, options: object): Promise<Uint8Array>;
};

let override: NativeAes | null | undefined;

/** Tests only: stand in for (or, with null, hide) the native AES. `undefined` goes back to expo-crypto. */
export function setNativeAesForTests(impl: NativeAes | null | undefined) {
  override = impl;
}

function nativeAes(): NativeAes | null {
  if (override !== undefined) return override;
  const c = Crypto as unknown as Partial<NativeAes>;
  return c.AESEncryptionKey && c.AESSealedData && c.aesEncryptAsync && c.aesDecryptAsync ? (c as NativeAes) : null;
}

async function sealGcm(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
  const native = nativeAes();
  if (native) {
    try {
      const k = await native.AESEncryptionKey.import(key);
      const sealed = await native.aesEncryptAsync(plain, k, { nonce: { bytes: nonce }, additionalData: aad, tagLength: TAG });
      return await sealed.ciphertext({ includeTag: true });
    } catch {
      // fall through to the JavaScript implementation
    }
  }
  return gcm(key, nonce, aad).encrypt(plain);
}

async function openGcm(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, sealed: Uint8Array): Promise<Uint8Array> {
  const native = nativeAes();
  if (native) {
    try {
      const k = await native.AESEncryptionKey.import(key);
      return await native.aesDecryptAsync(native.AESSealedData.fromParts(nonce, sealed, TAG), k, { additionalData: aad });
    } catch {
      // a wrong password or a native problem: the JavaScript implementation decides which
    }
  }
  try {
    return gcm(key, nonce, aad).decrypt(sealed);
  } catch {
    throw new WrongPasswordError();
  }
}

// ---------------------------------------------------------------- envelope

export async function encryptBytes(plain: Uint8Array, password: string, iterations = BACKUP_ITERATIONS): Promise<Uint8Array> {
  const salt = Crypto.getRandomBytes(16);
  const nonce = Crypto.getRandomBytes(12);
  const header = new Uint8Array(HEADER);
  for (let i = 0; i < MAGIC.length; i++) header[i] = MAGIC.charCodeAt(i);
  header[6] = KDF_PBKDF2_SHA256;
  new DataView(header.buffer).setUint32(7, iterations);
  header.set(salt, 11);
  header.set(nonce, 27);
  const key = await deriveKey(password, salt, iterations);
  const sealed = await sealGcm(key, nonce, header, plain);
  const out = new Uint8Array(HEADER + sealed.byteLength);
  out.set(header, 0);
  out.set(sealed, HEADER);
  return out;
}

export async function decryptBytes(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  if (!isEncrypted(bytes)) throw new WrongPasswordError();
  const header = bytes.slice(0, HEADER);
  const iterations = new DataView(header.buffer).getUint32(7);
  if (header[6] !== KDF_PBKDF2_SHA256 || iterations < 1 || iterations > MAX_ITERATIONS) throw new WrongPasswordError();
  const key = await deriveKey(password, header.slice(11, 27), iterations);
  return openGcm(key, header.slice(27, 39), header, bytes.subarray(HEADER));
}

// ---------------------------------------------------------------- PIN hash

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** "pbkdf2$<iterations>$<pin length>$<salt hex>$<hash hex>". The length lets the keypad check as soon as the last digit is typed. */
export async function hashPin(pin: string, iterations = PIN_ITERATIONS): Promise<string> {
  const salt = Crypto.getRandomBytes(16);
  const hash = await deriveKey(pin, salt, iterations);
  return `pbkdf2$${iterations}$${pin.length}$${hex(salt)}$${hex(hash)}`;
}

export function pinLengthOf(stored: string | null): number | null {
  const n = Number(stored?.split('$')[2]);
  return Number.isInteger(n) && n >= 4 && n <= 6 ? n : null;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, iter, , saltHex, hashHex] = stored.split('$');
  const iterations = Number(iter);
  if (scheme !== 'pbkdf2' || !Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS || !saltHex || !hashHex) return false;
  const got = await deriveKey(pin, unhex(saltHex), iterations);
  const want = unhex(hashHex);
  if (got.length !== want.length) return false;
  // compare every byte, so the time taken says nothing about where the first difference is
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
