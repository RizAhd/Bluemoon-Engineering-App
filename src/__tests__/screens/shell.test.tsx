/**
 * The app shell and the pieces that must never fail: ErrorScreen (shown when something else did),
 * RecoveryPrompt, the tab layout's floating button, the root layout (fonts, database, fatal-error screen)
 * and the toast host.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { waitFor } from '@testing-library/react-native';
import * as BackgroundTask from 'expo-background-task';
import { File } from 'expo-file-system'; // the in-memory stand-in in tests (see setup.ts)
import { useFonts } from 'expo-font';
import { router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Sharing from 'expo-sharing';
import { useColorScheme } from 'react-native';

import TabLayout from '@/app/(tabs)/_layout';
import RootLayout, { ErrorBoundary } from '@/app/_layout';
import { AutoBackupRunner } from '@/components/AutoBackupRunner';
import { ErrorScreen } from '@/components/ErrorScreen';
import { RecoveryPrompt } from '@/components/RecoveryPrompt';
import { ShareReceiver } from '@/components/ShareReceiver';
import { hideToast, toast, ToastHost } from '@/components/ui/feedback';
import { closeDb, getSetting, setSetting } from '@/db';
import { backupsDir, listAutoBackups, runAutoBackupIfDue } from '@/lib/autoBackup';
import { errorLogFile } from '@/lib/errors';
import { mockAlert, resetDb, seedDemo } from '@/test-utils';
import { rows } from '@/test-utils/screenData';
import { palette } from '@/theme';
import {
  act,
  changeSetting,
  expectClean,
  fireEvent,
  hasLabel,
  makeTr,
  pressAlertButton,
  pressLabel,
  renderScreen,
  screen,
  setPathname,
  setWindow,
  smokeScreen,
  takeConsole,
  visibleText,
  type Tr,
} from '@/test-utils/screenKit';

const E = makeTr('en');

/** Make the next attempts to open the phone's database fail, as a corrupt or locked file would. */
function breakDatabase() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sqlite = require('expo-sqlite') as { openDatabaseSync: (...args: unknown[]) => unknown };
  closeDb();
  return jest.spyOn(sqlite, 'openDatabaseSync').mockImplementation(() => {
    throw new Error('disk I/O error');
  });
}

// ---------------------------------------------------------------- ErrorScreen

let errorProps: Parameters<typeof ErrorScreen>[0] = { onRetry: () => undefined };

smokeScreen('ErrorScreen', () => <ErrorScreen {...errorProps} />, {
  db: 'empty',
  variants: [
    {
      name: 'a screen crashed: retry, share the log, go to Today',
      prepare: () => {
        errorProps = { error: new Error('kaboom'), onRetry: () => undefined, onHome: () => undefined };
      },
      expect: (tr: Tr) => [tr('appCrashed'), tr('appCrashedBody'), 'kaboom', tr('tryAgain'), tr('shareLog'), tr('goHome')],
    },
    {
      name: 'the database could not be opened',
      prepare: () => {
        errorProps = { error: 'disk I/O error', titleKey: 'errorTitle', bodyKey: 'dbError', onRetry: () => undefined };
      },
      expect: (tr: Tr) => [tr('errorTitle'), tr('dbError'), 'disk I/O error', tr('tryAgain'), tr('shareLog')],
      absent: (tr: Tr) => [tr('goHome')],
    },
    {
      name: 'with the share button hidden',
      prepare: () => {
        errorProps = { onRetry: () => undefined, hideShare: true };
      },
      expect: (tr: Tr) => [tr('appCrashed'), tr('tryAgain')],
      absent: (tr: Tr) => [tr('shareLog'), tr('goHome')],
    },
  ],
});

