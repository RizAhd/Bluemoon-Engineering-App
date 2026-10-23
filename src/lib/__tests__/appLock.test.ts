/**
 * appLock.ts: PIN kept only as a hash in secure storage, the wait after wrong PINs, and that a lock
 * which cannot be read never locks the owner out.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import {
  askBiometric,
  biometricAvailable,
  clearPin,
  getLockState,
  loadLock,
  lockNow,
  lockoutMs,
  resetLockForTests,
  setBiometric,
  setPin,
  tryPin,
  unlock,
} from '@/lib/appLock';

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(() => {
  store.clear();
  resetLockForTests();
  jest.clearAllMocks();
});

describe('lockoutMs', () => {
  it('4 free tries, then 30 s doubling, capped at 30 minutes', () => {
    expect([0, 1, 4].map(lockoutMs)).toEqual([0, 0, 0]);
    expect(lockoutMs(5)).toBe(30_000);
    expect(lockoutMs(6)).toBe(60_000);
    expect(lockoutMs(7)).toBe(120_000);
    expect(lockoutMs(20)).toBe(30 * 60_000);
  });
});

describe('the lock', () => {
  it('is off, and never locks, when no PIN was ever set', async () => {
    await loadLock(true);
    expect(getLockState()).toMatchObject({ ready: true, enabled: false, locked: false });
    lockNow();
    expect(getLockState().locked).toBe(false);
    expect((await tryPin('0000')).ok).toBe(true);
  });

  it('keeps only a hash of the PIN, in secure storage', async () => {
    await setPin('2468');
    const values = [...store.values()].join(' ');
    expect(values).not.toContain('2468');
    expect(store.get('bm_lock_pin')).toMatch(/^pbkdf2\$\d+\$4\$/);
    expect(getLockState()).toMatchObject({ enabled: true, pinLength: 4, locked: false });
  });

  it('locks at start when a PIN is set, and opens with the right PIN only', async () => {
    await setPin('135790');
    resetLockForTests(); // the app starts again
    await loadLock(true);
    expect(getLockState()).toMatchObject({ enabled: true, locked: true, pinLength: 6 });
    expect((await tryPin('000000')).ok).toBe(false);
    expect(getLockState().failures).toBe(1);
    expect((await tryPin('135790')).ok).toBe(true);
    expect(getLockState().failures).toBe(0);
  });

  it('makes the keypad wait after the 5th wrong PIN, even across a restart, and the right PIN is refused while waiting', async () => {
    await setPin('1111');
    const t0 = 1_800_000_000_000;
    for (let i = 0; i < 4; i++) expect(await tryPin('9999', t0)).toMatchObject({ ok: false, waitUntil: 0 });
    const fifth = await tryPin('9999', t0);
    expect(fifth).toEqual({ ok: false, failures: 5, waitUntil: t0 + 30_000 });

    resetLockForTests();
    await loadLock(true);
    expect(getLockState()).toMatchObject({ failures: 5, waitUntil: t0 + 30_000 });
    expect((await tryPin('1111', t0 + 10_000)).ok).toBe(false);
    expect(getLockState().failures).toBe(5); // waiting does not count as another try
    const sixth = await tryPin('9999', t0 + 31_000);
    expect(sixth).toEqual({ ok: false, failures: 6, waitUntil: t0 + 31_000 + 60_000 });
    expect((await tryPin('1111', t0 + 92_000)).ok).toBe(true);
    expect(store.has('bm_lock_fails')).toBe(false);
  });

  it('turning it off removes everything it stored', async () => {
    await setPin('1234');
    await setBiometric(true);
    await clearPin();
    expect(store.size).toBe(0);
    expect(getLockState()).toMatchObject({ enabled: false, bio: false, locked: false });
  });

  it('refuses a PIN that is not 4 to 6 digits', async () => {
    for (const bad of ['123', '1234567', '12a4', '']) await expect(setPin(bad)).rejects.toThrow('pin-format');
    expect(store.size).toBe(0);
  });

  it('lockNow / unlock', async () => {
    await setPin('1234');
    lockNow();
    expect(getLockState().locked).toBe(true);
    unlock();
    expect(getLockState().locked).toBe(false);
  });

  it('a secure storage that cannot be read leaves the app open (and logs it)', async () => {
    store.set('bm_lock_pin', 'pbkdf2$1000$4$00$00');
    for (let i = 0; i < 4; i++) (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keystore unavailable'));
    await loadLock(true);
    expect(getLockState()).toMatchObject({ ready: true, enabled: false, locked: false });
  });
});

describe('fingerprint', () => {
  it('is available only with a sensor and an enrolled finger', async () => {
    expect(await biometricAvailable()).toBe(false);
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
    expect(await biometricAvailable()).toBe(false);
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
    expect(await biometricAvailable()).toBe(true);
  });

  it('asks without the device-PIN fallback, and a thrown error counts as "no"', async () => {
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });
    expect(await askBiometric('Unlock', 'Use PIN')).toBe(true);
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith(expect.objectContaining({ disableDeviceFallback: true, cancelLabel: 'Use PIN' }));
    (LocalAuthentication.authenticateAsync as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    expect(await askBiometric('Unlock', 'Use PIN')).toBe(false);
  });

  it('can only be on while the lock is on', async () => {
    await setBiometric(true);
    expect(getLockState().bio).toBe(false);
    await setPin('1234');
    await setBiometric(true);
    expect(getLockState().bio).toBe(true);
  });
});
