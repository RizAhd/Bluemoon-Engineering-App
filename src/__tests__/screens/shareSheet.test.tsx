/**
 * The Share sheet on its own: what it shows (the language, the first lines of the message, the rows) and
 * what each row does with the message: WhatsApp (opened / not installed / closed / failed), Other apps, and
 * the screen's PDF. src/lib/share and buildShareMessage are doubles here; the messages themselves are tested
 * in the lib tests.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { waitFor } from '@testing-library/react-native';

import { previewOf, ShareHeaderButton, ShareSheet, useShareSheet, type SharePdf, type ShareTarget } from '@/components/ShareSheet';
import { ToastHost } from '@/components/ui/feedback';
import { setSetting } from '@/db';
import { shareText, shareToWhatsApp } from '@/lib/share';
import { buildShareMessage } from '@/lib/shareLoad';
import { mockAlert, resetDb } from '@/test-utils';
import {
  act,
  expectClean,
  fireEvent,
  has,
  hasLabel,
  makeTr,
  pressLabel,
  renderScreen,
  screen,
  smokeScreen,
  takeConsole,
  visibleText,
} from '@/test-utils/screenKit';

jest.mock('@/lib/share', () => ({ __esModule: true, WHATSAPP_MAX_CHARS: 3000, shareText: jest.fn(), shareToWhatsApp: jest.fn(), whatsappUrl: jest.fn() }));
jest.mock('@/lib/shareLoad', () => ({ __esModule: true, ...jest.requireActual('@/lib/shareLoad'), buildShareMessage: jest.fn() }));

const E = makeTr('en');
const MSG = ['*Welimada Primary School Building*', 'Client: Zonal Education Office', 'Status: Active', '', 'Total cost: Rs 557,350', 'Developed with Bluemoon Site'].join('\n');

/** A screen with nothing but the Share button, its sheet and the toasts. */
function Harness({ target }: { target: ShareTarget }) {
  const share = useShareSheet(target);
  return (
    <>
      <ShareHeaderButton onPress={share.open} />
      {share.sheet}
      <ToastHost />
    </>
  );
}

const sheetOpen = () => hasLabel(E('viaWhatsApp')) || hasLabel(`${E('viaWhatsApp')}. ${E('shareWorking')}`);
const disabled = (label: string) => screen.getByLabelText(label, { exact: true }).props.accessibilityState?.disabled;

/** A promise the test resolves when it wants. */
function later<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function openSheet(target: ShareTarget = { kind: 'project', id: 'p1' }) {
  await renderScreen(<Harness target={target} />);
  await pressLabel(E('share'));
}

beforeEach(() => {
  resetDb();
  setSetting('lang', 'en');
  setSetting('theme', 'light');
  jest.mocked(buildShareMessage).mockReturnValue(MSG);
  jest.mocked(shareToWhatsApp).mockResolvedValue('whatsapp');
  jest.mocked(shareText).mockResolvedValue('shared');
});

describe('previewOf', () => {
  it('is the first three lines that have text, without the WhatsApp bold stars', () => {
    expect(previewOf(MSG)).toBe('Welimada Primary School Building\nClient: Zonal Education Office\nStatus: Active');
    expect(previewOf('*Only*')).toBe('Only');
    expect(previewOf('a\n\n\nb', 2)).toBe('a\nb');
  });
});

