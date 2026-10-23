/**
 * The Share button on each screen: it is in the header (before Edit), and it asks for the right message:
 * the kind, the id, the language and the options of buildShareMessage. Each screen is also opened in
 * English, Sinhala and Tamil, light and dark, with the sheet open. The PDF row runs the screen's own
 * export with its remembered choices (the project report, the estimate PDF).
 *
 * buildShareMessage and src/lib/share are doubles here (the messages are tested in the lib tests), and so
 * are the two PDF exports (their files are tested elsewhere).
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { waitFor } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';

import ExpensesScreen from '@/app/(tabs)/expenses';
import ToolsScreen from '@/app/(tabs)/tools';
import EstimateHub from '@/app/estimate/[id]';
import NoteForm from '@/app/note/form';
import ProjectDetail from '@/app/project/[id]';
import TodaysWorkScreen from '@/app/wage/today';
import WorkerDetail from '@/app/worker/[id]';
import { ToastHost } from '@/components/ui/feedback';
import { setSetting } from '@/db';
import { saveEstimate, saveEstimateItem } from '@/db/estimates';
import { addDays, today } from '@/lib/dates';
import { exportEstimatePdf } from '@/lib/estimatePdf';
import { exportProjectPdf } from '@/lib/pdf';
import { shareToWhatsApp } from '@/lib/share';
import { buildShareMessage } from '@/lib/shareLoad';
import { mockAlert, resetDb, seedDemo } from '@/test-utils';
import { noteId, projectId, rows, SCHOOL, setCurrent, workerId } from '@/test-utils/screenData';
import {
  a11yLabels,
  act,
  expectClean,
  hasLabel,
  makeTr,
  pressLabel,
  renderScreen,
  setRouteParams,
  smokeScreen,
  takeConsole,
  visibleText,
  type Lang,
  type Tr,
} from '@/test-utils/screenKit';

jest.mock('@/lib/share', () => ({ __esModule: true, WHATSAPP_MAX_CHARS: 3000, shareText: jest.fn(), shareToWhatsApp: jest.fn(), whatsappUrl: jest.fn() }));
jest.mock('@/lib/shareLoad', () => ({ __esModule: true, ...jest.requireActual('@/lib/shareLoad'), buildShareMessage: jest.fn() }));
jest.mock('@/lib/estimatePdf', () => ({ __esModule: true, exportEstimatePdf: jest.fn(), estimatePdfName: jest.fn() }));
jest.mock('@/lib/pdf', () => ({ __esModule: true, ...jest.requireActual('@/lib/pdf'), exportProjectPdf: jest.fn() }));

const E = makeTr('en');
const MSG = '*Bluemoon message*\nLine two\nLine three\nLine four';
const LANG_NAME: Record<Lang, string> = { en: 'English', si: 'සිංහල', ta: 'தமிழ்' };

beforeEach(() => {
  jest.mocked(buildShareMessage).mockReturnValue(MSG);
  jest.mocked(shareToWhatsApp).mockResolvedValue('whatsapp');
  jest.mocked(exportProjectPdf).mockResolvedValue({ uri: 'file:///cache/project.pdf' } as never);
  jest.mocked(exportEstimatePdf).mockResolvedValue({ uri: 'file:///cache/estimate.pdf' } as never);
});

/** The Share button comes before `next` in the header (Share, then Edit). */
function shareBefore(tr: Tr, next: string) {
  const labels = a11yLabels();
  const share = labels.indexOf(tr('share'));
  expect(share).toBeGreaterThanOrEqual(0);
  expect(labels.filter((l) => l === tr('share'))).toHaveLength(1); // one Share button, never two
  expect(share).toBeLessThan(labels.indexOf(next));
}