describe('ErrorScreen: buttons', () => {
  beforeEach(() => {
    resetDb();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  it('Try again and Go to Today call back; Share error log opens the share sheet with the log', async () => {
    const onRetry = jest.fn();
    const onHome = jest.fn();
    await renderScreen(<ErrorScreen error={new Error('x')} onRetry={onRetry} onHome={onHome} />);
    await pressLabel(E('tryAgain'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await pressLabel(E('goHome'));
    expect(onHome).toHaveBeenCalledTimes(1);
    await pressLabel(E('shareLog'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
    const [uri, options] = (Sharing.shareAsync as jest.Mock).mock.calls[0];
    expect(String(uri)).toMatch(/errors-\d{4}-\d{2}-\d{2}\.txt$/);
    expect(options).toMatchObject({ mimeType: 'text/plain' });
    expect(new File(uri).textSync()).toContain('Bluemoon Site');
  });

  it('still works when the database is down: a bare screen in the phone language, no settings needed', async () => {
    const broken = breakDatabase();
    const onRetry = jest.fn();
    await renderScreen(<ErrorScreen error={new Error('db down')} onRetry={onRetry} onHome={() => undefined} />);
    const logged = takeConsole();
    expect(logged.length).toBeGreaterThan(0); // the failed attempt to open the database is logged
    expect(visibleText()).toContain(E('appCrashed'));
    expect(visibleText()).toContain(E('appCrashedBody'));
    expect(hasLabel(E('tryAgain'))).toBe(true);
    expect(hasLabel(E('shareLog'))).toBe(true);
    expect(hasLabel(E('goHome'))).toBe(true);
    expectClean('error screen without database');
    await pressLabel(E('tryAgain'));
    expect(onRetry).toHaveBeenCalled();
    broken.mockRestore();
  });
});

// ---------------------------------------------------------------- RecoveryPrompt

describe('RecoveryPrompt', () => {
  beforeEach(() => {
    resetDb();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  it('renders nothing and says nothing on a healthy phone', async () => {
    const alert = mockAlert();
    await renderScreen(<RecoveryPrompt />);
    expect(screen.toJSON()).toBeNull();
    expect(alert).not.toHaveBeenCalled();
  });

  it.each(['en', 'si', 'ta'] as const)('after a database was set aside and there is no backup: start fresh or not now [%s]', async (lang) => {
    setSetting('lang', lang);
    setSetting('recovered_from_corruption', new Date().toISOString());
    const alert = mockAlert();
    await renderScreen(<RecoveryPrompt />);
    const tr = makeTr(lang);
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, body, buttons] = alert.mock.calls[0] as [string, string, { text: string }[]];
    expect(title).toBe(tr('recoveredTitle'));
    expect(body).toContain(tr('recoveredBody'));
    expect(body).toContain(tr('noAutoBackup'));
    expect(buttons.map((b) => b.text)).toEqual([tr('startFresh'), tr('notNow')]);
    for (const text of [title, body, ...buttons.map((b) => b.text)]) expect(text).not.toMatch(/undefined|NaN/);

    await pressAlertButton(alert, tr('startFresh'));
    expect(getSetting('recovered_from_corruption')).toBeNull();
    // starting fresh also lets the daily backup run again; let that finish before the next test resets the phone
    await waitFor(() => expect(getSetting('auto_backup_at')).not.toBeNull());
  });

  it('with a daily backup available, "Restore newest" brings the records back and clears the flag', async () => {
    seedDemo();
    const outcome = await runAutoBackupIfDue(true);
    expect([outcome, getSetting('auto_backup_error')]).toEqual(['done', null]);
    const saved = listAutoBackups()[0];
    const name = saved.file.name;
    const bytes = saved.file.bytesSync();
    // the phone loses its database; the backup folder survives
    resetDb();
    const copy = new File(backupsDir(), name);
    copy.create();
    copy.writeSync(bytes);
    setSetting('recovered_from_corruption', new Date().toISOString());
    setSetting('lang', 'en');
    expect(rows('SELECT 1 FROM projects')).toHaveLength(0);

    const alert = mockAlert();
    await renderScreen(<RecoveryPrompt />);
    const buttons = (alert.mock.calls[0][2] as { text: string }[]).map((b) => b.text);
    expect(buttons).toEqual([E('restoreNewest'), E('startFresh'), E('notNow')]);
    await pressAlertButton(alert, E('restoreNewest'));
    await waitFor(() => expect(getSetting('recovered_from_corruption')).toBeNull());
    expect(rows('SELECT 1 FROM projects WHERE deleted_at IS NULL')).toHaveLength(3);
    expect(rows('SELECT 1 FROM expenses WHERE deleted_at IS NULL').length).toBeGreaterThan(5);
    await waitFor(() => expect(getSetting('auto_backup_at')).not.toBeNull());
  });
});

// ---------------------------------------------------------------- tab layout (the floating button)

describe('tab layout: floating action button', () => {
  beforeEach(() => {
    resetDb();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  it('on the tabs it opens the quick-add sheet', async () => {
    seedDemo();
    setPathname('/');
    await renderScreen(<TabLayout />);
    expectClean('tab layout');
    expect(hasLabel(E('quickAdd'))).toBe(true);
    await pressLabel(E('quickAdd'));
    expect(router.push).toHaveBeenCalledWith('/add');
  });

  it('on the Projects tab it starts a new project', async () => {
    seedDemo();
    setPathname('/projects');
    await renderScreen(<TabLayout />);
    expect(hasLabel(E('newProject'))).toBe(true);
    expect(hasLabel(E('quickAdd'))).toBe(false);
    await pressLabel(E('newProject'));
    expect(router.push).toHaveBeenCalledWith('/project/form');
  });

  it('with no projects only the Projects tab has it (the empty state owns the only blue button elsewhere)', async () => {
    setPathname('/');
    await renderScreen(<TabLayout />);
    expect(hasLabel(E('quickAdd'))).toBe(false);
    await screen.unmount();
    setPathname('/projects');
    await renderScreen(<TabLayout />);
    expect(hasLabel(E('newProject'))).toBe(true);
  });

  it('on a very narrow phone (under 360 wide) it shrinks to an icon, still named for screen readers', async () => {
    seedDemo();
    setPathname('/');
    setWindow(320);
    await renderScreen(<TabLayout />);
    expect(hasLabel(E('quickAdd'))).toBe(true);
    expect(visibleText()).not.toContain(E('quickAdd'));
    expectClean('tab layout narrow');
    await screen.unmount();
    setWindow(360);
    await renderScreen(<TabLayout />);
    expect(visibleText()).toContain(E('quickAdd'));
  });

  it.each(['si', 'ta'] as const)('is labelled in %s and drawn in dark', async (lang) => {
    seedDemo();
    setSetting('lang', lang);
    setSetting('theme', 'dark');
    setPathname('/');
    await renderScreen(<TabLayout />);
    expectClean(`tab layout ${lang}`);
    expect(hasLabel(makeTr(lang)('quickAdd'))).toBe(true);
  });
});

// ---------------------------------------------------------------- root layout

describe('root layout', () => {
  beforeEach(() => {
    resetDb();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  it.each(['en', 'si', 'ta'] as const)('opens the database and shows the route titles [%s]', async (lang) => {
    setSetting('lang', lang);
    await renderScreen(<RootLayout />);
    expectClean(`root layout ${lang}`);
    const tr = makeTr(lang);
    expect(screen.getAllByTestId('stack-route').length).toBeGreaterThanOrEqual(15);
    for (const key of ['settingsAndMore', 'project', 'expense', 'worker', 'wages', 'todaysWork', 'tool', 'siteNotes', 'importPdf', 'backup', 'reportProblem'] as const) {
      expect(visibleText()).toContain(tr(key));
    }
    await waitFor(() => expect(SplashScreen.hideAsync).toHaveBeenCalled());
  });

  it('a database that cannot be opened shows the error screen; Try again recovers once it can', async () => {
    const broken = breakDatabase();
    await renderScreen(<RootLayout />);
    takeConsole(); // the failed attempts are logged in development
    expect(visibleText()).toContain(E('errorTitle'));
    expect(visibleText()).toContain(E('dbError'));
    expect(screen.queryAllByTestId('stack-route')).toHaveLength(0);
    broken.mockRestore();
    await pressLabel(E('tryAgain'));
    await waitFor(() => expect(screen.queryAllByTestId('stack-route').length).toBeGreaterThan(0));
    expect(visibleText()).not.toContain(E('dbError'));
  });

  it('an uncaught fatal error shows the recovery screen instead of closing the app', async () => {
    await renderScreen(<RootLayout />);
    const errorUtils = (globalThis as unknown as { ErrorUtils: { getGlobalHandler: () => (e: Error, fatal?: boolean) => void } }).ErrorUtils;
    await act(async () => {
      errorUtils.getGlobalHandler()(new Error('fatal in a callback'), true);
    });
    takeConsole();
    expect(visibleText()).toContain(E('appCrashed'));
    expect(visibleText()).toContain('fatal in a callback');
    expect(hasLabel(E('goHome'))).toBe(true);
    await pressLabel(E('goHome'));
    expect(router.replace).toHaveBeenCalledWith('/(tabs)');
    expect(screen.queryAllByTestId('stack-route').length).toBeGreaterThan(0);
  });

  it('the router error boundary shows the recovery screen and its buttons retry / go home', async () => {
    const retry = jest.fn();
    await renderScreen(<ErrorBoundary error={new Error('render failed')} retry={retry} />);
    takeConsole();
    expect(visibleText()).toContain(E('appCrashed'));
    expect(visibleText()).toContain('render failed');
    expect(errorLogFile().textSync()).toContain('render failed'); // logged
    await pressLabel(E('tryAgain'));
    expect(retry).toHaveBeenCalledTimes(1);
    await pressLabel(E('goHome'));
    expect(retry).toHaveBeenCalledTimes(2);
    expect(router.replace).toHaveBeenCalledWith('/(tabs)');
  });
});

// ---------------------------------------------------------------- toast

describe('toast host', () => {
  beforeEach(() => {
    resetDb();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  it('shows a confirmation, replaces it with the next one, and can be dismissed', async () => {
    await renderScreen(<ToastHost />);
    expect(screen.toJSON()).toBeNull();
    await act(async () => toast('Saved on phone'));
    expect(visibleText()).toContain('Saved on phone');
    expectClean('toast');
    await act(async () => toast('Deleted'));
    expect(visibleText()).toContain('Deleted');
    expect(visibleText()).not.toContain('Saved on phone');
    await act(async () => hideToast());
    expect(screen.toJSON()).toBeNull();
  });

  it('an action toast (Undo) runs its action and closes; a danger toast has a close button', async () => {
    await renderScreen(<ToastHost />);
    const undo = jest.fn();
    await act(async () => toast('Deleted', { action: { label: 'Undo', onPress: undo } }));
    await pressLabel('Undo');
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.toJSON()).toBeNull();

    await act(async () => toast('Could not save', { tone: 'danger', sticky: true }));
    expect(visibleText()).toContain('Could not save');
    await fireEvent.press(screen.getByLabelText('×'));
    expect(screen.toJSON()).toBeNull();
  });

  it.each(['si', 'ta'] as const)('draws in dark in %s', async (lang) => {
    setSetting('lang', lang);
    setSetting('theme', 'dark');
    await renderScreen(<ToastHost />);
    await act(async () => toast(makeTr(lang)('savedOnPhone')));
    expect(visibleText()).toContain(makeTr(lang)('savedOnPhone'));
    expectClean(`toast ${lang}`);
  });
});

// ---------------------------------------------------------------- theme and fonts

describe('automatic theme and fonts', () => {
  beforeEach(() => {
    resetDb();
    setSetting('lang', 'en');
  });
  afterEach(() => {
    jest.mocked(useColorScheme).mockReturnValue('light'); // the jest preset's default
  });

  it('with the theme left on Automatic the screens follow the phone: light, then dark', async () => {
    // react-native's jest preset replaces useColorScheme with a jest.fn that says 'light'
    const phone = jest.mocked(useColorScheme);
    phone.mockReturnValue('light');
    const used = () => JSON.stringify(screen.toJSON(), (_k, v) => (typeof v === 'function' ? undefined : v));
    await renderScreen(<ErrorScreen onRetry={() => undefined} />);
    expect(used()).toContain(palette.light.bg);
    expect(used()).not.toContain(palette.dark.bg);
    await screen.unmount();

    phone.mockReturnValue('dark');
    await renderScreen(<ErrorScreen onRetry={() => undefined} />);
    expect(used()).toContain(palette.dark.bg);
    expect(used()).not.toContain(palette.light.bg);

    // an explicit choice in Settings wins over the phone
    await changeSetting('theme', 'light');
    expect(used()).toContain(palette.light.bg);
    phone.mockReturnValue('light');
  });

  it('shows nothing until the fonts are loaded', async () => {
    (useFonts as jest.Mock).mockReturnValueOnce([false, null]);
    await renderScreen(<RootLayout />);
    expect(screen.toJSON()).toBeNull();
  });
});

// ---------------------------------------------------------------- share receiver and background runner

describe('ShareReceiver and AutoBackupRunner', () => {
  beforeEach(() => {
    resetDb();
    setSetting('lang', 'en');
  });
  afterEach(() => {
    // back to "nothing shared" for the tests that follow
    (Sharing.useIncomingShare as jest.Mock).mockReturnValue({
      sharedPayloads: [],
      resolvedSharedPayloads: [],
      isResolving: false,
      error: null,
      clearSharedPayloads: jest.fn(),
      refreshSharedPayloads: jest.fn(),
    });
  });

  const incoming = (item: { contentUri: string; contentMimeType?: string; originalName?: string }) => {
    const clear = jest.fn();
    (Sharing.useIncomingShare as jest.Mock).mockReturnValue({
      sharedPayloads: [],
      resolvedSharedPayloads: [item],
      isResolving: false,
      error: null,
      clearSharedPayloads: clear,
      refreshSharedPayloads: jest.fn(),
    });
    return clear;
  };

  it('a PDF shared into the app opens the import screen, then the share is cleared', async () => {
    const clear = incoming({ contentUri: 'content://pdf/1', contentMimeType: 'application/pdf', originalName: 'project.pdf' });
    await renderScreen(<ShareReceiver />);
    expect(router.push).toHaveBeenCalledWith(`/import?uri=${encodeURIComponent('content://pdf/1')}`);
    expect(clear).toHaveBeenCalled();
  });

  it('a zip shared into the app opens restore; anything else is ignored', async () => {
    incoming({ contentUri: 'content://zip/1', originalName: 'Bluemoon-backup.ZIP' });
    await renderScreen(<ShareReceiver />);
    expect(router.push).toHaveBeenCalledWith(`/backup?uri=${encodeURIComponent('content://zip/1')}`);
    await screen.unmount();
    jest.clearAllMocks();
    incoming({ contentUri: 'content://pic/1', contentMimeType: 'image/png', originalName: 'photo.png' });
    await renderScreen(<ShareReceiver />);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('the background runner registers the daily backup task and renders nothing', async () => {
    await renderScreen(<AutoBackupRunner />);
    expect(screen.toJSON()).toBeNull();
    await waitFor(() => expect(BackgroundTask.registerTaskAsync).toHaveBeenCalled());
  });
});
