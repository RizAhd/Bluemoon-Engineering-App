/**
 * Heavy screens draw a skeleton while they slide in, then the page itself. Jest normally skips the wait
 * (every other screen test sees the page at once); these tests turn it on.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { setSetting } from '@/db';
import { resetDb } from '@/test-utils';
import { act, hasLabel, renderScreen, screen } from '@/test-utils/screenKit';
import { Txt } from '@/components/ui/Txt';
import { SCREEN_READY_MS, Screen, setScreenDeferForTests } from '@/components/ui/layout';

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  resetDb();
  setSetting('lang', 'en');
  setSetting('theme', 'light');
  setScreenDeferForTests(true);
});

afterEach(() => {
  setScreenDeferForTests(false);
  jest.useRealTimers();
});

describe('Screen skeleton', () => {
  it.each(['hero', 'plain'] as const)('shows the %s skeleton first, then the page', async (variant) => {
    jest.useFakeTimers();
    await renderScreen(
      <Screen skeleton={variant}>
        <Txt>Page body</Txt>
      </Screen>,
    );
    expect(screen.getByTestId('screen-skeleton')).toBeTruthy();
    expect(hasLabel('Loading…')).toBe(true);
    expect(screen.queryByText('Page body')).toBeNull();
    await advance(SCREEN_READY_MS.stack);
    expect(screen.queryByTestId('screen-skeleton')).toBeNull();
    expect(screen.getByText('Page body')).toBeTruthy();
  });

  it('a screen without a skeleton shows its page at once', async () => {
    await renderScreen(
      <Screen>
        <Txt>Form body</Txt>
      </Screen>,
    );
    expect(screen.queryByTestId('screen-skeleton')).toBeNull();
    expect(screen.getByText('Form body')).toBeTruthy();
  });

  it('the skeleton is labelled in Sinhala and Tamil too', async () => {
    jest.useFakeTimers();
    setSetting('lang', 'si');
    await renderScreen(<Screen skeleton="hero"><Txt>x</Txt></Screen>);
    expect(hasLabel('පූරණය වෙමින්…')).toBe(true);
  });
});