/** Press Share; the sheet shows the message's language and the rows, cleanly. */
async function openShare(tr: Tr, lang: Lang, messageLang: Lang = lang) {
  // A list re-rendered by the theme switch finishes its batched cell update (a 50 ms timer) inside act, not
  // between two presses, where React would report it as an update outside act on a slow run.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  await pressLabel(tr('share'));
  expect(visibleText()).toContain(tr('sharePreview', { lang: LANG_NAME[messageLang] }));
  expect(hasLabel(tr('viaWhatsApp'))).toBe(true);
  expect(hasLabel(tr('otherApps'))).toBe(true);
  expect(visibleText()).toContain('Line three');
  expect(visibleText()).not.toContain('Line four');
  expectClean(`share sheet ${lang}`);
}

const lastBuild = () => jest.mocked(buildShareMessage).mock.calls.at(-1);

// ---------------------------------------------------------------- project hub

smokeScreen('Share on project/[id]', () => <ProjectDetail />, {
  db: 'demo',
  variants: [
    {
      name: 'the project, with its report as the PDF',
      prepare: () => setRouteParams({ id: projectId(SCHOOL) }),
      expect: (tr) => [tr('share'), tr('editProject'), tr('exportPdf')],
      check: async (tr, lang) => {
        shareBefore(tr, tr('editProject'));
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['project', projectId(SCHOOL), lang, undefined]);
        expect(hasLabel(tr('sharePdf'))).toBe(true);
        expect(visibleText()).toContain(`${tr('pdfWithPhotos')} · ${tr('pdfPlainPaper')}`);
      },
    },
  ],
});

// ---------------------------------------------------------------- estimate hub

const demoEstimate = () => rows<{ id: string }>('SELECT id FROM estimates WHERE deleted_at IS NULL ORDER BY number')[0].id;

smokeScreen('Share on estimate/[id]', () => <EstimateHub />, {
  db: 'demo',
  variants: [
    {
      name: 'the estimate in the client\'s language (the PDF\'s), whatever the app speaks',
      prepare: () => {
        setSetting('estimate_lang', 'ta');
        setSetting('estimate_letterhead', '1');
        setRouteParams({ id: demoEstimate() });
      },
      expect: (tr) => [tr('share'), tr('editDetails'), tr('shareEstimatePdf')],
      check: async (tr, lang) => {
        shareBefore(tr, tr('editDetails'));
        // the old header icon that opened the PDF sheet is gone: one Share in the header, the PDF button below
        expect(a11yLabels().filter((l) => l === tr('shareEstimatePdf'))).toHaveLength(1);
        await openShare(tr, lang, 'ta');
        expect(lastBuild()).toEqual(['estimate', demoEstimate(), 'ta', undefined]);
        expect(visibleText()).toContain(`தமிழ் · ${tr('letterheadOption')}`);
      },
    },
    {
      name: 'English for the client when nothing was chosen yet',
      langs: ['si'],
      prepare: () => {
        setSetting('estimate_lang', null);
        setRouteParams({ id: demoEstimate() });
      },
      check: async (tr) => {
        await openShare(tr, 'si', 'en');
        expect(lastBuild()).toEqual(['estimate', demoEstimate(), 'en', undefined]);
      },
    },
  ],
});

// ---------------------------------------------------------------- today's work & pay

smokeScreen("Share on wage/today (Today's work & pay)", () => <TodaysWorkScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'the chosen project and day',
      prepare: () => {
        setCurrent(projectId(SCHOOL));
        setRouteParams({ day: addDays(today(), -1) });
      },
      expect: (tr) => [tr('share'), tr('todaysWork')],
      check: async (tr, lang) => {
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['daySheet', projectId(SCHOOL), lang, { day: addDays(today(), -1) }]);
        expect(hasLabel(tr('sharePdf'))).toBe(false);
      },
    },
    {
      name: 'no project chosen: nothing to share yet',
      langs: ['en'],
      prepare: () => setCurrent(null),
      absent: (tr) => [tr('share')],
    },
  ],
});

// ---------------------------------------------------------------- worker detail

