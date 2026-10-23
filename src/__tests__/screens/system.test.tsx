/**
 * Render smoke tests for the screens behind the Settings button and the quick-add sheet:
 * more, backup, import, problem, add, notes. Each in English, Sinhala and Tamil, light and dark.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import AddSheet from '@/app/add';
import BackupScreen from '@/app/backup';
import ImportScreen from '@/app/import';
import MoreScreen from '@/app/more';
import NotesScreen from '@/app/notes';
import ProblemScreen from '@/app/problem';
import { getSetting, save, setSetting } from '@/db';
import { backupsDir, runAutoBackupIfDue } from '@/lib/autoBackup';
import { formatDay, today } from '@/lib/dates';
import { reportError, errorLogFile } from '@/lib/errors';
import { addPhotos } from '@/lib/files';
import { exportProjectPdf } from '@/lib/pdf';
import { File, mockAlert, Paths, queueFilePick, queuePhotos, resetDb, seedDemo } from '@/test-utils';
import { CULVERT, DRAIN, noonToday, noteId, projectId, rows, SCHOOL, setCurrent } from '@/test-utils/screenData';
import {
  act,
  expectClean,
  makeTr,
  fireEvent,
  hasLabel,
  pressAlertButton,
  pressLabel,
  pressText,
  renderScreen,
  screen,
  setRouteParams,
  smokeScreen,
  takeConsole,
  visibleText,
} from '@/test-utils/screenKit';

const E = makeTr('en');

// ---------------------------------------------------------------- more

smokeScreen('more (settings)', () => <MoreScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'settings with the demo data loaded',
      expect: (tr) => [
        tr('backup'),
        tr('importPdf'),
        tr('importPdfHint'),
        tr('siteNotes'),
        tr('reportProblem'),
        tr('errorLog'),
        tr('language'),
        'English',
        'සිංහල',
        'தமிழ்',
        tr('appearance'),
        tr('theme_system'),
        tr('theme_light'),
        tr('theme_dark'),
        tr('about'),
        'Reg. No. PV 00232701 · Welimada, Badulla',
        `${tr('version')} 1.0.0 · ${tr('buildNumber')} 1`,
        tr('developedBy'),
        'ZYFLO.TECH',
        'Load demo data',
        `${tr('autoBackupLast')}: ${tr('never')}`,
      ],
      check: () => expect(visibleText()).toMatch(/ID [0-9a-f]{8}/),
    },
    {
      name: 'daily backup done today shows the green line',
      prepare: () => setSetting('auto_backup_at', noonToday()),
      expect: (tr) => [`${tr('dataSafe')} · `],
    },
    {
      name: 'daily backup failed shows the red line',
      prepare: () => setSetting('auto_backup_error', '2026-01-01T00:00:00.000Z database is locked'),
      expect: (tr) => [tr('autoBackupFailed')],
    },
    {
      name: 'daily backup late shows the last day',
      prepare: () => setSetting('auto_backup_at', '2026-10-01T08:30:00.000Z'),
      expect: (tr) => [`${tr('autoBackupLast')}: 1 Oct 2026`],
    },
  ],
});

smokeScreen('more (empty phone)', () => <MoreScreen />, {
  db: 'empty',
  variants: [
    {
      name: 'settings on a new phone: backup, language, appearance and demo-data entries',
      expect: (tr) => [tr('backup'), tr('language'), tr('appearance'), 'Load demo data', 'ZYFLO.TECH'],
    },
  ],
});

describe('more: settings actions', () => {
  beforeEach(() => {
    resetDb();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  it('choosing a language saves it and the screen switches', async () => {
    await renderScreen(<MoreScreen />);
    await pressLabel('සිංහල');
    expect(getSetting('lang')).toBe('si');
    expect(visibleText()).not.toContain(E('language'));
    expectClean('more si');
    await pressLabel('தமிழ்');
    expect(getSetting('lang')).toBe('ta');
    await pressLabel('English');
    expect(getSetting('lang')).toBe('en');
    expect(visibleText()).toContain(E('language'));
  });

  it('choosing a theme saves it', async () => {
    await renderScreen(<MoreScreen />);
    await pressLabel(E('theme_dark'));
    expect(getSetting('theme')).toBe('dark');
    expectClean('more dark');
    await pressLabel(E('theme_system'));
    expect(getSetting('theme')).toBe('system');
  });

  it('"Load demo data" loads the demo set once and says so the second time', async () => {
    const alert = mockAlert();
    await renderScreen(<MoreScreen />);
    await pressText('Load demo data');
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Demo data loaded'));
    expect(rows('SELECT 1 FROM projects WHERE deleted_at IS NULL')).toHaveLength(3);
    await pressText('Load demo data');
    await waitFor(() => expect(alert).toHaveBeenLastCalledWith('Demo data is already here'));
    expect(rows('SELECT 1 FROM projects WHERE deleted_at IS NULL')).toHaveLength(3);
  });

  it('the rows open their screens', async () => {
    await renderScreen(<MoreScreen />);
    await fireEvent.press(screen.getByText(E('backup')));
    expect(router.push).toHaveBeenLastCalledWith('/backup');
    await fireEvent.press(screen.getByText(E('importPdf')));
    expect(router.push).toHaveBeenLastCalledWith('/import');
    await fireEvent.press(screen.getByText(E('siteNotes')));
    expect(router.push).toHaveBeenLastCalledWith('/notes');
    await fireEvent.press(screen.getByText(E('reportProblem')));
    expect(router.push).toHaveBeenLastCalledWith('/problem');
  });
});

// ---------------------------------------------------------------- backup

const noSnapshots = () => backupsDir().list().forEach((f) => f.delete());

smokeScreen('backup', () => <BackupScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'nothing backed up yet',
      prepare: noSnapshots,
      expect: (tr) => [
        tr('autoBackup'),
        tr('autoBackupHint', { days: 25 }),
        tr('runNow'),
        `${tr('autoBackupLast')}: ${tr('never')}`,
        tr('fullBackup'),
        `${tr('lastBackup')}: ${tr('never')}`,
        tr('fullBackupHint'),
        tr('backupNow'),
        tr('restore'),
        tr('restoreHint'),
        `0 ${tr('receiptPhotos')}`,
      ],
    },
    {
      name: 'a daily snapshot exists',
      prepare: async () => {
        expect(await runAutoBackupIfDue(true)).toBe('done');
      },
      expect: (tr) => [
        tr('dataSafe'),
        tr('autoBackups'),
        tr('today'),
        / KB/,
        tr('olderDeleted', { days: 25 }),
        tr('shareBackup', { day: formatDay(today()) }),
        tr('restoreThisBackup', { day: formatDay(today()) }),
      ],
    },
    {
      name: 'the last daily backup failed',
      prepare: () => {
        noSnapshots();
        setSetting('auto_backup_error', '2026-10-21T10:00:00.000Z database is locked');
      },
      expect: (tr) => [tr('autoBackupFailed'), 'database is locked'],
    },
  ],
});

smokeScreen('backup (photos waiting for a full backup)', () => <BackupScreen />, {
  db: 'demo',
  setup: () => {
    save('attachments', { owner_table: 'projects', owner_id: 'x', kind: 'photo', file_name: 'a.jpg', mime: 'image/jpeg', size: 1500, sha256: 'abc' });
  },
  variants: [
    {
      name: 'photos exist and the last full backup is old',
      prepare: () => {
        noSnapshots();
        const at = '2026-09-01T10:00:00.000Z';
        setSetting('last_backup_at', at);
        daysOld = Math.floor((Date.now() - Date.parse(at)) / 86400000);
      },
      expect: (tr) => [tr('photosOverdue', { days: daysOld }), tr('fullBackup'), `1 ${tr('receiptPhotos')}`],
    },
  ],
});

let daysOld = 0;

describe('backup: actions', () => {
  beforeEach(() => {
    resetDb();
    seedDemo();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  it('a backup file shared into the app asks before restoring', async () => {
    const alert = mockAlert();
    setRouteParams({ uri: 'file:///shared/Bluemoon-backup.zip' });
    await renderScreen(<BackupScreen />);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe(E('restoreWarnTitle'));
    expectClean('backup shared file');
  });

  it('Run now writes today\'s snapshot and lists it', async () => {
    await renderScreen(<BackupScreen />);
    expect(screen.queryByText(E('autoBackups'))).toBeNull();
    await pressLabel(E('runNow'));
    await waitFor(() => expect(visibleText()).toContain(E('autoBackups')));
    expect(visibleText()).toContain(E('dataSafe'));
    expectClean('backup after run now');
    expect(takeConsole()).toEqual([]);
  });

  it('Back up now builds the zip and opens the share sheet', async () => {
    await renderScreen(<BackupScreen />);
    await pressLabel(E('backupNow'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
    const [uri, options] = (Sharing.shareAsync as jest.Mock).mock.calls[0];
    expect(String(uri)).toMatch(/\.zip$/);
    expect(options).toMatchObject({ mimeType: 'application/zip' });
    await waitFor(() => expect(getSetting('last_backup_at')).not.toBeNull());
    expectClean('backup after full backup');
  });

  it('the automatic backup switch is saved', async () => {
    await renderScreen(<BackupScreen />);
    // The whole row is the switch (ToggleRow): its name starts with the title.
    const toggle = () => screen.getByRole('switch', { name: new RegExp(`^${E('autoBackup')}`) });
    expect(toggle().props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(toggle());
    expect(getSetting('auto_backup')).toBe('off');
    expect(toggle().props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(toggle());
    expect(getSetting('auto_backup')).toBe('on');
  });

  it('restoring a snapshot asks first, then reports what was restored', async () => {
    await runAutoBackupIfDue(true);
    const alert = mockAlert();
    await renderScreen(<BackupScreen />);
    await fireEvent.press(screen.getAllByRole('button', { name: /^Restore backup / })[0]);
    expect(alert).toHaveBeenCalled();
    await pressAlertButton(alert, E('restore'));
    await waitFor(() => expect(visibleText()).toContain(E('restoreDone')));
    expectClean('backup restored');
  });

  it('picking a file that is not a backup says so', async () => {
    const junk = new File(Paths.cache, 'junk.zip');
    junk.create();
    junk.writeSync(new Uint8Array([1, 2, 3, 4]));
    queueFilePick(junk.uri);
    const alert = mockAlert();
    await renderScreen(<BackupScreen />);
    await pressLabel(E('restore'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    await pressAlertButton(alert, E('restore'));
    await waitFor(() => expect(alert.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(alert.mock.calls.at(-1)?.[0]).toBe(E('errorTitle'));
    takeConsole(); // the failure is logged in development
  });
});

// ---------------------------------------------------------------- import

describe('import', () => {
  let pdfBytes: Uint8Array;
  let foreignBytes: Uint8Array;

  beforeAll(async () => {
    // A real "Bluemoon PDF" for the school, and a PDF that is not ours, made once.
    resetDb();
    seedDemo();
    pdfBytes = (await exportProjectPdf(projectId(SCHOOL), { includePhotos: false, letterhead: false })).bytesSync();
    const { uri } = await Print.printToFileAsync({ html: '<p>hello</p>' });
    foreignBytes = new File(uri).bytesSync();
  });

  const pickFile = (bytes: Uint8Array, name = 'picked.pdf') => {
    const f = new File(Paths.cache, name);
    if (f.exists) f.delete();
    f.create();
    f.writeSync(bytes);
    queueFilePick(f.uri);
    return f.uri;
  };

  beforeEach(() => {
    resetDb();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  it('starts by asking for a PDF', async () => {
    await renderScreen(<ImportScreen />);
    expectClean('import pick');
    expect(visibleText()).toContain(E('importPdf'));
    expect(hasLabel(E('choosePdf'))).toBe(true);
  });

  it.each(['si', 'ta'] as const)('the first step renders in %s and dark', async (lang) => {
    setSetting('lang', lang);
    setSetting('theme', 'dark');
    await renderScreen(<ImportScreen />);
    expectClean(`import ${lang}`);
  });

  it('cancelling the picker changes nothing', async () => {
    await renderScreen(<ImportScreen />);
    await pressLabel(E('choosePdf'));
    expect(visibleText()).toContain(E('choosePdf'));
    expectClean('import cancelled');
  });

  it('a Bluemoon PDF shows a preview with the project and what will change, then imports it', async () => {
    pickFile(pdfBytes);
    await renderScreen(<ImportScreen />);
    await pressLabel(E('choosePdf'));
    await waitFor(() => expect(visibleText()).toContain(SCHOOL));
    expectClean('import preview');
    expect(visibleText()).toContain(E('willChange'));
    expect(hasLabel(E('importNow'))).toBe(true);

    await pressLabel(E('importNow'));
    await waitFor(() => expect(visibleText()).toContain(E('importDone')));
    expectClean('import done');
    expect(rows('SELECT 1 FROM projects WHERE name = ? AND deleted_at IS NULL', [SCHOOL])).toHaveLength(1);
    expect(rows('SELECT 1 FROM expenses WHERE deleted_at IS NULL').length).toBeGreaterThan(0);

    await pressLabel(E('done'));
    expect(router.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/project\//));
  });

  it('every step renders in Tamil and in Sinhala, dark: preview, done, attach-to-project', async () => {
    seedDemo();
    setSetting('theme', 'dark');
    setSetting('lang', 'ta');
    const ta = makeTr('ta');
    pickFile(foreignBytes, 'foreign.pdf');
    await renderScreen(<ImportScreen />);
    await pressLabel(ta('choosePdf'));
    await waitFor(() => expect(visibleText()).toContain(ta('notOurPdf')));
    expectClean('import foreign ta dark');
    await screen.unmount();

    resetDb();
    setSetting('theme', 'dark');
    setSetting('lang', 'si');
    const si = makeTr('si');
    pickFile(pdfBytes);
    await renderScreen(<ImportScreen />);
    await pressLabel(si('choosePdf'));
    await waitFor(() => expect(visibleText()).toContain(SCHOOL));
    expectClean('import preview si dark');
    expect(visibleText()).toContain(si('willChange'));
    await pressLabel(si('importNow'));
    await waitFor(() => expect(visibleText()).toContain(si('importDone')));
    expectClean('import done si dark');
  });

  it('importing the same PDF a second time shows that nothing changes', async () => {
    pickFile(pdfBytes);
    await renderScreen(<ImportScreen />);
    await pressLabel(E('choosePdf'));
    await waitFor(() => expect(hasLabel(E('importNow'))).toBe(true));
    await pressLabel(E('importNow'));
    await waitFor(() => expect(visibleText()).toContain(E('importDone')));
    await screen.unmount();

    pickFile(pdfBytes);
    await renderScreen(<ImportScreen />);
    await pressLabel(E('choosePdf'));
    await waitFor(() => expect(visibleText()).toContain(SCHOOL));
    expectClean('import unchanged');
    expect(visibleText()).toContain(E('unchanged'));
    expect(hasLabel(E('importNow'))).toBe(false);
  });

  it('a PDF that is not ours can be attached to a project', async () => {
    seedDemo();
    pickFile(foreignBytes, 'foreign.pdf');
    await renderScreen(<ImportScreen />);
    await pressLabel(E('choosePdf'));
    await waitFor(() => expect(hasLabel(E('attachToProject'))).toBe(true));
    expectClean('import foreign');
    expect(visibleText()).toContain(E('notOurPdf'));
    await pressLabel(E('attachToProject'));
    await fireEvent.press(screen.getAllByText(CULVERT).at(-1)!);
    await waitFor(() => expect(rows("SELECT 1 FROM attachments WHERE owner_table = 'projects' AND kind = 'pdf' AND deleted_at IS NULL")).toHaveLength(1));
    expect(router.replace).toHaveBeenCalledWith(`/project/${projectId(CULVERT)}`);
  });

  it('bytes that are not a PDF at all are offered as an attachment too', async () => {
    pickFile(new Uint8Array([1, 2, 3, 4, 5]), 'junk.pdf');
    await renderScreen(<ImportScreen />);
    await pressLabel(E('choosePdf'));
    await waitFor(() => expect(visibleText()).toContain(E('notOurPdf')));
    expectClean('import junk');
  });

  it('a file that cannot be read shows an error with a way to choose another', async () => {
    new File(pickFile(pdfBytes, 'vanished.pdf')).delete(); // chosen, then gone before it is read
    await renderScreen(<ImportScreen />);
    await pressLabel(E('choosePdf'));
    await waitFor(() => expect(visibleText()).toContain(E('errorTitle')));
    expectClean('import error');
    expect(visibleText()).toContain(E('somethingWrong'));
    expect(hasLabel(E('choosePdf'))).toBe(true);
    takeConsole(); // the failure is logged in development
  });

  it('a PDF shared into the app is read straight away', async () => {
    const uri = pickFile(pdfBytes, 'shared.pdf');
    queueFilePick(); // nothing further to pick
    setRouteParams({ uri });
    await renderScreen(<ImportScreen />);
    await waitFor(() => expect(visibleText()).toContain(SCHOOL));
    expectClean('import shared');
  });
});

// ---------------------------------------------------------------- problem

describe('problem (error log)', () => {
  beforeEach(() => {
    resetDb();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  const logSomething = () => {
    reportError(new Error('first boom'), 'test.first', { table: 'expenses' });
    reportError(new Error('second boom'), 'test.second');
    const f = errorLogFile();
    f.writeSync(f.textSync() + 'a plain line that is not JSON\n');
    takeConsole(); // reportError logs to console.error in development
  };

  it('an empty log says there is nothing to report', async () => {
    await renderScreen(<ProblemScreen />);
    expectClean('problem empty');
    expect(visibleText()).toContain(E('noErrors'));
    expect(hasLabel(E('shareLog'))).toBe(false);
  });

  it.each(['en', 'si', 'ta'] as const)('lists the newest errors first [%s]', async (lang) => {
    setSetting('lang', lang);
    setSetting('theme', lang === 'en' ? 'light' : 'dark');
    logSomething();
    await renderScreen(<ProblemScreen />);
    expectClean(`problem ${lang}`);
    const text = visibleText();
    expect(text).toContain('test.first');
    expect(text).toContain('second boom');
    expect(text).toContain('a plain line that is not JSON');
    expect(text.indexOf('second boom')).toBeLessThan(text.indexOf('first boom'));
    expect(text).toContain('3');
  });

  it('tapping an error shows its detail; Share log opens the share sheet; Clear log empties the list', async () => {
    logSomething();
    const alert = mockAlert();
    await renderScreen(<ProblemScreen />);

    await fireEvent.press(screen.getByText('test.first'));
    expect(alert.mock.calls.at(-1)?.[0]).toBe('test.first');
    expect(String(alert.mock.calls.at(-1)?.[1])).toContain('first boom');

    await pressLabel(E('shareLog'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
    expect(String((Sharing.shareAsync as jest.Mock).mock.calls[0][0])).toMatch(/errors-\d{4}-\d{2}-\d{2}\.txt$/);

    await pressLabel(E('clearLog'));
    expect(alert.mock.calls.at(-1)?.[0]).toBe(E('clearLog'));
    await pressAlertButton(alert, E('clearLog'));
    await waitFor(() => expect(visibleText()).toContain(E('noErrors')));
    expect(errorLogFile().exists).toBe(false);
  });

  it('shows an error that is logged while the screen is open', async () => {
    await renderScreen(<ProblemScreen />);
    expect(visibleText()).toContain(E('noErrors'));
    await act(async () => {
      reportError(new Error('live boom'), 'test.live');
    });
    takeConsole();
    expect(visibleText()).toContain('live boom');
  });
});

// ---------------------------------------------------------------- add (quick-add sheet)

smokeScreen('add (quick-add sheet)', () => <AddSheet />, {
  db: 'demo',
  variants: [
    {
      name: 'with all projects',
      expect: (tr) => [tr('whatToAdd'), `${tr('project')}: ${tr('allProjects')}`, tr('newExpense'), tr('todaysWork'), tr('giveAdvance'), tr('issueTool'), tr('newNote'), tr('newWorker')],
    },
    {
      name: 'with a project selected',
      prepare: () => setCurrent(projectId(CULVERT)),
      expect: (tr) => [`${tr('project')}: ${CULVERT}`],
    },
  ],
});

describe('add: choices open their forms', () => {
  beforeAll(() => {
    resetDb();
    seedDemo();
  });
  it.each([
    ['newExpense', '/expense/form'],
    ['todaysWork', '/wage/today'],
    ['giveAdvance', '/wage/form?kind=advance'],
    ['issueTool', '/tool/move?kind=issue'],
    ['newNote', '/note/form'],
    ['newWorker', '/worker/form'],
  ] as const)('%s', async (key, href) => {
    setSetting('lang', 'en');
    await renderScreen(<AddSheet />);
    await fireEvent.press(screen.getByText(E(key)));
    expect(router.replace).toHaveBeenCalledWith(href);
  });
  it('the dimmed background and the close button go back', async () => {
    setSetting('lang', 'en');
    await renderScreen(<AddSheet />);
    await fireEvent.press(screen.getAllByLabelText('Close')[0]);
    expect(router.back).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- notes

smokeScreen('notes', () => <NotesScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'notes of the project passed in',
      prepare: () => setRouteParams({ projectId: projectId(SCHOOL) }),
      expect: (tr) => [SCHOOL, tr('notesCount', { n: 2 }), 'First-floor slab shuttering completed on the east side.', 'Rain after 3 pm', tr('today'), tr('weather_sunny'), tr('weather_rain'), tr('newNote')],
      absent: () => ['Old pipes removed. RDA engineer visited and approved the new levels.'],
    },
    {
      name: 'notes of the current project',
      prepare: () => setCurrent(projectId(CULVERT)),
      expect: (tr) => [CULVERT, tr('notesCount', { n: 1 }), 'Old pipes removed.', tr('weather_cloudy')],
    },
    {
      name: 'notes of all projects name their project',
      expect: (tr) => [tr('allProjects'), tr('notesCount', { n: 3 }), SCHOOL, CULVERT],
    },
    {
      name: 'a project without notes shows the empty state with the primary action',
      prepare: () => setRouteParams({ projectId: projectId(DRAIN) }),
      expect: (tr) => [DRAIN, tr('noNotes'), tr('noNotesHint'), tr('newNote'), tr('notesCount', { n: 0 })],
    },
  ],
});

describe('notes: photos and actions', () => {
  beforeEach(() => {
    resetDb();
    seedDemo();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  it('shows thumbnails of the photos attached to a note, with a +N tile past four', async () => {
    const id = noteId('First-floor slab');
    queuePhotos(5);
    await addPhotos('site_notes', id, 'gallery');
    setRouteParams({ projectId: projectId(SCHOOL) });
    await renderScreen(<NotesScreen />);
    expectClean('notes with photos');
    expect(screen.getAllByLabelText(E('photoProof'))).toHaveLength(4);
    expect(visibleText()).toContain('+1');
  });

  it('tapping a note opens it; New note opens the form for the project', async () => {
    setRouteParams({ projectId: projectId(SCHOOL) });
    await renderScreen(<NotesScreen />);
    await fireEvent.press(screen.getByText(/^Rain after 3 pm/));
    expect(router.push).toHaveBeenLastCalledWith(`/note/form?id=${noteId('Rain after 3 pm')}`);
    await pressLabel(E('newNote'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/note/form', params: { projectId: projectId(SCHOOL) } });
  });
});
