/**
 * Render smoke tests for the five tabs, with the demo data and with an empty phone.
 * Each variant is mounted in English, Sinhala and Tamil, then switched light -> dark on the
 * mounted screen. See smokeScreen() in '@/test-utils/screenKit'.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import {
  anyOf,
  changeSetting,
  expectClean,
  fireEvent,
  hasLabel,
  pressLabel,
  renderScreen,
  screen,
  setLanguage,
  setTheme,
  smokeScreen,
  visibleText,
} from '@/test-utils/screenKit';

import { router } from 'expo-router';

import ExpensesScreen from '@/app/(tabs)/expenses';
import TodayScreen from '@/app/(tabs)/index';
import ProjectsScreen from '@/app/(tabs)/projects';
import ToolsScreen from '@/app/(tabs)/tools';
import WorkersScreen from '@/app/(tabs)/workers';
import { getSetting, save, setSetting } from '@/db';
import { saveWorker } from '@/db/repo';
import { resetDb, seedDemo } from '@/test-utils';
import { addManyProjects, CULVERT, DRAIN, projectId, SCHOOL, setCurrent } from '@/test-utils/screenData';

const greetings = (tr: (k: 'goodMorning' | 'goodAfternoon' | 'goodEvening') => string) => anyOf(tr('goodMorning'), tr('goodAfternoon'), tr('goodEvening'));

// ---------------------------------------------------------------- Today

smokeScreen('Today tab (demo data)', () => <TodayScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'all projects',
      expect: (tr) => [
        greetings(tr),
        tr('summary'),
        tr('periodDay'),
        tr('periodWeek'),
        tr('periodMonth'),
        tr('total_day'),
        tr('wagesToPay'),
        tr('totalCost'),
        tr('recent'),
        tr('todaysWork'),
        'Rs 253,500', // expenses today: 185,000 + 4,200 school, 64,300 culvert
        'Rs 274,100', // today's total: those expenses + 20,600 labour earned today
        'Rs 39,800', // wages still owed over all workers
        'Rs 643,750', // expenses + labour of the two running projects
        SCHOOL,
        CULVERT,
        tr('noProjectSelected'),
        tr('toolsOut'),
        /^4$/m, // pieces of tools out: the drill, the mixer and two wheelbarrows (cement is a material, not "out")
        `${tr('issue')} · 20 bags`, // the newest movement in the recent list says how much
      ],
    },
    {
      name: 'school project selected',
      prepare: () => setCurrent(projectId(SCHOOL)),
      expect: (tr) => [
        'Rs 189,200', // spent today on the school
        'Rs 32,800', // wages owed on the school roster
        `5 ${tr('worked')}`,
        `${tr('toPayToday')} Rs 17,100`,
        `${tr('contract')} Rs 18,500,000`,
        tr('costSummary'),
        tr('newExpense'),
        tr('issueTool'),
        tr('newNote'),
      ],
    },
    {
      name: 'culvert project selected',
      prepare: () => setCurrent(projectId(CULVERT)),
      expect: (tr) => ['Rs 64,300', 'Rs 7,000', `1 ${tr('worked')}`, `${tr('contract')} Rs 4,200,000`],
    },
    {
      name: 'completed project with no workers or activity',
      prepare: () => setCurrent(projectId(DRAIN)),
      expect: (tr) => [tr('noWorkersOnProject'), tr('noExpenses'), tr('noExpensesHint'), 'Rs 0'],
    },
    {
      name: 'daily backup failed',
      prepare: () => {
        setSetting('auto_backup_error', '2026-01-01T00:00:00.000Z database is locked');
      },
      expect: (tr) => [tr('autoBackupFailed'), tr('runNow')],
    },
    {
      name: 'narrow phone (320 wide): stat tiles stack',
      width: 320,
      langs: ['en', 'ta'],
      prepare: () => setCurrent(projectId(SCHOOL)),
      expect: (tr) => [tr('summary'), 'Rs 189,200', tr('wagesToPay'), 'Rs 32,800', tr('todaysWork'), tr('newExpense')],
    },
    {
      name: 'tablet (768 wide): content is centred',
      width: 768,
      langs: ['en', 'si'],
      expect: (tr) => [tr('summary'), 'Rs 253,500', tr('recent')],
    },
    {
      name: 'daily backup done today',
      prepare: () => {
        setSetting('auto_backup_at', new Date().toISOString());
      },
      expect: (tr) => [tr('dataSafe')],
    },
  ],
});

smokeScreen('Today tab (empty phone)', () => <TodayScreen />, {
  db: 'empty',
  variants: [
    {
      name: 'no projects yet shows the empty state with the primary action',
      expect: (tr) => [greetings(tr), tr('noProjects'), tr('noProjectsHint'), tr('newProject')],
      absent: (tr) => [tr('summary'), tr('recent')],
    },
  ],
});

describe('Today tab with a failed-photo-backup warning', () => {
  beforeAll(() => {
    resetDb();
    seedDemo();
  });
  it('warns when photos exist but there has never been a full backup', async () => {
    save('attachments', {
      owner_table: 'expenses',
      owner_id: 'x',
      kind: 'photo',
      file_name: 'a.jpg',
      mime: 'image/jpeg',
      size: 10,
      sha256: 'abc',
    });
    setSetting('lang', 'en');
    await renderScreen(<TodayScreen />);
    expectClean('today photos overdue');
    expect(visibleText()).toContain('Full backup with photos: Never');
    await pressLabel('Back up now');
    expect(router.push).toHaveBeenCalledWith('/backup');
  });
});

// ---------------------------------------------------------------- Projects

smokeScreen('Projects tab (demo data)', () => <ProjectsScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'grouped by status',
      expect: (tr) => [
        tr('projects'),
        SCHOOL,
        CULVERT,
        DRAIN,
        tr('status_active'),
        tr('status_completed'),
        `${tr('status_active')} (2)`,
        `${tr('status_completed')} (1)`,
        'Rs 557,350', // school: 495,550 expenses + 61,800 labour
        'Rs 86,400', // culvert
        'Rs 643,750', // total of the active group
        'Zonal Education Office, Welimada · Welimada',
      ],
    },
    {
      name: 'narrow phone (320 wide)',
      width: 320,
      langs: ['en', 'si'],
      expect: (tr) => [tr('projects'), SCHOOL, 'Rs 557,350'],
    },
    {
      name: 'tablet (768 wide)',
      width: 768,
      langs: ['en', 'ta'],
      expect: (tr) => [tr('projects'), SCHOOL, 'Rs 557,350'],
    },
    {
      name: 'a project is marked as the current one',
      prepare: () => setCurrent(projectId(CULVERT)),
      expect: (tr) => [tr('thisProject'), CULVERT],
    },
  ],
});

smokeScreen('Projects tab (empty phone)', () => <ProjectsScreen />, {
  db: 'empty',
  variants: [{ name: 'empty state with the primary action', expect: (tr) => [tr('projects'), tr('noProjects'), tr('noProjectsHint'), tr('newProject')] }],
});

describe('Projects tab with many projects', () => {
  beforeAll(() => {
    resetDb();
    seedDemo();
    addManyProjects(9);
  });
  it('shows the search box and filters by name and status', async () => {
    setSetting('lang', 'en');
    await renderScreen(<ProjectsScreen />);
    expectClean('projects many');
    expect(hasLabel('Search')).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Search'), 'extra project 4');
    expect(visibleText()).toContain('Extra Project 4');
    expect(visibleText()).not.toContain('Extra Project 5');
    await fireEvent.changeText(screen.getByLabelText('Search'), 'zzz-no-match');
    expect(visibleText()).toContain('0 Projects');
    expectClean('projects no match');
  });
  it('filters by status chip', async () => {
    setSetting('lang', 'en');
    await renderScreen(<ProjectsScreen />);
    await pressLabel('Completed 4');
    expect(visibleText()).toContain(DRAIN);
    expect(visibleText()).not.toContain(SCHOOL);
    expectClean('projects completed filter');
  });
});

// ---------------------------------------------------------------- Expenses

smokeScreen('Expenses tab (demo data)', () => <ExpensesScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'all projects, grouped by day',
      expect: (tr) => [
        tr('expenses'),
        tr('thisMonth'),
        tr('allExpenses'),
        tr('allProjects'),
        tr('today'),
        'Lanka Cement Depot, Welimada',
        'Rs 185,000',
        'Rs 571,450', // 495,550 school + 75,900 culvert
        `${tr('cat_materials')} · ${SCHOOL} · ${tr('method_bank')}`,
      ],
    },
    {
      name: 'one project selected hides the project name on each row',
      prepare: () => setCurrent(projectId(CULVERT)),
      expect: (tr) => ['Badulla Concrete Works', 'Rs 75,900', `${tr('cat_materials')} · ${tr('method_bank')}`],
      absent: () => ['Lanka Cement Depot, Welimada'],
    },
    {
      name: 'a project with no expenses',
      prepare: () => setCurrent(projectId(DRAIN)),
      expect: (tr) => [tr('noExpenses'), tr('noExpensesHint'), tr('newExpense')],
    },
  ],
});

smokeScreen('Expenses tab (empty phone)', () => <ExpensesScreen />, {
  db: 'empty',
  variants: [{ name: 'empty state with the primary action', expect: (tr) => [tr('expenses'), tr('noExpenses'), tr('noExpensesHint'), tr('newExpense')] }],
});

// ---------------------------------------------------------------- Workers

smokeScreen('Workers tab (demo data)', () => <WorkersScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'all projects',
      expect: (tr) => [
        tr('workers'),
        tr('noProjectSelected'),
        tr('chooseProjectFirstHint'),
        tr('chooseProject'),
        tr('weOwe'),
        tr('workerOwes'),
        tr('balanceAllProjects'),
        `${tr('allWorkers')} (6)`,
        'Nimal Perera',
        'Saman Kumara',
        'Mason · Rs 3,500 / ' + tr('day'),
        'Rs 39,800',
      ],
    },
    {
      name: 'school roster',
      prepare: () => setCurrent(projectId(SCHOOL)),
      expect: (tr) => [
        `${tr('projectWorkers')} (5)`,
        'Ruwan Jayasinghe',
        'Anura Kumara',
        'Rs 32,800',
        `5 ${tr('worked')} · ${tr('toPayToday')} Rs 17,100`,
        tr('weOwe'),
      ],
      absent: () => ['Saman Kumara'],
    },
    {
      name: 'narrow phone (320 wide)',
      width: 320,
      langs: ['en', 'ta'],
      prepare: () => setCurrent(projectId(SCHOOL)),
      expect: (tr) => [tr('weOwe'), 'Rs 32,800', 'Nimal Perera'],
    },
    {
      name: 'tablet (768 wide)',
      width: 768,
      langs: ['en', 'si'],
      expect: (tr) => [tr('weOwe'), 'Rs 39,800', 'Nimal Perera'],
    },
    {
      name: 'culvert roster',
      prepare: () => setCurrent(projectId(CULVERT)),
      expect: (tr) => [`${tr('projectWorkers')} (2)`, 'Saman Kumara', 'Kamal Silva', 'Rs 7,000', tr('settled')],
    },
    {
      name: 'project with nobody assigned shows the empty state with the primary action',
      prepare: () => setCurrent(projectId(DRAIN)),
      expect: (tr) => [tr('noWorkersOnProject'), tr('noWorkersOnProjectHint'), tr('addWorkerToProject')],
    },
  ],
});

smokeScreen('Workers tab (empty phone)', () => <WorkersScreen />, {
  db: 'empty',
  variants: [
    {
      // With no project at all there is one clear way forward (no banner, no day-sheet row).
      name: 'empty state with the primary action',
      expect: (tr) => [tr('workers'), tr('addProjectFirst'), tr('addProjectFirstHint'), tr('newProject')],
    },
  ],
});

describe('Workers tab with an inactive worker', () => {
  beforeAll(() => {
    resetDb();
    seedDemo();
    saveWorker({ name: 'Old Hand', trade: 'Painter', daily_rate_cents: 300_000, active: false });
  });
  it('lists inactive workers in their own group', async () => {
    setSetting('lang', 'en');
    await renderScreen(<WorkersScreen />);
    expectClean('workers inactive');
    expect(visibleText()).toContain('Inactive (1)');
    expect(visibleText()).toContain('Old Hand');
  });
});

// ---------------------------------------------------------------- Tools

smokeScreen('Tools tab (demo data)', () => <ToolsScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'all projects: out and in store',
      expect: (tr) => [
        tr('tools'),
        'Hilti drill · BM-T-001',
        'Concrete mixer · BM-T-002',
        'Vibrator poker · BM-T-003',
        'Aluminium ladder 12 ft · BM-T-005',
        'Wheelbarrow · BM-T-006',
        // the wheelbarrows and the cement are out and in store at the same time: 4 rows out, 5 rows in store
        `${tr('out')} (4)`,
        `${tr('inStore')} (5)`,
        `${tr('outWith')} Sunil Fernando · ${SCHOOL}`,
        tr('all'),
      ],
    },
    {
      name: 'school selected: out here and available',
      prepare: () => setCurrent(projectId(SCHOOL)),
      expect: (tr) => [`${tr('outHere')} (4)`, `${tr('availableToIssue')} (5)`],
    },
    {
      name: 'culvert selected: tools out on another project are collapsed',
      prepare: () => setCurrent(projectId(CULVERT)),
      expect: (tr) => [`${tr('outElsewhere')} (4)`, tr('otherProjects'), tr('showAll'), `${tr('availableToIssue')} (5)`],
      absent: () => ['Hilti drill · BM-T-001'],
    },
  ],
});

smokeScreen('Tools tab (empty phone)', () => <ToolsScreen />, {
  db: 'empty',
  variants: [{ name: 'empty state with the primary action', expect: (tr) => [tr('tools'), tr('noTools'), tr('noToolsHint'), tr('newTool')] }],
});

describe('Tools tab interactions', () => {
  beforeAll(() => {
    resetDb();
    seedDemo();
  });
  it('expands the "other projects" group and filters by Out / In store', async () => {
    setSetting('lang', 'en');
    setCurrent(projectId(CULVERT));
    await renderScreen(<ToolsScreen />);
    expect(visibleText()).not.toContain('Hilti drill');
    await pressLabel('Out on other projects: 4. Show all');
    expect(visibleText()).toContain('Hilti drill · BM-T-001');
    expectClean('tools expanded');
    await changeSetting('current_project', null);
    await pressLabel('Out 4');
    expect(visibleText()).not.toContain('Vibrator poker');
    await pressLabel('In store 5');
    expect(visibleText()).toContain('Vibrator poker');
    expect(visibleText()).not.toContain('Hilti drill');
  });
});

// ---------------------------------------------------------------- the empty states act

describe('empty-state primary actions open the right form', () => {
  beforeAll(() => {
    resetDb();
  });
  it.each([
    ['Today', () => <TodayScreen />, 'New project', '/project/form'],
    ['Projects', () => <ProjectsScreen />, 'New project', '/project/form'],
    ['Expenses', () => <ExpensesScreen />, 'New expense', '/expense/form'],
    ['Workers', () => <WorkersScreen />, 'New worker', '/worker/form'],
    ['Tools', () => <ToolsScreen />, 'New tool', '/tool/form'],
  ] as const)('%s', async (_name, ui, label, href) => {
    setSetting('lang', 'en');
    setSetting('theme', 'light');
    await renderScreen(ui());
    // header buttons share some labels (the Workers and Tools headers have a "New ..." icon button too)
    const all = screen.getAllByLabelText(label);
    await fireEvent.press(all[all.length - 1]);
    expect(router.push).toHaveBeenCalledWith(href);
  });
});

describe('language and theme switch on a mounted tab', () => {
  beforeAll(() => {
    resetDb();
    seedDemo();
  });
  it('re-renders Projects in Sinhala and dark without remounting', async () => {
    setSetting('lang', 'en');
    await renderScreen(<ProjectsScreen />);
    expect(visibleText()).toContain('Projects');
    await setLanguage('si');
    expect(visibleText()).not.toContain('Projects');
    expectClean('projects si');
    await setTheme('dark');
    await setLanguage('ta');
    expectClean('projects ta dark');
  });
});

describe('project pill in the tab header', () => {
  beforeEach(() => {
    resetDb();
    seedDemo();
    addManyProjects(9);
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  it('lists every project with a search box, picks one as current, and goes back to all projects', async () => {
    await renderScreen(<ExpensesScreen />);
    await pressLabel('Choose project: All projects');
    expect(visibleText()).toContain('New project');
    expect(visibleText()).toContain('Extra Project 7');
    expectClean('project sheet');

    // 12 projects: the sheet has its own search box
    const boxes = screen.getAllByLabelText('Search');
    await fireEvent.changeText(boxes[boxes.length - 1], 'culvert');
    expect(screen.queryAllByText('Extra Project 7')).toHaveLength(0);
    await fireEvent.press(screen.getAllByText(CULVERT).at(-1)!);
    expect(getSetting('current_project')).toBe(projectId(CULVERT));
    expect(hasLabel(`Choose project: ${CULVERT}`)).toBe(true);
  });

  it('picking "All projects" clears the current project', async () => {
    setCurrent(projectId(CULVERT));
    await renderScreen(<ExpensesScreen />);
    await pressLabel(`Choose project: ${CULVERT}`);
    await fireEvent.press(screen.getAllByText('All projects').at(-1)!);
    expect(getSetting('current_project')).toBeNull();
    expect(hasLabel('Choose project: All projects')).toBe(true);
  });

  it('"New project" in the sheet opens the project form', async () => {
    await renderScreen(<ExpensesScreen />);
    await pressLabel('Choose project: All projects');
    await fireEvent.press(screen.getAllByLabelText('New project').at(-1)!);
    expect(router.push).toHaveBeenCalledWith('/project/form');
  });

  // KNOWN BUG (components/ui/form.tsx, PickerSheet): the search text is state of a sheet that stays mounted while
  // closed, so reopening it shows the previous search and a filtered list. When it is fixed this test starts
  // failing: change `it.failing` to `it`.
  it.failing('reopening the sheet starts with an empty search', async () => {
    await renderScreen(<ExpensesScreen />);
    await pressLabel('Choose project: All projects');
    const boxes = screen.getAllByLabelText('Search');
    await fireEvent.changeText(boxes[boxes.length - 1], 'culvert');
    // the first "Close" is the dimmed backdrop (the others are the sheet's X and the search box's clear button)
    await fireEvent.press(screen.getAllByLabelText('Close')[0]);
    await pressLabel('Choose project: All projects');
    expect(screen.getAllByText('Extra Project 7').length).toBeGreaterThan(0);
  });
});
