/**
 * The app lock (overlay, PIN screen, Settings rows) and password-protected backups on the backup screen.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { configure, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import { AppState } from 'react-native';

import BackupScreen from '@/app/backup';
import MoreScreen from '@/app/more';
import PinScreen from '@/app/pin';
import { AppLock } from '@/components/AppLock';
import { getLockState, loadLock, resetLockForTests, setPin, unlock } from '@/lib/appLock';
import { makeBackup } from '@/lib/backup';
import { File, mockAlert, Paths, queueFilePick, resetDb, seedDemo } from '@/test-utils';
import { act, expectClean, fireEvent, makeTr, pressAlertButton, pressLabel, renderScreen, screen, setRouteParams, smokeScreen, typeInto, visibleText } from '@/test-utils/screenKit';

jest.setTimeout(120_000);

const E = makeTr('en');
/** Making or opening a locked backup derives its key with 100,000 rounds: give it time on a busy machine. */
const SLOW = { timeout: 30_000 };
// Every PIN check is a PBKDF2 run too; on a loaded machine the default 1 s wait is not enough.
configure({ asyncUtilTimeout: 15_000 });
const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

async function typePin(pin: string) {
  for (const d of pin) await pressLabel(d);
}

beforeEach(() => {
  resetDb();
  store.clear();
  resetLockForTests();
  jest.clearAllMocks();
});

smokeScreen('PIN screen', () => <PinScreen />, {
  db: 'empty',
  variants: [
    { name: 'choose a PIN', prepare: () => setRouteParams({ mode: 'set' }), expect: (tr) => [tr('pinChooseNew'), tr('pinRule'), tr('next')] },
    { name: 'small phone, large text', width: 320, fontScale: 1.3, prepare: () => setRouteParams({ mode: 'set' }), expect: (tr) => [tr('pinChooseNew')], langs: ['si', 'ta'] },
  ],
});

describe('lock screen', () => {
  it('shows nothing when no PIN is set', async () => {
    await renderScreen(<AppLock />);
    await act(() => loadLock(true));
    expect(screen.queryByTestId('app-lock')).toBeNull();
  });

  it('covers the app at start, says when the PIN is wrong, and opens with the right one', async () => {
    await setPin('2580');
    resetLockForTests();
    await renderScreen(<AppLock />);
    await waitFor(() => expect(screen.getByTestId('app-lock')).toBeTruthy());
    expect(visibleText()).toContain(E('appLocked'));

    await typePin('1111');
    await waitFor(() => expect(visibleText()).toContain(E('pinWrong')));
    expect(screen.getByTestId('app-lock')).toBeTruthy();

    await typePin('2580');
    await waitFor(() => expect(screen.queryByTestId('app-lock')).toBeNull());
    expect(getLockState().locked).toBe(false);
  });

  it('after 5 wrong PINs the keypad waits and says for how long', async () => {
    await setPin('2580');
    resetLockForTests();
    await renderScreen(<AppLock />);
    await waitFor(() => expect(screen.getByTestId('app-lock')).toBeTruthy());
    for (let i = 1; i <= 5; i++) {
      await typePin('0000');
      // each check takes a moment (PBKDF2); type the next PIN once it is done, as a person would
      await waitFor(() => expect(getLockState().failures).toBe(i));
    }
    await waitFor(() => expect(visibleText()).toMatch(/Try again in \d+ s/));
    expect(screen.getByRole('button', { name: '5' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('opens the fingerprint prompt by itself when that is on', async () => {
    await setPin('2580');
    store.set('bm_lock_bio', '1');
    resetLockForTests();
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });
    await renderScreen(<AppLock />);
    await waitFor(() => expect(LocalAuthentication.authenticateAsync).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('app-lock')).toBeNull());
  });

  it('locks again after 5 minutes in the background, not after a short switch', async () => {
    const handlers: ((s: string) => void)[] = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
      handlers.push(fn as (s: string) => void);
      return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
    });
    await setPin('2580');
    await renderScreen(<AppLock />);
    // the cold start locks; open it and start from an unlocked app
    await waitFor(() => expect(screen.getByTestId('app-lock')).toBeTruthy());
    await act(async () => unlock());
    expect(screen.queryByTestId('app-lock')).toBeNull();
    const now = jest.spyOn(Date, 'now');
    const t0 = 1_800_000_000_000;
    now.mockReturnValue(t0);
    await act(async () => handlers.forEach((h) => h('background')));
    now.mockReturnValue(t0 + 60_000);
    await act(async () => handlers.forEach((h) => h('active')));
    expect(screen.queryByTestId('app-lock')).toBeNull();
    await act(async () => handlers.forEach((h) => h('background')));
    now.mockReturnValue(t0 + 60_000 + 5 * 60_000);
    await act(async () => handlers.forEach((h) => h('active')));
    expect(screen.getByTestId('app-lock')).toBeTruthy();
    now.mockRestore();
    spy.mockRestore();
  });
});

