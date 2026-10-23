/**
 * Render smoke tests for the detail screens: project/[id], worker/[id], tool/[id].
 * Every screen is also opened with an id that does not exist, which must show a way out
 * instead of crashing.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { expectClean, fireEvent, pressLabel, renderScreen, screen, setRouteParams, smokeScreen, visibleText } from '@/test-utils/screenKit';

import { router } from 'expo-router';
import * as Print from 'expo-print';

import ProjectDetail from '@/app/project/[id]';
import ToolDetail from '@/app/tool/[id]';
import WorkerDetail from '@/app/worker/[id]';
import { setSetting } from '@/db';
import { recordWorkDay, saveTool, saveWorker } from '@/db/repo';
import { addFile, addPhotos } from '@/lib/files';
import { queuePhotos, resetDb, seedDemo } from '@/test-utils';
import { CULVERT, DRAIN, projectId, SCHOOL, setCurrent, toolId, workerId } from '@/test-utils/screenData';
import { addDays, today } from '@/lib/dates';

// ---------------------------------------------------------------- project/[id]

smokeScreen('project/[id]', () => <ProjectDetail />, {
  db: 'demo',
  variants: [
    {
      name: 'active project with contract, workers, tools out and spend by category',
      prepare: () => setRouteParams({ id: projectId(SCHOOL) }),
      expect: (tr) => [
        SCHOOL,
        tr('status_active'),
        tr('setCurrent'),
        'Zonal Education Office, Welimada · Welimada',
        tr('overview'),
        tr('totalCost'),
        'Rs 557,350',
        `${tr('contract')} Rs 18,500,000`,
        `${tr('balanceToContract')}: Rs 17,942,650`,
        tr('materialsAndOther'),
        'Rs 495,550',
        tr('labour'),
        'Rs 61,800',
        tr('labourPaid'),
        'Rs 29,000', // 24,000 wages + 5,000 advance
        tr('projectWorkers'),
        'Nimal Perera',
        'Ruwan Jayasinghe',
        tr('outHere'),
        'Hilti drill · BM-T-001',
        `${tr('siteNotes')} (2)`,
        tr('byCategory'),
        tr('cat_materials'),
        tr('exportPdf'),
        tr('includePhotos'),
        tr('letterheadOption'),
        tr('documents'),
        tr('projectDocs'),
        tr('takePhoto'),
      ],
    },
    {
      name: 'narrow phone (320 wide)',
      width: 320,
      langs: ['en', 'ta'],
      prepare: () => setRouteParams({ id: projectId(SCHOOL) }),
      expect: (tr) => [SCHOOL, tr('overview'), 'Rs 557,350', tr('labourPaid')],
    },
    {
      name: 'tablet (768 wide)',
      width: 768,
      langs: ['en', 'si'],
      prepare: () => setRouteParams({ id: projectId(SCHOOL) }),
      expect: (tr) => [SCHOOL, tr('overview'), 'Rs 557,350'],
    },
    {
      name: 'the current project is marked and cannot be set again',
      prepare: () => {
        setRouteParams({ id: projectId(SCHOOL) });
        setCurrent(projectId(SCHOOL));
      },
      expect: (tr) => [tr('thisProject')],
      absent: (tr) => [tr('setCurrent')],
    },
    {
      name: 'second running project',
      prepare: () => setRouteParams({ id: projectId(CULVERT) }),
      expect: (tr) => [CULVERT, 'Saman Kumara', 'Rs 86,400', `${tr('contract')} Rs 4,200,000`, 'RDA Badulla · Badulla'],
    },
    {
      name: 'completed project without workers, tools, notes or expenses',
      prepare: () => setRouteParams({ id: projectId(DRAIN) }),
      expect: (tr) => [DRAIN, tr('status_completed'), tr('noWorkersOnProject'), tr('addWorkerToProject'), `${tr('siteNotes')} (0)`, tr('noNotes'), 'Rs 0'],
      absent: (tr) => [tr('byCategory'), tr('outHere')],
    },
    {
      name: 'an id that does not exist shows a way out',
      prepare: () => setRouteParams({ id: 'no-such-project' }),
      expect: (tr) => [tr('noProjects'), tr('close')],
    },
    {
      name: 'no id at all',
      prepare: () => setRouteParams({}),
      expect: (tr) => [tr('noProjects'), tr('close')],
    },
  ],
});

describe('project/[id] actions', () => {
  beforeEach(() => {
    resetDb();
    seedDemo();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  it('"Set as current" makes it the current project; Edit opens the form; Close goes back from a missing project', async () => {
    const id = projectId(SCHOOL);
    setRouteParams({ id });
    await renderScreen(<ProjectDetail />);
    await pressLabel('Work on this project');
    expect(visibleText()).toContain('This project');
    await pressLabel('Edit project');
    expect(router.push).toHaveBeenCalledWith(`/project/form?id=${id}`);
  });

  it('shows the photo strip with thumbnails and opens one full size', async () => {
    const id = projectId(SCHOOL);
    setRouteParams({ id });
    queuePhotos(2);
    await addPhotos('projects', id, 'gallery');
    await renderScreen(<ProjectDetail />);
    expectClean('project with photos');
    expect(screen.getAllByLabelText(/^Drawings & documents [12]$/)).toHaveLength(2);
    await fireEvent.press(screen.getByLabelText('Drawings & documents 1'));
    expect(screen.getAllByLabelText('Close').length).toBeGreaterThan(0);
    expectClean('photo viewer');
  });

  it('shows an attached PDF as a document tile that opens a viewer with an Open button', async () => {
    const id = projectId(SCHOOL);
    setRouteParams({ id });
    const { uri } = await Print.printToFileAsync({ html: '<p>drawing</p>' });
    await addFile('projects', id, uri, 'application/pdf');
    await renderScreen(<ProjectDetail />);
    expectClean('project with a pdf');
    expect(screen.getAllByLabelText('Drawings & documents 1')).toHaveLength(1);
    expect(screen.queryAllByRole('image')).toHaveLength(0); // a PDF is not drawn as a picture
    await fireEvent.press(screen.getByLabelText('Drawings & documents 1'));
    expect(screen.getAllByLabelText('Open').length).toBeGreaterThan(0);
    expectClean('pdf viewer');
  });

  it('missing project: the Close button goes back', async () => {
    setRouteParams({ id: 'gone' });
    await renderScreen(<ProjectDetail />);
    await pressLabel('Close');
    expect(router.back).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- worker/[id]

const setupWorkers = () => {
  saveWorker({ name: 'Dormant Dan', trade: 'Plumber', daily_rate_cents: 280_000, active: false });
  saveWorker({ name: 'Fresh Face', daily_rate_cents: 0 });
  // Kamal now has work on both projects, so his history gets one filter chip per project.
  recordWorkDay({ project_id: projectId(CULVERT), worker_id: workerId('Kamal Silva'), day: addDays(today(), -1), days: 1 });
};

smokeScreen('worker/[id]', () => <WorkerDetail />, {
  db: 'demo',
  setup: setupWorkers,
  variants: [
    {
      name: 'worker on one project owed money',
      prepare: () => setRouteParams({ id: workerId('Nimal Perera') }),
      expect: (tr) => [
        'Nimal Perera',
        tr('balanceAllProjects'),
        'Rs 3,500', // still owed
        tr('weOwe'),
        `Mason · ${tr('dailyRate')} Rs 3,500`,
        '0771234567',
        tr('earned'),
        'Rs 17,500',
        tr('advances'),
        tr('paid'),
        'Rs 14,000',
        tr('recordWork'),
        tr('giveAdvance'),
        tr('payWages'),
        tr('perProject'),
        SCHOOL,
        tr('history'),
        tr('wage_work'),
        tr('wage_payment'),
        tr('markInactive'),
      ],
    },
    {
      name: 'worker on two projects (history filter chips)',
      prepare: () => setRouteParams({ id: workerId('Kamal Silva') }),
      expect: (tr) => ['Kamal Silva', SCHOOL, CULVERT, tr('all'), tr('wage_advance'), 'Rs 5,000', tr('perProject'), 'Rs 2,300'],
    },
    {
      name: 'worker on the current project can be removed from it',
      prepare: () => {
        setRouteParams({ id: workerId('Saman Kumara') });
        setCurrent(projectId(CULVERT));
      },
      expect: (tr) => ['Saman Kumara', tr('removeFromProject'), 'Rs 7,000'],
    },
    {
      name: 'inactive worker with no work',
      prepare: () => setRouteParams({ id: workerId('Dormant Dan') }),
      expect: (tr) => ['Dormant Dan', tr('inactive'), tr('markActive'), `${tr('recordWork')} · ${tr('giveAdvance')} · ${tr('payWages')}`],
      // nothing was ever earned or paid, so there is nothing to call "settled"
      absent: (tr) => [tr('settled')],
    },
    {
      name: 'new worker without a rate, trade or phone',
      prepare: () => setRouteParams({ id: workerId('Fresh Face') }),
      expect: (tr) => ['Fresh Face', 'Rs 0'],
      absent: (tr) => [tr('settled')],
    },
    {
      name: 'an id that does not exist shows a way out',
      prepare: () => setRouteParams({ id: 'no-such-worker' }),
      expect: (tr) => [tr('worker'), tr('close')],
    },
  ],
});

describe('worker/[id] actions', () => {
  beforeEach(() => {
    resetDb();
    seedDemo();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  it('Pay wages opens the wage form on the right project with the owed amount', async () => {
    const worker = workerId('Nimal Perera');
    setRouteParams({ id: worker });
    await renderScreen(<WorkerDetail />);
    await pressLabel('Pay wages');
    expect(router.push).toHaveBeenCalledWith(`/wage/form?workerId=${worker}&kind=payment&projectId=${projectId(SCHOOL)}&amount=350000`);
  });

  it('a worker on two projects asks which project first', async () => {
    const worker = workerId('Kamal Silva');
    setRouteParams({ id: worker });
    await renderScreen(<WorkerDetail />);
    await pressLabel('Record work');
    expect(router.push).not.toHaveBeenCalled();
    // the project picker sheet is open: choose the culvert
    await fireEvent.press(screen.getAllByText(CULVERT).at(-1)!);
    expect(router.push).toHaveBeenCalledWith(`/wage/form?workerId=${worker}&kind=work&projectId=${projectId(CULVERT)}`);
  });

  it('Mark inactive turns the worker inactive', async () => {
    setRouteParams({ id: workerId('Nimal Perera') });
    await renderScreen(<WorkerDetail />);
    await pressLabel('Mark as left');
    expect(visibleText()).toContain('Inactive');
    expect(visibleText()).toContain('Mark as working');
  });
});

// ---------------------------------------------------------------- tool/[id]

smokeScreen('tool/[id]', () => <ToolDetail />, {
  db: 'demo',
  setup: () => {
    saveTool({ name: 'Notes Tool', code: 'BM-T-050', notes: 'Keep dry. Check the blade before use.' });
  },
  variants: [
    {
      name: 'tool that is out with a worker',
      prepare: () => setRouteParams({ id: toolId('Hilti drill') }),
      expect: (tr) => [
        'Hilti drill · BM-T-001',
        `${tr('outWith')} Sunil Fernando`,
        SCHOOL,
        tr('out'),
        tr('returnTool'),
        tr('history'),
        `${tr('issue')} · `,
        'Sunil Fernando · ' + SCHOOL + ' · Good',
      ],
      // the tool itself has no photos, so no empty "Photo proof" heading
      absent: (tr) => [tr('issueTool'), tr('photoProof'), tr('inStore')],
    },
    {
      name: 'tool back in the store with a return in its history',
      prepare: () => setRouteParams({ id: toolId('Aluminium ladder 12 ft') }),
      expect: (tr) => [
        'Aluminium ladder 12 ft · BM-T-005',
        tr('inStore'),
        tr('issueTool'),
        `${tr('return')} · `,
        'Kamal Silva · ' + SCHOOL + ' · One rung loose',
      ],
      absent: (tr) => [tr('returnTool')],
    },
    {
      name: 'tool that was never issued',
      prepare: () => setRouteParams({ id: toolId('Vibrator poker') }),
      expect: (tr) => ['Vibrator poker · BM-T-003', tr('inStore'), tr('issueTool'), tr('history')],
    },
    {
      name: 'tool with notes',
      prepare: () => setRouteParams({ id: toolId('Notes Tool') }),
      expect: (tr) => ['Keep dry. Check the blade before use.', tr('notes')],
    },
    {
      name: 'an id that does not exist shows a way out',
      prepare: () => setRouteParams({ id: 'no-such-tool' }),
      expect: (tr) => [tr('toolNotFound'), tr('close')],
    },
  ],
});

describe('tool/[id] actions', () => {
  beforeEach(() => {
    resetDb();
    seedDemo();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  it('Return opens the move form for that tool; Issue passes the current project', async () => {
    const drill = toolId('Hilti drill');
    setRouteParams({ id: drill });
    await renderScreen(<ToolDetail />);
    await pressLabel('Return tool');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/tool/move', params: { toolId: drill, kind: 'return' } });
  });

  it('Issue includes the current project', async () => {
    const poker = toolId('Vibrator poker');
    setCurrent(projectId(SCHOOL));
    setRouteParams({ id: poker });
    await renderScreen(<ToolDetail />);
    await pressLabel('Issue tool');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/tool/move', params: { toolId: poker, kind: 'issue', projectId: projectId(SCHOOL) } });
  });
});