describe('the sheet', () => {
  it('opens from the Share button with the language, a preview and the two rows (no PDF when the screen has none)', async () => {
    await renderScreen(<Harness target={{ kind: 'project', id: 'p1' }} />);
    expect(sheetOpen()).toBe(false);
    await pressLabel(E('share'));
    expect(buildShareMessage).toHaveBeenCalledTimes(1);
    expect(buildShareMessage).toHaveBeenCalledWith('project', 'p1', 'en', undefined);
    expect(visibleText()).toContain(E('shareTitle'));
    expect(visibleText()).toContain(E('sharePreview', { lang: 'English' }));
    expect(screen.getByTestId('share-preview').props.children).toBe(previewOf(MSG));
    expect(visibleText()).not.toContain('Total cost'); // only the first lines
    expect(visibleText()).not.toContain('*');
    expect(hasLabel(E('viaWhatsApp'))).toBe(true);
    expect(hasLabel(E('otherApps'))).toBe(true);
    expect(hasLabel(E('sharePdf'))).toBe(false);
    expectClean('share sheet');
  });

  it('builds the message in the language the screen asks for and names it', async () => {
    await openSheet({ kind: 'estimate', id: 'e1', lang: 'si' });
    expect(buildShareMessage).toHaveBeenCalledWith('estimate', 'e1', 'si', undefined);
    expect(visibleText()).toContain(E('sharePreview', { lang: 'සිංහල' }));
  });

  it('passes the options on (a day sheet for a day)', async () => {
    await openSheet({ kind: 'daySheet', id: 'p1', options: { day: '2026-10-20' } });
    expect(buildShareMessage).toHaveBeenCalledWith('daySheet', 'p1', 'en', { day: '2026-10-20' });
  });

  it('says so in a toast when there is nothing to share, and does not open', async () => {
    jest.mocked(buildShareMessage).mockReturnValue(null);
    await openSheet();
    expect(sheetOpen()).toBe(false);
    expect(has(E('nothingToShare'))).toBe(true);
  });

  it('a message that cannot be built is reported, and the sheet stays shut', async () => {
    const alert = mockAlert();
    jest.mocked(buildShareMessage).mockImplementation(() => {
      throw new Error('database is locked');
    });
    await openSheet();
    expect(alert).toHaveBeenCalledWith(E('errorTitle'), expect.stringContaining(E('dbError')));
    expect(sheetOpen()).toBe(false);
    takeConsole(); // logged in development
  });

  it('closes from its close button', async () => {
    await openSheet();
    await pressLabel(E('close'), 1); // [0] is the dimmed backdrop, [1] the X
    expect(sheetOpen()).toBe(false);
  });
});

