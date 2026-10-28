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
import WorkersScreen from '@/app/(tabs)/workers';
import EstimateHub from '@/app/estimate/[id]';
import NoteForm from '@/app/note/form';
import NotesScreen from '@/app/notes';
import ProjectDetail from '@/app/project/[id]';
import TodaysWorkScreen from '@/app/wage/today';
import WorkerDetail from '@/app/worker/[id]';
import { ToastHost } from '@/components/ui/feedback';
import { getSetting, setSetting } from '@/db';
import { saveEstimate, saveEstimateItem } from '@/db/estimates';
import { addDays, today } from '@/lib/dates';
import { exportEstimatePdf } from '@/lib/estimatePdf';
import { exportProjectPdf } from '@/lib/pdf';
import { exportDaySheetPdf, exportExpensesPdf, exportNotesPdf, exportToolsRegisterPdf, exportWorkersListPdf, exportWorkerStatementPdf } from '@/lib/reports/export';
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
jest.mock('@/lib/reports/export', () => ({
  __esModule: true,
  exportWorkerStatementPdf: jest.fn(),
  exportExpensesPdf: jest.fn(),
  exportWorkersListPdf: jest.fn(),
  exportDaySheetPdf: jest.fn(),
  exportToolsRegisterPdf: jest.fn(),
  exportNotesPdf: jest.fn(),
}));

const E = makeTr('en');
const MSG = '*Bluemoon message*\nLine two\nLine three\nLine four';
const LANG_NAME: Record<Lang, string> = { en: 'English', si: 'සිංහල', ta: 'தமிழ்' };
const LIST_PDFS = [exportWorkerStatementPdf, exportExpensesPdf, exportWorkersListPdf, exportDaySheetPdf, exportToolsRegisterPdf, exportNotesPdf] as const;

beforeEach(() => {
  jest.mocked(buildShareMessage).mockReturnValue(MSG);
  jest.mocked(shareToWhatsApp).mockResolvedValue('whatsapp');
  jest.mocked(exportProjectPdf).mockResolvedValue({ uri: 'file:///cache/project.pdf' } as never);
  jest.mocked(exportEstimatePdf).mockResolvedValue({ uri: 'file:///cache/estimate.pdf' } as never);
  for (const fn of LIST_PDFS) jest.mocked(fn).mockResolvedValue({ uri: 'file:///cache/list.pdf' } as never);
});

/** The PDF row is there, with a hint that says what it prints (`words`) and the letterhead choice. */
function expectPdfRow(tr: Tr, ...words: string[]) {
  expect(hasLabel(tr('sharePdf'))).toBe(true);
  const text = visibleText();
  for (const word of [...words, tr(getSetting('export_letterhead') === '1' ? 'letterheadOption' : 'pdfPlainPaper')]) expect(text).toContain(word);
}

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
        expectPdfRow(tr, tr('pdfDaySheet'));
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
      expect: (tr) => [tr('share'), tr('editWorker'), tr('statementPdf')],
      check: async (tr, lang) => {
        shareBefore(tr, tr('editWorker'));
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['workerStatement', workerId('Nimal Perera'), lang, { projectId: projectId(SCHOOL) }]);
        // the statement's language is the app's until one is chosen
        expectPdfRow(tr, tr('pdfStatement'), SCHOOL, LANG_NAME[lang]);
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
        expectPdfRow(tr, tr('pdfStatement'), tr('allProjects'));
      },
    },
  ],
});

// ---------------------------------------------------------------- the Workers tab

smokeScreen('Share on the Workers tab', () => <WorkersScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'the roster of the current project',
      prepare: () => setCurrent(projectId(SCHOOL)),
      expect: (tr) => [tr('share'), tr('addWorkerToProject'), tr('settingsAndMore')],
      check: async (tr, lang) => {
        shareBefore(tr, tr('addWorkerToProject'));
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['workersList', projectId(SCHOOL), lang, undefined]);
        expectPdfRow(tr, tr('pdfWorkersList'), SCHOOL);
      },
    },
    {
      name: 'every worker with all projects',
      prepare: () => setCurrent(null),
      expect: (tr) => [tr('share'), tr('newWorker')],
      check: async (tr, lang) => {
        shareBefore(tr, tr('newWorker'));
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['workersList', null, lang, undefined]);
        expectPdfRow(tr, tr('pdfWorkersList'), tr('allProjects'));
      },
    },
  ],
});