describe('PIN screen', () => {
  it('sets a PIN after it is typed twice the same', async () => {
    setRouteParams({ mode: 'set' });
    await renderScreen(<PinScreen />);
    await typePin('4711');
    await pressLabel(E('next'));
    expect(visibleText()).toContain(E('pinConfirm'));
    await typePin('4711');
    await waitFor(() => expect(getLockState().enabled).toBe(true));
    expect(getLockState().pinLength).toBe(4);
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('starts again when the second PIN differs, and stores nothing', async () => {
    setRouteParams({ mode: 'set' });
    await renderScreen(<PinScreen />);
    await typePin('4711');
    await pressLabel(E('next'));
    await typePin('4712');
    await waitFor(() => expect(visibleText()).toContain(E('pinMismatch')));
    expect(visibleText()).toContain(E('pinChooseNew'));
    expect(store.size).toBe(0);
  });

  it('Next stays off until 4 numbers are typed', async () => {
    setRouteParams({ mode: 'set' });
    await renderScreen(<PinScreen />);
    await typePin('471');
    expect(screen.getByRole('button', { name: E('next') }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('turning the lock off needs the current PIN', async () => {
    await setPin('8642');
    setRouteParams({ mode: 'off' });
    await renderScreen(<PinScreen />);
    expect(visibleText()).toContain(E('pinEnterCurrent'));
    await typePin('1111');
    await waitFor(() => expect(visibleText()).toContain(E('pinWrong')));
    expect(getLockState().enabled).toBe(true);
    await typePin('8642');
    await waitFor(() => expect(getLockState().enabled).toBe(false));
    expect(store.size).toBe(0);
  });

  it('changing the PIN asks the old one, then the new one twice', async () => {
    await setPin('8642');
    setRouteParams({ mode: 'change' });
    await renderScreen(<PinScreen />);
    await typePin('8642');
    await waitFor(() => expect(visibleText()).toContain(E('pinChooseNew')));
    await typePin('135790');
    await pressLabel(E('next'));
    await typePin('135790');
    await waitFor(() => expect(getLockState().pinLength).toBe(6));
  });
});

describe('Settings → Security', () => {
  it('the App lock switch opens the PIN screen to set one', async () => {
    await renderScreen(<MoreScreen />);
    expect(visibleText()).toContain(E('security'));
    await fireEvent.press(screen.getByRole('switch', { name: new RegExp(`^${E('appLock')}`) }));
    expect(router.push).toHaveBeenCalledWith('/pin?mode=set');
  });

  it('with the lock on: Change PIN, and the switch asks to turn it off', async () => {
    await setPin('8642');
    await renderScreen(<MoreScreen />);
    await waitFor(() => expect(visibleText()).toContain(E('changePin')));
    await fireEvent.press(screen.getByRole('switch', { name: new RegExp(`^${E('appLock')}`) }));
    expect(router.push).toHaveBeenCalledWith('/pin?mode=off');
  });
});

describe('backup screen: password', () => {
  beforeEach(() => seedDemo());

  const protectSwitch = () => screen.getByRole('switch', { name: new RegExp(`^${E('protectWithPassword')}`) });

  it('a short or mismatched password is refused before anything is made', async () => {
    await renderScreen(<BackupScreen />);
    await fireEvent.press(protectSwitch());
    expect(visibleText()).toContain(E('passwordForgetWarning'));
    await typeInto(E('password'), '12345');
    await pressLabel(E('backupNow'));
    expect(visibleText()).toContain(E('passwordTooShort'));
    await typeInto(E('password'), 'welimada');
    await typeInto(E('passwordAgain'), 'welimadx');
    await pressLabel(E('backupNow'));
    expect(visibleText()).toContain(E('passwordMismatch'));
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('with a password it shares a locked .bmbackup', async () => {
    await renderScreen(<BackupScreen />);
    await fireEvent.press(protectSwitch());
    await typeInto(E('password'), 'welimada');
    await typeInto(E('passwordAgain'), 'welimada');
    await pressLabel(E('backupNow'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled(), SLOW);
    const [uri, options] = (Sharing.shareAsync as jest.Mock).mock.calls[0];
    expect(String(uri)).toMatch(/\.bmbackup$/);
    expect(options).toMatchObject({ mimeType: 'application/octet-stream' });
    expectClean('backup after a locked backup');
  });

  it('restoring a locked backup asks for the password, says when it is wrong, and restores with the right one', async () => {
    const [file] = await makeBackup(undefined, 'welimada');
    const bytes = file.bytesSync();
    resetDb(); // a new, empty phone (this also empties the cache)
    const copy = new File(Paths.cache, 'from-drive.bmbackup');
    copy.create();
    copy.writeSync(bytes);
    queueFilePick(copy.uri);
    const alert = mockAlert();
    await renderScreen(<BackupScreen />);
    await pressLabel(E('restore'));
    await waitFor(() => expect(alert).toHaveBeenCalled(), SLOW);
    await pressAlertButton(alert, E('restore'));
    await waitFor(() => expect(visibleText()).toContain(E('backupLockedTitle')), SLOW);

    await typeInto(E('password'), 'wrong-one');
    await pressLabel(E('openAndRestore'));
    await waitFor(() => expect(visibleText()).toContain(E('wrongPassword')), SLOW);

    await typeInto(E('password'), 'welimada');
    await pressLabel(E('openAndRestore'));
    await waitFor(() => expect(visibleText()).toContain(E('restoreDone')), SLOW);
  });
});