smokeScreen('Share on worker/[id]', () => <WorkerDetail />, {
  db: 'demo',
  variants: [
    {
      name: 'the statement for the current project',
      prepare: () => {
        setCurrent(projectId(SCHOOL));
        setRouteParams({ id: workerId('Nimal Perera') });
      },
      expect: (tr) => [tr('share'), tr('editWorker')],
      check: async (tr, lang) => {
        shareBefore(tr, tr('editWorker'));
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['workerStatement', workerId('Nimal Perera'), lang, { projectId: projectId(SCHOOL) }]);
      },
    },
    {
      name: 'all projects when none is chosen',
      prepare: () => {
        setCurrent(null);
        setRouteParams({ id: workerId('Nimal Perera') });
      },
      check: async (tr, lang) => {
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['workerStatement', workerId('Nimal Perera'), lang, { projectId: null }]);
      },
    },
  ],
});

// ---------------------------------------------------------------- the Expenses and Tools tabs

smokeScreen('Share on the Expenses tab', () => <ExpensesScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'the current project',
      prepare: () => setCurrent(projectId(SCHOOL)),
      expect: (tr) => [tr('share'), tr('settingsAndMore')],
      check: async (tr, lang) => {
        shareBefore(tr, tr('settingsAndMore'));
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['expenses', projectId(SCHOOL), lang, undefined]);
      },
    },
    {
      name: 'all projects',
      prepare: () => setCurrent(null),
      check: async (tr, lang) => {
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['expenses', null, lang, undefined]);
      },
    },
  ],
});

smokeScreen('Share on the Tools tab', () => <ToolsScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'tools out on the current project',
      prepare: () => setCurrent(projectId(SCHOOL)),
      expect: (tr) => [tr('share'), tr('newTool'), tr('settingsAndMore')],
      check: async (tr, lang) => {
        shareBefore(tr, tr('newTool'));
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['toolsOut', projectId(SCHOOL), lang, undefined]);
      },
    },
    {
      name: 'tools out on all projects',
      prepare: () => setCurrent(null),
      check: async (tr, lang) => {
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['toolsOut', null, lang, undefined]);
      },
    },
  ],
});

// ---------------------------------------------------------------- a site note

smokeScreen('Share on a site note (note/form)', () => <NoteForm />, {
  db: 'demo',
  variants: [
    {
      name: 'a saved note',
      prepare: () => setRouteParams({ id: noteId('First-floor slab') }),
      expect: (tr) => [tr('share'), tr('delete')],
      check: async (tr, lang) => {
        shareBefore(tr, tr('delete'));
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['note', noteId('First-floor slab'), lang, undefined]);
      },
    },
    {
      name: 'a new note has nothing to share yet',
      langs: ['en'],
      prepare: () => setRouteParams({}),
      absent: (tr) => [tr('share')],
    },
  ],
});

// ---------------------------------------------------------------- the PDF rows and WhatsApp from a screen

