/**
 * Render smoke tests for every form: new and edit, every kind of wage entry, tool issue / return,
 * and the add-worker-to-project screen. Edit forms must show the stored values in their inputs.
 * An edit form opened with an id that no longer exists renders nothing (and does not crash).
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { expectClean, renderScreen, screen, setRouteParams, smokeScreen, visibleText } from '@/test-utils/screenKit';

import ExpenseForm from '@/app/expense/form';
import NoteForm from '@/app/note/form';
import ProjectForm from '@/app/project/form';
import ToolForm from '@/app/tool/form';
import ToolMove from '@/app/tool/move';
import WageForm from '@/app/wage/form';
import AssignWorkerScreen from '@/app/worker/assign';
import WorkerForm from '@/app/worker/form';
import { setSetting } from '@/db';
import { assignWorker, saveProject, saveTool } from '@/db/repo';
import { addDays, today } from '@/lib/dates';
import { resetDb } from '@/test-utils';
import {
  CULVERT,
  DRAIN,
  expenseId,
  movementId,
  noteId,
  projectId,
  SCHOOL,
  setCurrent,
  toolId,
  wageEntryId,
  workerId,
} from '@/test-utils/screenData';

// ---------------------------------------------------------------- project/form

smokeScreen('project/form', () => <ProjectForm />, {
  db: 'demo',
  variants: [
    {
      name: 'new project',
      expect: (tr) => [
        tr('newProject'),
        tr('projectName'),
        tr('client'),
        tr('location'),
        tr('contractValue'),
        tr('startDate'),
        tr('endDate'),
        '2026-10-21',
        tr('status'),
        tr('status_active'),
        tr('status_on_hold'),
        tr('status_completed'),
        tr('notes'),
        tr('save'),
        tr('optional'),
      ],
      absent: (tr) => [tr('editProject')],
      check: (tr) => expect(screen.queryAllByLabelText(tr('delete'))).toHaveLength(0),
    },
    {
      name: 'edit shows the stored values and a delete button',
      prepare: () => setRouteParams({ id: projectId(SCHOOL) }),
      expect: (tr) => [
        tr('editProject'),
        SCHOOL,
        'Zonal Education Office, Welimada',
        'Welimada',
        '18500000',
        addDays(today(), -60),
        tr('save'),
      ],
      check: (tr) => expect(screen.getAllByLabelText(tr('delete'))).toHaveLength(1),
    },
    {
      name: 'edit a completed project',
      prepare: () => setRouteParams({ id: projectId(DRAIN) }),
      expect: (tr) => [DRAIN, '2750000', addDays(today(), -40), tr('status_completed')],
    },
    {
      name: 'an id that does not exist renders nothing',
      prepare: () => setRouteParams({ id: 'gone' }),
      blank: true,
    },
  ],
});

// ---------------------------------------------------------------- expense/form

smokeScreen('expense/form', () => <ExpenseForm />, {
  db: 'demo',
  variants: [
    {
      name: 'new expense on the current project',
      prepare: () => setCurrent(projectId(SCHOOL)),
      expect: (tr) => [
        tr('newExpense'),
        tr('amount'),
        tr('rs'),
        tr('category'),
        tr('cat_materials'),
        tr('cat_transport'),
        tr('cat_subcontract'),
        tr('receiptPhotos'),
        tr('takePhoto'),
        tr('fromGallery'),
        tr('date'),
        tr('today'),
        tr('yesterday'),
        tr('project'),
        SCHOOL,
        tr('paidTo'),
        tr('paidToHint'),
        tr('method'),
        tr('method_cash'),
        tr('method_bank'),
        tr('method_cheque'),
        tr('note'),
        tr('save'),
      ],
    },
    {
      name: 'new expense with no current project asks for one',
      expect: (tr) => [tr('chooseProject'), tr('newExpense')],
    },
    {
      name: 'edit shows the stored values',
      prepare: () => setRouteParams({ id: expenseId('Lanka Cement Depot, Welimada') }),
      expect: (tr) => [tr('editExpense'), '185000', 'Lanka Cement Depot, Welimada', '50 bags OPC cement', SCHOOL, tr('method_bank')],
      check: (tr) => expect(screen.getAllByLabelText(tr('delete'))).toHaveLength(1),
    },
    {
      name: 'edit an expense that has a cheque payment',
      prepare: () => setRouteParams({ id: expenseId('Uva Hardware') }),
      expect: (tr) => [tr('editExpense'), 'Uva Hardware'],
    },
    {
      name: 'an id that does not exist renders nothing',
      prepare: () => setRouteParams({ id: 'gone' }),
      blank: true,
    },
  ],
});

// ---------------------------------------------------------------- worker/form

smokeScreen('worker/form', () => <WorkerForm />, {
  db: 'demo',
  variants: [
    {
      name: 'new worker',
      expect: (tr) => [tr('newWorker'), tr('name'), tr('trade'), tr('tradeHint'), tr('phone'), tr('dailyRate'), tr('rs'), tr('save')],
      check: (tr) => expect(screen.queryAllByLabelText(tr('delete'))).toHaveLength(0),
    },
    {
      name: 'edit shows the stored values',
      prepare: () => setRouteParams({ id: workerId('Nimal Perera') }),
      expect: (tr) => [tr('editWorker'), 'Nimal Perera', 'Mason', '0771234567', '3500'],
      check: (tr) => expect(screen.getAllByLabelText(tr('delete'))).toHaveLength(1),
    },
    {
      name: 'edit a worker with no phone',
      prepare: () => setRouteParams({ id: workerId('Kamal Silva') }),
      expect: (tr) => ['Kamal Silva', 'Helper', '2200'],
    },
    {
      name: 'an id that does not exist renders nothing',
      prepare: () => setRouteParams({ id: 'gone' }),
      blank: true,
    },
  ],
});

// ---------------------------------------------------------------- worker/assign

smokeScreen('worker/assign', () => <AssignWorkerScreen />, {
  db: 'demo',
  setup: () => {
    // A project where every worker is already assigned: only "new worker" is possible.
    const full = saveProject({ name: 'Full House', status: 'active' });
    for (const name of ['Nimal Perera', 'Sunil Fernando', 'Kamal Silva', 'Ruwan Jayasinghe', 'Anura Kumara', 'Saman Kumara']) {
      assignWorker({ project_id: full, worker_id: workerId(name), rate_cents: 100_000 });
    }
  },
  variants: [
    {
      name: 'pick an existing worker for a project',
      prepare: () => setRouteParams({ projectId: projectId(SCHOOL) }),
      expect: (tr) => [tr('addWorkerToProject'), `${tr('project')}: ${SCHOOL}`, tr('existingWorker'), tr('newWorker'), tr('worker'), tr('rateOnThisProject'), tr('perProject'), tr('save')],
    },
    {
      name: 'uses the current project when none is passed',
      prepare: () => setCurrent(projectId(CULVERT)),
      expect: (tr) => [`${tr('project')}: ${CULVERT}`, tr('existingWorker')],
    },
    {
      name: 'everyone is already on the project: new worker only, with a note',
      prepare: () => setRouteParams({ projectId: projectId('Full House') }),
      expect: (tr) => [tr('noneAvailable'), tr('name'), tr('trade'), tr('phone'), tr('rateOnThisProject')],
    },
    {
      name: 'edit the rate of a worker already on the project',
      prepare: () => setRouteParams({ projectId: projectId(SCHOOL), workerId: workerId('Nimal Perera') }),
      expect: (tr) => ['Nimal Perera', 'Mason', '3500', tr('removeFromProject'), tr('rateOnThisProject')],
    },
    {
      name: 'no project chosen yet',
      expect: (tr) => [tr('noProjectSelected'), tr('chooseProjectFirstHint'), tr('chooseProject')],
    },
  ],
});

// ---------------------------------------------------------------- wage/form

smokeScreen('wage/form', () => <WageForm />, {
  db: 'demo',
  variants: [
    {
      name: 'record a work day: amount follows days x rate',
      prepare: () => setRouteParams({ workerId: workerId('Nimal Perera'), projectId: projectId(SCHOOL), kind: 'work' }),
      expect: (tr) => [
        tr('recordWork'),
        SCHOOL,
        'Nimal Perera',
        tr('days'),
        '½',
        '1½',
        `${tr('dailyRate')} Rs 3,500`,
        `1 × Rs 3,500`,
        '3500',
        tr('date'),
        tr('note'),
        tr('save'),
      ],
    },
    {
      name: 'give an advance',
      prepare: () => setRouteParams({ workerId: workerId('Kamal Silva'), projectId: projectId(SCHOOL), kind: 'advance' }),
      expect: (tr) => [tr('giveAdvance'), 'Kamal Silva', tr('amount')],
      absent: (tr) => [tr('days')],
    },
    {
      name: 'pay wages with the owed amount pre-filled',
      prepare: () => setRouteParams({ workerId: workerId('Nimal Perera'), projectId: projectId(SCHOOL), kind: 'payment', amount: '350000' }),
      expect: (tr) => [tr('payWages'), 'Nimal Perera', '3500'],
    },
    {
      name: 'edit a work entry',
      prepare: () => setRouteParams({ id: wageEntryId('Ruwan Jayasinghe', 'work') }),
      expect: (tr) => [tr('recordWork'), 'Ruwan Jayasinghe', SCHOOL, '1.5', '5400'],
      check: (tr) => expect(screen.getAllByLabelText(tr('delete'))).toHaveLength(1),
    },
    {
      name: 'edit a payment',
      prepare: () => setRouteParams({ id: wageEntryId('Nimal Perera', 'payment') }),
      expect: (tr) => [tr('payWages'), 'Weekly pay', '14000'],
    },
    {
      name: 'edit an advance',
      prepare: () => setRouteParams({ id: wageEntryId('Kamal Silva', 'advance') }),
      expect: (tr) => [tr('giveAdvance'), 'Advance for medicine', '5000'],
    },
    {
      name: 'opened with nothing chosen',
      prepare: () => setCurrent(projectId(SCHOOL)),
      expect: (tr) => [tr('recordWork'), tr('worker'), SCHOOL],
    },
    {
      name: 'an id that does not exist renders nothing',
      prepare: () => setRouteParams({ id: 'gone' }),
      blank: true,
    },
  ],
});

// ---------------------------------------------------------------- tool/form

smokeScreen('tool/form', () => <ToolForm />, {
  db: 'demo',
  variants: [
    {
      name: 'new tool',
      expect: (tr) => [tr('newTool'), tr('toolName'), tr('toolCode'), tr('photoProof'), tr('takePhoto'), tr('notes'), tr('save')],
      check: (tr) => expect(screen.queryAllByLabelText(tr('delete'))).toHaveLength(0),
    },
    {
      name: 'edit shows the stored values',
      prepare: () => setRouteParams({ id: toolId('Total station') }),
      expect: (tr) => [tr('editTool'), 'Total station', 'BM-T-004', 'Hand over only to the engineer'],
      check: (tr) => expect(screen.getAllByLabelText(tr('delete'))).toHaveLength(1),
    },
    {
      name: 'an id that does not exist renders nothing',
      prepare: () => setRouteParams({ id: 'gone' }),
      blank: true,
    },
  ],
});

// ---------------------------------------------------------------- tool/move

smokeScreen('tool/move', () => <ToolMove />, {
  db: 'demo',
  variants: [
    {
      name: 'issue a tool that is in the store, on the current project',
      prepare: () => {
        setCurrent(projectId(SCHOOL));
        setRouteParams({ toolId: toolId('Vibrator poker'), kind: 'issue' });
      },
      expect: (tr) => [tr('issueTool'), 'Vibrator poker · BM-T-003', SCHOOL, tr('takenBy'), tr('someoneElse'), tr('date'), tr('condition'), tr('conditionHint'), tr('photoProof'), tr('note'), tr('save')],
    },
    {
      name: 'issue with nothing chosen',
      prepare: () => setRouteParams({ kind: 'issue' }),
      expect: (tr) => [tr('issueTool'), tr('tool'), tr('project'), tr('save')],
    },
    {
      name: 'return a tool that is out: it follows the tool to its worker and project',
      prepare: () => setRouteParams({ toolId: toolId('Hilti drill'), kind: 'return' }),
      expect: (tr) => [tr('returnTool'), 'Hilti drill · BM-T-001', 'Sunil Fernando', SCHOOL, tr('optional')],
      absent: (tr) => [tr('someoneElse')],
    },
    {
      name: 'a past movement is shown read-only with its photos',
      prepare: () => setRouteParams({ id: movementId('Hilti drill') }),
      expect: (tr) => [tr('issue'), 'Hilti drill · BM-T-001', 'Sunil Fernando', SCHOOL, 'Good', tr('takenBy'), tr('condition'), tr('photoProof')],
      check: (tr) => expect(screen.getAllByLabelText(tr('delete'))).toHaveLength(1),
    },
    {
      name: 'a past return',
      prepare: () => setRouteParams({ id: movementId('Aluminium ladder 12 ft') }),
      expect: (tr) => [tr('return'), 'Kamal Silva', 'One rung loose'],
    },
    {
      name: 'an id that does not exist renders nothing',
      prepare: () => setRouteParams({ id: 'gone' }),
      blank: true,
    },
  ],
});

smokeScreen('tool/move (nothing to return)', () => <ToolMove />, {
  db: 'empty',
  setup: () => {
    saveTool({ name: 'Lonely Hammer', code: 'BM-T-777' });
  },
  variants: [
    {
      name: 'return when every tool is in the store',
      prepare: () => setRouteParams({ kind: 'return' }),
      expect: (tr) => [tr('returnTool'), tr('inStore')],
    },
  ],
});

// ---------------------------------------------------------------- note/form

smokeScreen('note/form', () => <NoteForm />, {
  db: 'demo',
  variants: [
    {
      name: 'new note on a given project',
      prepare: () => setRouteParams({ projectId: projectId(CULVERT) }),
      expect: (tr) => [tr('newNote'), tr('project'), CULVERT, tr('date'), tr('whatHappened'), tr('weather'), tr('weather_sunny'), tr('weather_cloudy'), tr('weather_rain'), tr('photoProof'), tr('save')],
    },
    {
      name: 'new note with no project given',
      expect: (tr) => [tr('newNote'), tr('chooseProject')],
    },
    {
      name: 'edit shows the stored text and weather',
      prepare: () => setRouteParams({ id: noteId('Rain after 3 pm') }),
      expect: (tr) => [tr('siteNotes'), 'Rain after 3 pm, work stopped for the day. Covered the cement bags.', SCHOOL, tr('weather_rain')],
      check: (tr) => expect(screen.getAllByLabelText(tr('delete'))).toHaveLength(1),
    },
    {
      name: 'an id that does not exist renders nothing',
      prepare: () => setRouteParams({ id: 'gone' }),
      blank: true,
    },
  ],
});

// ---------------------------------------------------------------- misc

describe('forms on a phone with nothing on it', () => {
  beforeAll(() => resetDb());
  it.each([
    ['project/form', () => <ProjectForm />],
    ['expense/form', () => <ExpenseForm />],
    ['worker/form', () => <WorkerForm />],
    ['wage/form', () => <WageForm />],
    ['tool/form', () => <ToolForm />],
    ['tool/move', () => <ToolMove />],
    ['note/form', () => <NoteForm />],
    ['worker/assign', () => <AssignWorkerScreen />],
  ] as const)('%s renders with no projects, workers or tools', async (name, ui) => {
    setSetting('lang', 'en');
    setSetting('theme', 'light');
    await renderScreen(ui());
    expectClean(name);
    expect(visibleText().length).toBeGreaterThan(5);
  });
});