smokeScreen('Share on the Workers tab of an empty phone', () => <WorkersScreen />, {
  db: 'empty',
  variants: [{ name: 'no workers: nothing to share yet', langs: ['en'], absent: (tr) => [tr('share')] }],
});

// ---------------------------------------------------------------- the site notes list

smokeScreen('Share on the Site notes screen', () => <NotesScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'the notes of the project passed in',
      prepare: () => setRouteParams({ projectId: projectId(SCHOOL) }),
      expect: (tr) => [tr('share'), tr('newNote')],
      check: async (tr, lang) => {
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['notesList', projectId(SCHOOL), lang, undefined]);
        expectPdfRow(tr, tr('pdfNotes'), SCHOOL);
      },
    },
    {
      name: 'every project\'s notes',
      langs: ['en'],
      prepare: () => {
        setCurrent(null);
        setRouteParams({});
      },
      check: async (tr, lang) => {
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['notesList', null, lang, undefined]);
        expectPdfRow(tr, tr('pdfNotes'), tr('allProjects'));
      },
    },
    {
      name: 'a project without notes has nothing to share yet',
      langs: ['en'],
      prepare: () => setRouteParams({ projectId: projectId('Bandarawela Drain Renovation') }),
      absent: (tr) => [tr('share')],
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
        expectPdfRow(tr, tr('pdfExpenses'), SCHOOL);
      },
    },
    {
      name: 'all projects',
      prepare: () => setCurrent(null),
      check: async (tr, lang) => {
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['expenses', null, lang, undefined]);
        expectPdfRow(tr, tr('pdfExpenses'), tr('allProjects'));
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
        expectPdfRow(tr, tr('pdfToolsRegister'), tr('toolsCount', { n: 7 })); // five tools, the wheelbarrows and the cement
      },
    },
    {
      name: 'tools out on all projects',
      prepare: () => setCurrent(null),
      check: async (tr, lang) => {
        await openShare(tr, lang);
        expect(lastBuild()).toEqual(['toolsOut', null, lang, undefined]);
        expectPdfRow(tr, tr('pdfToolsRegister'));
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

// ---------------------------------------------------------------- the PDF rows of the lists

describe('the PDF row of each list makes that list\'s PDF with the letterhead choice and hands it to the phone', () => {
  beforeEach(() => {
    resetDb();
    seedDemo();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  /** Open Share, press PDF, and wait for the phone's share sheet. */
  async function sharePdf() {
    await pressLabel(E('share'));
    await pressLabel(E('sharePdf'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/list.pdf', expect.objectContaining({ mimeType: 'application/pdf', UTI: 'com.adobe.pdf' }));
    await waitFor(() => expect(hasLabel(E('viaWhatsApp'))).toBe(false));
  }

  it('worker: the statement for the chosen project, in the remembered language, on the letterhead', async () => {
    setSetting('export_letterhead', '1');
    setSetting('statement_lang', 'ta');
    setCurrent(projectId(SCHOOL));
    setRouteParams({ id: workerId('Nimal Perera') });
    await renderScreen(<WorkerDetail />);
    await pressLabel(E('share'));
    expect(visibleText()).toContain(`${E('pdfStatement')} · ${SCHOOL} · தமிழ் · ${E('letterheadOption')}`);
    await pressLabel(E('sharePdf'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(exportWorkerStatementPdf).toHaveBeenCalledWith(workerId('Nimal Perera'), projectId(SCHOOL), expect.objectContaining({ letterhead: true, lang: 'ta' }));
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/list.pdf', expect.objectContaining({ dialogTitle: `${E('pdfStatement')} · Nimal Perera` }));
    await waitFor(() => expect(hasLabel(E('viaWhatsApp'))).toBe(false));
  });

  it('worker: the "Statement PDF" row opens the options; the language and the letterhead chosen there are used and remembered', async () => {
    setCurrent(null);
    setRouteParams({ id: workerId('Nimal Perera') });
    await renderScreen(<WorkerDetail />);
    await pressLabel(E('statementPdf'));
    expect(visibleText()).toContain(E('statementLanguage'));
    await pressLabel('සිංහල');
    await pressLabel(`${E('letterheadOption')}. ${E('estimateLetterheadHint')}`);
    expect(getSetting('statement_lang')).toBe('si');
    expect(getSetting('export_letterhead')).toBe('1');
    await pressLabel(E('shareNow'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(exportWorkerStatementPdf).toHaveBeenCalledWith(workerId('Nimal Perera'), null, expect.objectContaining({ letterhead: true, lang: 'si' }));
    await waitFor(() => expect(visibleText()).not.toContain(E('statementLanguage'))); // the options sheet has gone
  });

  it('worker: a letterhead that could not load is told after the sheet has gone; a failure keeps the sheet', async () => {
    setSetting('export_letterhead', '1');
    jest.mocked(exportWorkerStatementPdf).mockImplementationOnce(async (_id, _p, opts) => {
      opts.onNotice?.('letterhead-unavailable');
      return { uri: 'file:///cache/list.pdf' } as never;
    });
    setRouteParams({ id: workerId('Nimal Perera') });
    await renderScreen(
      <>
        <WorkerDetail />
        <ToastHost />
      </>,
    );
    await sharePdf();
    expect(visibleText()).toContain(E('letterheadUnavailable'));

    const alert = mockAlert();
    jest.mocked(exportWorkerStatementPdf).mockRejectedValueOnce(new Error('no space left on device'));
    await pressLabel(E('share'));
    await pressLabel(E('sharePdf'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(E('errorTitle'), expect.stringContaining(E('storageFull'))));
    expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
    expect(hasLabel(E('viaWhatsApp'))).toBe(true);
    takeConsole();
  });

  it('expenses: every expense the current filters match, with the filters named', async () => {
    setCurrent(projectId(SCHOOL));
    setSetting('list_expenses_cats', 'materials,fuel');
    setSetting('list_expenses_sort', 'highest');
    await renderScreen(<ExpensesScreen />);
    await sharePdf();
    expect(exportExpensesPdf).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: projectId(SCHOOL), categories: ['materials', 'fuel'], methods: [], minCents: null, maxCents: null }),
      'highest',
      expect.objectContaining({
        letterhead: false,
        filters: expect.arrayContaining([
          { label: E('period'), value: E('allTime') },
          { label: E('category'), value: `${E('cat_materials')}, ${E('cat_fuel')}` },
          { label: E('sortBy'), value: E('sort_highest') },
        ]),
      }),
    );
  });

  it('workers: the roster of the current project', async () => {
    setSetting('export_letterhead', '1');
    setCurrent(projectId(SCHOOL));
    await renderScreen(<WorkersScreen />);
    await sharePdf();
    expect(exportWorkersListPdf).toHaveBeenCalledWith(projectId(SCHOOL), expect.objectContaining({ letterhead: true }));
  });

  it('tools: the whole register', async () => {
    setCurrent(null);
    await renderScreen(<ToolsScreen />);
    await sharePdf();
    expect(exportToolsRegisterPdf).toHaveBeenCalledWith(expect.objectContaining({ letterhead: false }));
  });

  it('today\'s sheet: the chosen project and day', async () => {
    setCurrent(projectId(SCHOOL));
    setRouteParams({ day: addDays(today(), -1) });
    await renderScreen(<TodaysWorkScreen />);
    await sharePdf();
    expect(exportDaySheetPdf).toHaveBeenCalledWith(projectId(SCHOOL), addDays(today(), -1), expect.objectContaining({ letterhead: false }));
  });

  it('site notes: the notes of the project on screen', async () => {
    setRouteParams({ projectId: projectId(SCHOOL) });
    await renderScreen(<NotesScreen />);
    await sharePdf();
    expect(exportNotesPdf).toHaveBeenCalledWith(projectId(SCHOOL), expect.objectContaining({ letterhead: false }));
  });
});
