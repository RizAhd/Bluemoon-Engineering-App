/**
 * The animated splash: what it draws, when it hides the native splash, how long it stays, and that
 * it never covers an error or recovery screen. The Reanimated stub jumps animations to their end,
 * so these tests check the sequence (timers, touches, unmount), not the curves.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { AccessibilityInfo, StyleSheet, useColorScheme } from 'react-native';

import RootLayout from '@/app/_layout';
import { AnimatedSplash, SPLASH_BG, SPLASH_TIMING } from '@/components/AnimatedSplash';
import { closeDb, setSetting } from '@/db';
import { mockAlert, resetDb } from '@/test-utils';
import { act, fireEvent, hasLabel, renderScreen, screen, takeConsole, visibleText } from '@/test-utils/screenKit';
import { palette } from '@/theme';

const appJson = require('../../../app.json') as { expo: { plugins: unknown[] } };

const splash = () => screen.queryByTestId('animated-splash');

/** The overlay's first frame: what onLayout reports on a phone. */
async function firstFrame() {
  await act(async () => {
    fireEvent(screen.getByTestId('animated-splash'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 800 } } });
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

const flat = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown>;

beforeEach(() => {
  resetDb();
  setSetting('lang', 'en');
  setSetting('theme', 'light');
});

afterEach(() => {
  jest.useRealTimers();
  jest.mocked(useColorScheme).mockReturnValue('light'); // the jest preset's default
});

// ---------------------------------------------------------------- the overlay on its own

describe('AnimatedSplash', () => {
  it('draws the mark, the company name and a slim loader on the splash background', async () => {
    await renderScreen(<AnimatedSplash ready={false} onDone={() => undefined} />);
    const root = screen.getByTestId('animated-splash');
    expect(flat(root.props.style)).toMatchObject({ position: 'absolute', backgroundColor: SPLASH_BG.light });
    expect(root.props.accessibilityRole).toBe('progressbar');
    expect(hasLabel('Bluemoon Engineering')).toBe(true);
    expect(hasLabel('Bluemoon Engineering (Pvt) Ltd')).toBe(true);
    const track = flat(screen.getByTestId('splash-loader').props.style);
    expect(track).toMatchObject({ width: 120, height: 3, backgroundColor: palette.light.primarySoft });
    expect(screen.queryByTestId('splash-spinner')).toBeNull();
    expect(visibleText()).toBe(''); // pictures only: nothing waits for the fonts
  });

  it('follows the phone scheme, like the native splash (not the app setting)', async () => {
    setSetting('theme', 'light');
    jest.mocked(useColorScheme).mockReturnValue('dark');
    await renderScreen(<AnimatedSplash ready={false} onDone={() => undefined} />);
    expect(flat(screen.getByTestId('animated-splash').props.style).backgroundColor).toBe(SPLASH_BG.dark);
  });

  it('uses the same backgrounds as the native splash in app.json, with a logo small enough for Android 12', () => {
    const entry = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen') as [string, Record<string, unknown>];
    const cfg = entry[1] as { backgroundColor: string; imageWidth: number; dark: { backgroundColor: string } };
    expect(cfg.backgroundColor).toBe(SPLASH_BG.light);
    expect(cfg.dark.backgroundColor).toBe(SPLASH_BG.dark);
    // Android 12+ masks the 288 dp icon canvas to a 192 dp circle: a square logo must fit inside it
    expect((cfg.imageWidth * Math.SQRT2) / 2).toBeLessThanOrEqual(96);
    expect(cfg.imageWidth).toBeGreaterThanOrEqual(100);
  });

  it('hides the native splash on its first frame, once', async () => {
    await renderScreen(<AnimatedSplash ready onDone={() => undefined} />);
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
    await firstFrame();
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    await firstFrame(); // a later layout (rotation, resize) changes nothing
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  });

  it('stays at least 900 ms after its first frame, then fades out in 250 ms without catching touches', async () => {
    jest.useFakeTimers();
    const onDone = jest.fn();
    await renderScreen(<AnimatedSplash ready onDone={onDone} />);
    await advance(5000); // time before the first frame does not count
    expect(onDone).not.toHaveBeenCalled();
    await firstFrame();
    await advance(SPLASH_TIMING.minVisible - 1);
    expect(screen.getByTestId('animated-splash').props.pointerEvents).toBe('auto');
    await advance(1);
    expect(screen.getByTestId('animated-splash').props.pointerEvents).toBe('none');
    expect(onDone).not.toHaveBeenCalled();
    await advance(SPLASH_TIMING.exit);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('waits for the fonts and the database however long they take', async () => {
    jest.useFakeTimers();
    const onDone = jest.fn();
    await renderScreen(<AnimatedSplash ready={false} onDone={onDone} />);
    await firstFrame();
    await advance(10_000);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId('animated-splash').props.pointerEvents).toBe('auto');
    // a new onDone on every parent render must not restart the fade-out
    const later = jest.fn();
    await act(async () => {
      screen.rerender(<AnimatedSplash ready onDone={later} />);
    });
    expect(screen.getByTestId('animated-splash').props.pointerEvents).toBe('none');
    await advance(SPLASH_TIMING.exit - 50);
    await act(async () => {
      screen.rerender(<AnimatedSplash ready onDone={later} />);
    });
    await advance(50);
    expect(later).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('with reduced motion shows a system spinner instead of the sliding bar', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await renderScreen(<AnimatedSplash ready={false} onDone={() => undefined} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('splash-spinner')).toBeTruthy();
    expect(screen.queryByTestId('splash-loader')).toBeNull();
    spy.mockResolvedValue(false);
  });
});

// ---------------------------------------------------------------- inside the root layout

describe('the splash in the root layout', () => {
  it('covers the app while it starts, then unmounts', async () => {
    jest.useFakeTimers();
    await renderScreen(<RootLayout />);
    expect(splash()).not.toBeNull();
    expect(screen.getAllByTestId('stack-route').length).toBeGreaterThan(0); // the app is already drawn underneath
    await firstFrame();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
    await advance(SPLASH_TIMING.minVisible);
    await advance(SPLASH_TIMING.exit);
    expect(splash()).toBeNull();
    expect(screen.getAllByTestId('stack-route').length).toBeGreaterThan(0);
  });

  it('a font that fails to load does not keep the splash up forever', async () => {
    jest.useFakeTimers();
    jest.mocked(useFonts).mockReturnValue([false, new Error('font missing')]);
    try {
      await renderScreen(<RootLayout />);
      expect(screen.getAllByTestId('stack-route').length).toBeGreaterThan(0);
      await firstFrame();
      await advance(SPLASH_TIMING.minVisible);
      await advance(SPLASH_TIMING.exit);
      expect(splash()).toBeNull();
    } finally {
      jest.mocked(useFonts).mockReturnValue([true, null]);
    }
  });

  it('never covers the database error screen, and the native splash is hidden for it', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqlite = require('expo-sqlite') as { openDatabaseSync: (...args: unknown[]) => unknown };
    closeDb();
    const broken = jest.spyOn(sqlite, 'openDatabaseSync').mockImplementation(() => {
      throw new Error('disk I/O error');
    });
    await renderScreen(<RootLayout />);
    takeConsole(); // the failed attempt is logged in development
    expect(splash()).toBeNull();
    expect(visibleText()).toContain('disk I/O error');
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
    broken.mockRestore();
  });

  it('goes away at once when a fatal error shows the recovery screen', async () => {
    await renderScreen(<RootLayout />);
    await firstFrame();
    expect(splash()).not.toBeNull();
    const errorUtils = (globalThis as unknown as { ErrorUtils: { getGlobalHandler: () => (e: Error, fatal?: boolean) => void } }).ErrorUtils;
    await act(async () => {
      errorUtils.getGlobalHandler()(new Error('fatal while starting'), true);
    });
    takeConsole();
    expect(splash()).toBeNull();
    expect(visibleText()).toContain('fatal while starting');
  });

  it('is skipped when the database was set aside and the recovery question is asked at start', async () => {
    const alert = mockAlert();
    setSetting('recovered_from_corruption', new Date().toISOString());
    await renderScreen(<RootLayout />);
    expect(splash()).toBeNull();
    expect(alert).toHaveBeenCalled();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });
});