describe('WhatsApp', () => {
  it('hands the message to WhatsApp and closes', async () => {
    await openSheet();
    await pressLabel(E('viaWhatsApp'));
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(shareToWhatsApp).toHaveBeenCalledTimes(1);
    expect(shareToWhatsApp).toHaveBeenCalledWith(MSG);
    expect(shareText).not.toHaveBeenCalled();
    expect(has(E('whatsappMissing'))).toBe(false);
  });

  it('without WhatsApp the phone share sheet was used: closes and says to choose an app', async () => {
    jest.mocked(shareToWhatsApp).mockResolvedValue('fallback');
    await openSheet();
    await pressLabel(E('viaWhatsApp'));
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(has(E('whatsappMissing'))).toBe(true);
  });

  it('closed without sending: the sheet stays for another choice, no message', async () => {
    jest.mocked(shareToWhatsApp).mockResolvedValue('dismissed');
    await openSheet();
    await pressLabel(E('viaWhatsApp'));
    await waitFor(() => expect(shareToWhatsApp).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(sheetOpen()).toBe(true);
    expect(has(E('whatsappMissing'))).toBe(false);
    expect(disabled(E('otherApps'))).toBe(false); // not busy any more
  });

  it('a failure is reported in the person\'s language and the sheet stays open', async () => {
    const alert = mockAlert();
    jest.mocked(shareToWhatsApp).mockRejectedValue(new Error('no activity found'));
    await openSheet();
    await pressLabel(E('viaWhatsApp'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(E('errorTitle'), expect.stringContaining(E('somethingWrong'))));
    expect(sheetOpen()).toBe(true);
    takeConsole();
  });

  it('one hand-off at a time: a second tap does nothing, the other rows wait, the sheet cannot be closed meanwhile', async () => {
    const pending = later<'whatsapp'>();
    jest.mocked(shareToWhatsApp).mockReturnValue(pending.promise);
    await openSheet();
    const row = screen.getByLabelText(E('viaWhatsApp'), { exact: true });
    await fireEvent.press(row);
    await fireEvent.press(row);
    const busyLabel = `${E('viaWhatsApp')}. ${E('shareWorking')}`;
    expect(hasLabel(busyLabel)).toBe(true);
    await pressLabel(busyLabel);
    await pressLabel(E('otherApps'));
    expect(shareToWhatsApp).toHaveBeenCalledTimes(1);
    expect(shareText).not.toHaveBeenCalled();
    expect(disabled(E('otherApps'))).toBe(true);
    await pressLabel(E('close'), 1);
    expect(sheetOpen()).toBe(true); // closing would hide the only sign of the work
    await act(async () => pending.resolve('whatsapp'));
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(shareToWhatsApp).toHaveBeenCalledTimes(1);
  });
});

describe('Other apps', () => {
  it('opens the phone share sheet with the first line as the subject, and closes', async () => {
    await openSheet();
    await pressLabel(E('otherApps'));
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(shareText).toHaveBeenCalledWith(MSG, 'Welimada Primary School Building');
    expect(shareToWhatsApp).not.toHaveBeenCalled();
  });

  it('closed without choosing an app: the sheet stays', async () => {
    jest.mocked(shareText).mockResolvedValue('dismissed');
    await openSheet();
    await pressLabel(E('otherApps'));
    await waitFor(() => expect(shareText).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(sheetOpen()).toBe(true);
  });

  it('a failure is reported and the sheet stays', async () => {
    const alert = mockAlert();
    jest.mocked(shareText).mockRejectedValue(new Error('boom'));
    await openSheet();
    await pressLabel(E('otherApps'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(E('errorTitle'), expect.any(String)));
    expect(sheetOpen()).toBe(true);
    takeConsole();
  });
});

describe('PDF', () => {
  it('shows the remembered choices and runs the screen\'s export; the sheet closes at the hand-off', async () => {
    const run = jest.fn<Promise<void>, [() => void]>(async (handOff) => handOff());
    const pdf: SharePdf = { hint: 'With photos · Plain paper', run };
    await openSheet({ kind: 'project', id: 'p1', pdf });
    expect(hasLabel(E('sharePdf'))).toBe(true);
    expect(visibleText()).toContain('With photos · Plain paper');
    await pressLabel(E('sharePdf'));
    await waitFor(() => expect(sheetOpen()).toBe(false));
    expect(run).toHaveBeenCalledTimes(1);
    expect(typeof run.mock.calls[0][0]).toBe('function');
    expect(shareToWhatsApp).not.toHaveBeenCalled();
  });

  it('without a hint the row says what the PDF is', async () => {
    await openSheet({ kind: 'project', id: 'p1', pdf: { run: async () => undefined } });
    expect(visibleText()).toContain(E('sharePdfHint'));
  });

  it('a PDF that was not made leaves the sheet open; a double tap makes one', async () => {
    const pending = later<void>();
    const run = jest.fn(() => pending.promise); // never hands off: the export failed and said so itself
    await openSheet({ kind: 'project', id: 'p1', pdf: { run } });
    await pressLabel(E('sharePdf'));
    await pressLabel(`${E('sharePdf')}. ${E('shareWorking')}`);
    expect(run).toHaveBeenCalledTimes(1);
    expect(disabled(E('viaWhatsApp'))).toBe(true);
    await act(async () => pending.resolve());
    expect(sheetOpen()).toBe(true);
    expect(disabled(E('viaWhatsApp'))).toBe(false);
  });

  it('an export that throws is reported', async () => {
    const alert = mockAlert();
    await openSheet({ kind: 'project', id: 'p1', pdf: { run: () => Promise.reject(new Error('no space left on device')) } });
    await pressLabel(E('sharePdf'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(E('errorTitle'), expect.stringContaining(E('storageFull'))));
    expect(sheetOpen()).toBe(true);
    takeConsole();
  });
});

// The open sheet in every language, light and dark: clean text, the right font, no colour of the other scheme.
smokeScreen(
  'ShareSheet (open)',
  () => <ShareSheet visible message={MSG} lang="si" kind="project" pdf={{ hint: 'English · Plain paper', run: async () => undefined }} onClose={() => undefined} />,
  {
    db: 'empty',
    variants: [
      {
        name: 'preview, language and the three rows',
        expect: (tr) => [tr('shareTitle'), tr('sharePreview', { lang: 'සිංහල' }), tr('viaWhatsApp'), tr('otherApps'), tr('sharePdf'), tr('viaWhatsAppHint'), 'Welimada Primary School Building'],
      },
    ],
  },
);
