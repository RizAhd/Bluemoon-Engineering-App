/**
 * App lock: a 4 to 6 digit PIN, optionally a fingerprint, asked when the app starts and when it comes
 * back after 5 minutes in the background.
 *
 * Everything lives in expo-secure-store (Android keystore), never in SQLite: the database goes into
 * backups and Google's cloud copy, and a PIN must not travel with them or come back on another phone.
 * Only a salted PBKDF2 hash of the PIN is kept. The lock is on exactly when a hash is stored, so a
 * phone restored from a backup never ends up locked with a PIN nobody set on it.
 *
 * Wrong PINs: the first 4 cost nothing; the 5th makes the keypad wait 30 seconds, and every further
 * wrong PIN doubles the wait (up to 30 minutes). The count survives closing the app.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { hashPin, PIN_ITERATIONS, pinLengthOf, verifyPin } from './crypto';
import { reportError } from './errors';

const K_PIN = 'bm_lock_pin';
const K_BIO = 'bm_lock_bio';
const K_FAILS = 'bm_lock_fails';
const K_UNTIL = 'bm_lock_until';

/** Time in the background after which the app asks again. */
export const RELOCK_AFTER_MS = 5 * 60 * 1000;
export const FREE_TRIES = 4;
const FIRST_WAIT_MS = 30_000;
const MAX_WAIT_MS = 30 * 60 * 1000;

/** How long the keypad waits after this many wrong PINs in a row (0 = no wait). */
export function lockoutMs(failures: number): number {
  if (failures <= FREE_TRIES) return 0;
  return Math.min(MAX_WAIT_MS, FIRST_WAIT_MS * 2 ** (failures - FREE_TRIES - 1));
}

export interface LockState {
  /** Secure storage has been read. Until then nothing is locked. */
  ready: boolean;
  enabled: boolean;
  /** Fingerprint / face unlock switched on. */
  bio: boolean;
  /** Digits in the PIN, so the keypad checks as soon as the last one is typed. */
  pinLength: number | null;
  /** The lock screen is showing. */
  locked: boolean;
  failures: number;
  /** Epoch ms until which the keypad does not accept a PIN. */
  waitUntil: number;
}

let state: LockState = { ready: false, enabled: false, bio: false, pinLength: null, locked: false, failures: 0, waitUntil: 0 };
let pinHash: string | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<LockState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getLockState(): LockState {
  return state;
}

export function useLockState(): LockState {
  return useSyncExternalStore(subscribe, getLockState, getLockState);
}

async function read(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch (e) {
    reportError(e, 'lock.read', { key });
    return null;
  }
}

async function write(key: string, value: string | null): Promise<void> {
  if (value == null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

let loading: Promise<void> | null = null;

/** Read secure storage once. `lockNow` locks at once when a PIN is set (the cold start). */
export function loadLock(lockNow = true): Promise<void> {
  loading ??= (async () => {
    const [pin, bio, fails, until] = await Promise.all([read(K_PIN), read(K_BIO), read(K_FAILS), read(K_UNTIL)]);
    pinHash = pin;
    const enabled = !!pin && pinLengthOf(pin) != null;
    set({
      ready: true,
      enabled,
      bio: enabled && bio === '1',
      pinLength: pinLengthOf(pin),
      locked: enabled && lockNow,
      failures: Number(fails) || 0,
      waitUntil: Number(until) || 0,
    });
  })().catch((e) => {
    // Unreadable secure storage must not lock the owner out of their own records.
    reportError(e, 'lock.load');
    set({ ready: true, enabled: false, locked: false });
  });
  return loading;
}

/** For tests: forget what was read. */
export function resetLockForTests() {
  loading = null;
  pinHash = null;
  state = { ready: false, enabled: false, bio: false, pinLength: null, locked: false, failures: 0, waitUntil: 0 };
  listeners.forEach((fn) => fn());
}

export function lockNow() {
  if (state.enabled) set({ locked: true });
}

export function unlock() {
  set({ locked: false });
}

export type PinResult = { ok: true } | { ok: false; waitUntil: number; failures: number };

/** The round count stored in a "pbkdf2$<rounds>$..." hash (0 when it cannot be read). */
function iterationsOf(hash: string): number {
  return Number(hash.split('$')[1]) || 0;
}

/** Check a typed PIN. Wrong ones count towards the wait, right ones clear it. */
export async function tryPin(pin: string, now = Date.now()): Promise<PinResult> {
  if (!pinHash) return { ok: true };
  if (now < state.waitUntil) return { ok: false, waitUntil: state.waitUntil, failures: state.failures };
  if (await verifyPin(pin, pinHash)) {
    set({ failures: 0, waitUntil: 0 });
    await Promise.all([write(K_FAILS, null), write(K_UNTIL, null)]).catch((e) => reportError(e, 'lock.write'));
    // A PIN saved with the old, slow round count is saved again with today's, so the next unlock is quick.
    if (iterationsOf(pinHash) !== PIN_ITERATIONS) {
      hashPin(pin)
        .then(async (fresh) => {
          await write(K_PIN, fresh);
          pinHash = fresh;
        })
        .catch((e) => reportError(e, 'lock.rehash'));
    }
    return { ok: true };
  }
  const failures = state.failures + 1;
  const wait = lockoutMs(failures);
  const waitUntil = wait ? now + wait : 0;
  set({ failures, waitUntil });
  await Promise.all([write(K_FAILS, String(failures)), write(K_UNTIL, waitUntil ? String(waitUntil) : null)]).catch((e) => reportError(e, 'lock.write'));
  return { ok: false, waitUntil, failures };
}

/** Turn the lock on, or change the PIN. */
export async function setPin(pin: string): Promise<void> {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('pin-format');
  const hash = await hashPin(pin);
  await write(K_PIN, hash);
  await Promise.all([write(K_FAILS, null), write(K_UNTIL, null)]);
  pinHash = hash;
  set({ ready: true, enabled: true, pinLength: pin.length, failures: 0, waitUntil: 0, locked: false });
}

/** Turn the lock off (the caller has checked the PIN). */
export async function clearPin(): Promise<void> {
  await Promise.all([write(K_PIN, null), write(K_BIO, null), write(K_FAILS, null), write(K_UNTIL, null)]);
  pinHash = null;
  set({ enabled: false, bio: false, pinLength: null, locked: false, failures: 0, waitUntil: 0 });
}

export async function setBiometric(on: boolean): Promise<void> {
  await write(K_BIO, on ? '1' : null);
  set({ bio: on && state.enabled });
}

/** The phone has a fingerprint (or face) sensor and at least one finger enrolled. */
export async function biometricAvailable(): Promise<boolean> {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

/** Ask for the fingerprint. Resolves true when it matched; false when cancelled, failed or unavailable. */
export async function askBiometric(promptMessage: string, cancelLabel: string): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel, disableDeviceFallback: true });
    return r.success;
  } catch (e) {
    reportError(e, 'lock.biometric');
    return false;
  }
}