describe('the PDF row runs the screen\'s own export with its remembered choices', () => {
  beforeEach(() => {
    resetDb();
    seedDemo();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  it('project: the report with photos and the letterhead as remembered, handed to the phone, the sheet closed', async () => {
    setSetting('export_photos', '0');
    setSetting('export_letterhead', '1');
    setRouteParams({ id: projectId(SCHOOL) });
    await renderScreen(<ProjectDetail />);
    await pressLabel(E('share'));
    expect(visibleText()).toContain(`${E('pdfNoPhotos')} · ${E('letterheadOption')}`);
    await pressLabel(E('sharePdf'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(exportProjectPdf).toHaveBeenCalledWith(projectId(SCHOOL), expect.objectContaining({ includePhotos: false, letterhead: true }));
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/project.pdf', expect.objectContaining({ mimeType: 'application/pdf', dialogTitle: SCHOOL }));
    await waitFor(() => expect(hasLabel(E('viaWhatsApp'))).toBe(false));
    expect(buildShareMessage).toHaveBeenCalledTimes(1);
  });

  it('project: a letterhead that could not load is told after the sheet has gone', async () => {
    setSetting('export_letterhead', '1');
    jest.mocked(exportProjectPdf).mockImplementationOnce(async (_id, opts) => {
      opts?.onNotice?.('letterhead-unavailable');
      return { uri: 'file:///cache/plain.pdf' } as never;
    });
    setRouteParams({ id: projectId(SCHOOL) });
    await renderScreen(
      <>
        <ProjectDetail />
        <ToastHost />
      </>,
    );
    await pressLabel(E('share'));
    await pressLabel(E('sharePdf'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(visibleText()).toContain(E('letterheadUnavailable'));
    expect(hasLabel(E('viaWhatsApp'))).toBe(false);
  });

  it('project: a report that fails is reported and the sheet stays for another try', async () => {
    const alert = mockAlert();
    jest.mocked(exportProjectPdf).mockRejectedValueOnce(new Error('no space left on device'));
    setRouteParams({ id: projectId(SCHOOL) });
    await renderScreen(<ProjectDetail />);
    await pressLabel(E('share'));
    await pressLabel(E('sharePdf'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(E('errorTitle'), expect.stringContaining(E('storageFull'))));
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(hasLabel(E('viaWhatsApp'))).toBe(true);
    takeConsole();
  });

  it('estimate: the PDF with the remembered letterhead and language, straight away; a draft is offered "Mark as sent"', async () => {
    const alert = mockAlert();
    const id = saveEstimate({ client_name: 'Mr. Perera', title: 'Boundary wall', issue_day: today() });
    saveEstimateItem({ estimate_id: id, description: 'Excavation', unit: 'nos', qty_milli: 1000, rate_cents: 100_000 });
    setSetting('estimate_letterhead', '1');
    setSetting('estimate_lang', 'si');
    setRouteParams({ id });
    await renderScreen(<EstimateHub />);
    await pressLabel(E('share'));
    expect(buildShareMessage).toHaveBeenLastCalledWith('estimate', id, 'si', undefined);
    await pressLabel(E('sharePdf'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(exportEstimatePdf).toHaveBeenCalledTimes(1);
    expect(exportEstimatePdf).toHaveBeenCalledWith(id, expect.objectContaining({ letterhead: true, lang: 'si' }));
    expect(visibleText()).not.toContain(E('pdfLanguage')); // the PDF options sheet was not needed
    expect(hasLabel(E('viaWhatsApp'))).toBe(false);
    await waitFor(() => expect(alert.mock.calls.at(-1)?.[0]).toBe(E('markSentTitle')));
  });

  it('the estimate\'s own "Share estimate PDF" button still opens the PDF options', async () => {
    const id = saveEstimate({ client_name: 'Mr. Perera', title: 'Gate', issue_day: today() });
    saveEstimateItem({ estimate_id: id, description: 'Gate', unit: 'nos', qty_milli: 1000, rate_cents: 100_000 });
    setRouteParams({ id });
    await renderScreen(<EstimateHub />);
    await pressLabel(E('shareEstimatePdf'));
    expect(visibleText()).toContain(E('pdfLanguage'));
    expect(hasLabel(E('viaWhatsApp'))).toBe(false);
  });

  it('WhatsApp from a worker: the statement goes to WhatsApp and the sheet closes', async () => {
    setRouteParams({ id: workerId('Nimal Perera') });
    await renderScreen(<WorkerDetail />);
    await pressLabel(E('share'));
    await pressLabel(E('viaWhatsApp'));
    await waitFor(() => expect(shareToWhatsApp).toHaveBeenCalledWith(MSG));
    await waitFor(() => expect(hasLabel(E('viaWhatsApp'))).toBe(false));
  });

  it('today\'s sheet: with no day passed, Share asks for today\'s sheet of the current project', async () => {
    setCurrent(projectId(SCHOOL));
    await renderScreen(<TodaysWorkScreen />);
    await pressLabel(E('share'));
    expect(buildShareMessage).toHaveBeenLastCalledWith('daySheet', projectId(SCHOOL), 'en', { day: today() });
  });
});
