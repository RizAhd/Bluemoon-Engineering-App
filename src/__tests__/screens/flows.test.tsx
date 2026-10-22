/**
 * The most important flows on the forms, driven like a person would (type, tap, save) against the real
 * data layer: validation errors first, then a good save whose rows are checked in the database.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import ExpenseForm from '@/app/expense/form';
import NoteForm from '@/app/note/form';
import ProjectsScreen from '@/app/(tabs)/projects';
import ProjectForm from '@/app/project/form';
import ToolForm from '@/app/tool/form';
import ToolMove from '@/app/tool/move';
import WageForm from '@/app/wage/form';
import AssignWorkerScreen from '@/app/worker/assign';
import WorkerForm from '@/app/worker/form';
import { getSetting, setSetting } from '@/db';
import { assignWorker, saveProject, saveTool, saveWorker } from '@/db/repo';
import { today } from '@/lib/dates';
import { mockAlert, queuePhotos, resetDb, seedDemo, setCameraPermission } from '@/test-utils';
import {
  CULVERT,
  expenseId,
  projectId,
  rows,
  SCHOOL,
  setCurrent,
  toolId,
  workerId,
} from '@/test-utils/screenData';
import {
  act,
  expectClean,
  fireEvent,
  hasLabel,
  inputValue,
  makeTr,
  pressAlertButton,
  pressLabel,
  renderScreen,
  screen,
  setRouteParams,
  takeConsole,
  typeInto,
  visibleText,
} from '@/test-utils/screenKit';

const E = makeTr('en');

beforeEach(() => {
  resetDb();
  setSetting('lang', 'en');
  setSetting('theme', 'light');
});

/** Open a SelectField's sheet and choose the entry with this title (the sheet is drawn after the screen). */
async function choose(fieldLabel: string, current: string, title: string) {
  await pressLabel(`${fieldLabel}: ${current}`);
  await fireEvent.press(screen.getAllByText(title).at(-1)!);
}

// ---------------------------------------------------------------- expense form

describe('expense form: a validation error, then a good save', () => {
  it('asks for the project, then the amount, then saves what was typed', async () => {
    saveProject({ name: 'Alpha Site', location: 'Kandy' });
    saveProject({ name: 'Beta Site' });
    await renderScreen(<ExpenseForm />);
    expect(visibleText()).toContain(E('amount'));

    // nothing filled in: the first thing missing is the project
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errProject'));
    expect(router.back).not.toHaveBeenCalled();
    expect(rows('SELECT 1 FROM expenses')).toHaveLength(0);

    // choose it: its message goes, the next one (the amount) comes
    await choose(E('project'), E('chooseProject'), 'Alpha Site');
    expect(visibleText()).not.toContain(E('errProject'));
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errAmount'));
    expect(router.back).not.toHaveBeenCalled();

    // typing clears the amount message; a zero amount is refused too
    await typeInto(E('amount'), '0');
    expect(visibleText()).not.toContain(E('errAmount'));
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errAmount'));

    await typeInto(E('amount'), '1,250.50');
    await pressLabel(E('cat_fuel'));
    await pressLabel(E('method_bank'));
    await typeInto(E('paidTo'), 'Ceypetco Kandy');
    await typeInto(E('note'), 'Diesel for the mixer');
    await pressLabel(E('save'));

    expect(router.back).toHaveBeenCalledTimes(1);
    const saved = rows<{ amount_cents: number; category: string; method: string; paid_to: string; note: string; day: string; project_id: string; version: number }>(
      'SELECT amount_cents, category, method, paid_to, note, day, project_id, version FROM expenses WHERE deleted_at IS NULL',
    );
    expect(saved).toEqual([
      { amount_cents: 125_050, category: 'fuel', method: 'bank', paid_to: 'Ceypetco Kandy', note: 'Diesel for the mixer', day: today(), project_id: projectId('Alpha Site'), version: 1 },
    ]);
    expect(rows("SELECT 1 FROM audit_log WHERE table_name = 'expenses' AND action = 'insert'")).toHaveLength(1);
  });

  it('with a current project it is already chosen; the amount keypad strips letters; the date can be changed', async () => {
    const id = saveProject({ name: 'Alpha Site' });
    setCurrent(id);
    await renderScreen(<ExpenseForm />);
    expect(hasLabel(`${E('project')}: Alpha Site`)).toBe(true);
    await typeInto(E('amount'), 'Rs 12ab3');
    expect(inputValue(E('amount'))).toBe('123');

    await pressLabel(`${E('date')}: ${rowsDayLabel()}`);
    const picker = screen.container.queryAll((n) => n.type === 'DateTimePicker')[0];
    expect(picker).toBeDefined();
    await act(async () => picker.props.onValueChange({}, new Date(2026, 9, 1)));
    await pressLabel(E('save'));
    expect(rows<{ day: string }>('SELECT day FROM expenses')[0].day).toBe('2026-10-01');
  });

  it('editing keeps the record, bumps its version, and the header trash deletes it after asking', async () => {
    seedDemo();
    const id = expenseId('Lanka Cement Depot, Welimada');
    setRouteParams({ id });
    const alert = mockAlert();
    await renderScreen(<ExpenseForm />);
    expect(inputValue(E('amount'))).toBe('185,000');
    await typeInto(E('amount'), '190,000');
    await pressLabel(E('save'));
    expect(rows<{ amount_cents: number; version: number }>('SELECT amount_cents, version FROM expenses WHERE id = ?', [id])).toEqual([{ amount_cents: 19_000_000, version: 2 }]);

    await pressLabel(E('delete'));
    expect(alert.mock.calls.at(-1)?.[0]).toBe(E('confirmDelete'));
    expect(rows('SELECT 1 FROM expenses WHERE id = ? AND deleted_at IS NULL', [id])).toHaveLength(1); // not before the answer
    await pressAlertButton(alert, E('delete'));
    expect(rows('SELECT 1 FROM expenses WHERE id = ? AND deleted_at IS NOT NULL', [id])).toHaveLength(1);
    expect(router.back).toHaveBeenCalledTimes(2);
  });
});

function rowsDayLabel() {
  const [y, m, d] = today().split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}

// ---------------------------------------------------------------- project form

describe('project form', () => {
  it('needs a name; a bad contract value or date is refused before anything is written', async () => {
    await renderScreen(<ProjectForm />);
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errName'));
    expect(router.back).not.toHaveBeenCalled();

    await typeInto(E('projectName'), 'Matale Bridge');
    expect(visibleText()).not.toContain(E('errName'));

    await typeInto(E('contractValue'), '1.2.3');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errAmount'));
    expect(rows('SELECT 1 FROM projects')).toHaveLength(0);

    await typeInto(E('contractValue'), '2,500,000');
    await typeInto(E('startDate'), '2026-13-45');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errDate'));
    expect(rows('SELECT 1 FROM projects')).toHaveLength(0);

    await typeInto(E('startDate'), '2026-10-01');
    await typeInto(E('client'), 'RDA Matale');
    await pressLabel(E('status_on_hold'));
    await pressLabel(E('save'));

    const saved = rows<{ id: string; name: string; contract_cents: number; start_date: string; client: string; status: string }>(
      'SELECT id, name, contract_cents, start_date, client, status FROM projects WHERE deleted_at IS NULL',
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Matale Bridge', contract_cents: 250_000_000, start_date: '2026-10-01', client: 'RDA Matale', status: 'on_hold' });
    expect(getSetting('current_project')).toBe(saved[0].id); // a new project becomes the current one
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('delete from the form hides the project and everything recorded on it, and nothing else', async () => {
    seedDemo();
    const school = projectId(SCHOOL);
    const culvert = projectId(CULVERT);
    const before = {
      culvertExpenses: rows('SELECT 1 FROM expenses WHERE project_id = ? AND deleted_at IS NULL', [culvert]).length,
      culvertWages: rows('SELECT 1 FROM wage_entries WHERE project_id = ? AND deleted_at IS NULL', [culvert]).length,
      workers: rows('SELECT 1 FROM workers WHERE deleted_at IS NULL').length,
      tools: rows('SELECT 1 FROM tools WHERE deleted_at IS NULL').length,
    };
    const schoolHas = (table: string) => rows(`SELECT 1 FROM ${table} WHERE project_id = ? AND deleted_at IS NULL`, [school]).length;
    expect(schoolHas('expenses')).toBeGreaterThan(0);
    expect(schoolHas('wage_entries')).toBeGreaterThan(0);
    expect(schoolHas('site_notes')).toBe(2);
    expect(schoolHas('tool_movements')).toBe(4);
    expect(schoolHas('project_workers')).toBe(5);

    setRouteParams({ id: school });
    const alert = mockAlert();
    await renderScreen(<ProjectForm />);
    expect(inputValue(E('projectName'))).toBe(SCHOOL);

    await pressLabel(E('delete'));
    expect(alert.mock.calls.at(-1)?.[0]).toBe(E('confirmDelete'));
    expect(schoolHas('expenses')).toBeGreaterThan(0); // nothing happens before the answer
    await pressAlertButton(alert, E('delete'));

    expect(rows('SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL', [school])).toHaveLength(0);
    for (const table of ['expenses', 'wage_entries', 'site_notes', 'tool_movements', 'project_workers']) expect([table, schoolHas(table)]).toEqual([table, 0]);
    // history is kept: the rows are hidden, not erased
    expect(rows('SELECT 1 FROM expenses WHERE project_id = ?', [school]).length).toBeGreaterThan(0);
    expect(rows("SELECT 1 FROM audit_log WHERE table_name = 'projects' AND row_id = ? AND action = 'delete'", [school])).toHaveLength(1);
    // the other project, the workers and the tools are untouched
    expect(rows('SELECT 1 FROM expenses WHERE project_id = ? AND deleted_at IS NULL', [culvert])).toHaveLength(before.culvertExpenses);
    expect(rows('SELECT 1 FROM wage_entries WHERE project_id = ? AND deleted_at IS NULL', [culvert])).toHaveLength(before.culvertWages);
    expect(rows('SELECT 1 FROM workers WHERE deleted_at IS NULL')).toHaveLength(before.workers);
    expect(rows('SELECT 1 FROM tools WHERE deleted_at IS NULL')).toHaveLength(before.tools);
    // the form leaves two screens at once: the project's hub has nothing left to show
    expect(router.dismiss).toHaveBeenCalledWith(2);
    expect(router.back).not.toHaveBeenCalled();

    // the Projects tab no longer lists it, and the money totals dropped with it
    await screen.unmount();
    await renderScreen(<ProjectsScreen />);
    expectClean('projects after delete');
    expect(visibleText()).not.toContain(SCHOOL);
    expect(visibleText()).toContain(CULVERT);
    expect(visibleText()).toContain('Rs 86,400');
  });
});

// ---------------------------------------------------------------- worker/assign

describe('worker/assign: add a worker to a project', () => {
  it('creates a new worker with a rate and puts them on the project', async () => {
    const project = saveProject({ name: 'Alpha Site' });
    setRouteParams({ projectId: project });
    await renderScreen(<AssignWorkerScreen />);
    // nobody exists yet, so the form is "new worker"
    expect(hasLabel(E('name'))).toBe(true);
    expect(hasLabel(E('trade'))).toBe(true);

    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('rateRequired'));
    expect(router.back).not.toHaveBeenCalled();

    await typeInto(E('rateOnThisProject'), '3,200');
    expect(visibleText()).not.toContain(E('rateRequired'));
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errName'));
    expect(rows('SELECT 1 FROM workers')).toHaveLength(0);

    await typeInto(E('name'), 'Chaminda Rajapaksa');
    await typeInto(E('trade'), 'Welder');
    await typeInto(E('phone'), '0771112222');
    await pressLabel(E('save'));

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(rows('SELECT name, trade, phone, daily_rate_cents, active FROM workers WHERE deleted_at IS NULL')).toEqual([
      { name: 'Chaminda Rajapaksa', trade: 'Welder', phone: '0771112222', daily_rate_cents: 320_000, active: 1 },
    ]);
    const link = rows<{ project_id: string; rate_cents: number }>('SELECT project_id, rate_cents FROM project_workers WHERE deleted_at IS NULL');
    expect(link).toEqual([{ project_id: project, rate_cents: 320_000 }]);
    // he now shows up on the project's roster with the right rate
    expect(rows('SELECT name, rate_cents FROM v_project_worker_balance WHERE project_id = ?', [project])).toEqual([{ name: 'Chaminda Rajapaksa', rate_cents: 320_000 }]);
  });

  it('adds an existing worker at a different rate than their default, and refuses someone already on it', async () => {
    seedDemo();
    const school = projectId(SCHOOL);
    setRouteParams({ projectId: school });
    await renderScreen(<AssignWorkerScreen />);

    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('rateRequired'));

    // choose a worker who is already on the project: refused, nothing is chosen
    await choose(E('worker'), E('worker'), 'Nimal Perera');
    expect(inputValue(E('rateOnThisProject'))).toBe('');

    // choose Saman: his usual rate is filled in, and can be changed for this project
    await choose(E('worker'), E('worker'), 'Saman Kumara');
    expect(hasLabel(`${E('worker')}: Saman Kumara`)).toBe(true);
    expect(inputValue(E('rateOnThisProject'))).toBe('3,500');
    await typeInto(E('rateOnThisProject'), '3,800');
    await pressLabel(E('save'));

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(rows('SELECT rate_cents FROM project_workers WHERE project_id = ? AND worker_id = ? AND deleted_at IS NULL', [school, workerId('Saman Kumara')])).toEqual([
      { rate_cents: 380_000 },
    ]);
    // his default rate (what he asks on other sites) did not change
    expect(rows('SELECT daily_rate_cents FROM workers WHERE id = ?', [workerId('Saman Kumara')])).toEqual([{ daily_rate_cents: 350_000 }]);
  });

  it('refuses a rate with no worker chosen, and switches to a new worker on request', async () => {
    seedDemo();
    setRouteParams({ projectId: projectId(SCHOOL) });
    await renderScreen(<AssignWorkerScreen />);
    await typeInto(E('rateOnThisProject'), '2,500');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errWorker'));
    expect(router.back).not.toHaveBeenCalled();

    await pressLabel(E('newWorker'));
    expect(hasLabel(E('name'))).toBe(true);
    await typeInto(E('name'), 'Lakmal');
    await pressLabel(E('save'));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(rows('SELECT daily_rate_cents FROM workers WHERE name = ?', ['Lakmal'])).toEqual([{ daily_rate_cents: 250_000 }]);
  });

  it('changes a rate on the project, and removing the worker keeps their records', async () => {
    seedDemo();
    const school = projectId(SCHOOL);
    const nimal = workerId('Nimal Perera');
    setRouteParams({ projectId: school, workerId: nimal });
    const alert = mockAlert();
    await renderScreen(<AssignWorkerScreen />);
    expect(inputValue(E('rateOnThisProject'))).toBe('3,500');
    await typeInto(E('rateOnThisProject'), '3,700');
    await pressLabel(E('save'));
    expect(rows('SELECT rate_cents FROM project_workers WHERE project_id = ? AND worker_id = ? AND deleted_at IS NULL', [school, nimal])).toEqual([{ rate_cents: 370_000 }]);
    expect(router.back).toHaveBeenCalledTimes(1);

    await pressLabel(E('removeFromProject'));
    expect(alert.mock.calls.at(-1)?.[0]).toBe(E('removeFromProject'));
    await pressAlertButton(alert, E('removeFromProject'));
    expect(rows('SELECT 1 FROM project_workers WHERE project_id = ? AND worker_id = ? AND deleted_at IS NULL', [school, nimal])).toHaveLength(0);
    // his work and payments on the project are still there
    expect(rows("SELECT 1 FROM wage_entries WHERE worker_id = ? AND project_id = ? AND kind = 'work' AND deleted_at IS NULL", [nimal, school]).length).toBe(5);
    expect(router.back).toHaveBeenCalledTimes(2);
  });

  it('with no project chosen it asks for one first', async () => {
    seedDemo();
    await renderScreen(<AssignWorkerScreen />);
    expect(visibleText()).toContain(E('noProjectSelected'));
    await pressLabel(E('chooseProject'));
    await fireEvent.press(screen.getAllByText(CULVERT).at(-1)!);
    expect(getSetting('current_project')).toBe(projectId(CULVERT));
    expect(visibleText()).toContain(`${E('project')}: ${CULVERT}`);
    expect(hasLabel(E('rateOnThisProject'))).toBe(true);
  });
});

// ---------------------------------------------------------------- worker form

describe('worker form', () => {
  it('needs a name and a valid rate, saves, and can delete the worker', async () => {
    await renderScreen(<WorkerForm />);
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errName'));
    await typeInto(E('name'), 'Priyantha');
    await typeInto(E('dailyRate'), '1.2.3');
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errAmount'));
    expect(rows('SELECT 1 FROM workers')).toHaveLength(0);

    await typeInto(E('dailyRate'), '2,750');
    await typeInto(E('trade'), 'Carpenter');
    await pressLabel(E('save'));
    expect(rows('SELECT name, trade, daily_rate_cents, active FROM workers WHERE deleted_at IS NULL')).toEqual([
      { name: 'Priyantha', trade: 'Carpenter', daily_rate_cents: 275_000, active: 1 },
    ]);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('editing a worker keeps them active, and the trash deletes after asking', async () => {
    seedDemo();
    const id = workerId('Kamal Silva');
    setRouteParams({ id });
    const alert = mockAlert();
    await renderScreen(<WorkerForm />);
    await typeInto(E('trade'), 'Senior helper');
    await pressLabel(E('save'));
    expect(rows('SELECT trade, active, version FROM workers WHERE id = ?', [id])).toEqual([{ trade: 'Senior helper', active: 1, version: 2 }]);
    await pressLabel(E('delete'));
    await pressAlertButton(alert, E('delete'));
    expect(rows('SELECT 1 FROM workers WHERE id = ? AND deleted_at IS NOT NULL', [id])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- wage form

describe('wage form', () => {
  it('records a work day: the amount follows the days and the rate until it is typed over', async () => {
    const project = saveProject({ name: 'Alpha Site' });
    const asanka = saveWorker({ name: 'Asanka Perera', daily_rate_cents: 300_000 });
    assignWorker({ project_id: project, worker_id: asanka, rate_cents: 300_000 });
    setRouteParams({ projectId: project, kind: 'work' });
    await renderScreen(<WageForm />);

    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errWorker'));
    expect(router.back).not.toHaveBeenCalled();

    await choose(E('worker'), E('worker'), 'Asanka Perera');
    expect(inputValue(E('amount'))).toBe('3,000');
    await pressLabel(E('oneAndHalf'));
    expect(inputValue(E('amount'))).toBe('4,500');
    expect(visibleText()).toContain('1.5 × Rs 3,000');

    await pressLabel(E('save'));
    expect(rows('SELECT kind, days, amount_cents, worker_id, project_id, day FROM wage_entries WHERE deleted_at IS NULL')).toEqual([
      { kind: 'work', days: 1.5, amount_cents: 450_000, worker_id: asanka, project_id: project, day: today() },
    ]);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('gives an advance and pays wages from the worker screen\'s shortcuts', async () => {
    const project = saveProject({ name: 'Alpha Site' });
    const asanka = saveWorker({ name: 'Asanka Perera', daily_rate_cents: 300_000 });
    assignWorker({ project_id: project, worker_id: asanka, rate_cents: 300_000 });
    setRouteParams({ workerId: asanka, projectId: project, kind: 'advance' });
    await renderScreen(<WageForm />);
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errAmount'));
    await typeInto(E('amount'), '1,000');
    await typeInto(E('note'), 'Bus fare');
    await pressLabel(E('save'));
    expect(rows('SELECT kind, amount_cents, note FROM wage_entries WHERE deleted_at IS NULL')).toEqual([{ kind: 'advance', amount_cents: 100_000, note: 'Bus fare' }]);
    expect(rows('SELECT balance_cents FROM v_worker_balance WHERE worker_id = ?', [asanka])).toEqual([{ balance_cents: -100_000 }]);
  });
});

// ---------------------------------------------------------------- tools

describe('tool form and issue / return', () => {
  it('adds a tool, issues it to a worker on a project, then returns it', async () => {
    // add
    await renderScreen(<ToolForm />);
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errName'));
    await typeInto(E('toolName'), 'Crowbar');
    await typeInto(E('toolCode'), 'BM-T-900');
    await pressLabel(E('save'));
    const tool = rows<{ id: string }>("SELECT id FROM tools WHERE name = 'Crowbar' AND deleted_at IS NULL");
    expect(tool).toHaveLength(1);
    await screen.unmount();

    // issue
    const project = saveProject({ name: 'Alpha Site' });
    const worker = saveWorker({ name: 'Asanka Perera', daily_rate_cents: 300_000 });
    assignWorker({ project_id: project, worker_id: worker, rate_cents: 300_000 });
    setCurrent(project);
    setRouteParams({ toolId: tool[0].id, kind: 'issue' });
    await renderScreen(<ToolMove />);
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errWorker')); // somebody has to be responsible for it
    expect(rows('SELECT 1 FROM tool_movements')).toHaveLength(0);
    await choose(E('takenBy'), E('worker'), 'Asanka Perera');
    await typeInto(E('condition'), 'Good');
    await pressLabel(E('save'));
    expect(rows('SELECT kind, worker_id, project_id, condition FROM tool_movements WHERE deleted_at IS NULL')).toEqual([
      { kind: 'issue', worker_id: worker, project_id: project, condition: 'Good' },
    ]);
    expect(rows('SELECT is_out FROM v_tool_status WHERE tool_id = ?', [tool[0].id])).toEqual([{ is_out: 1 }]);
    await screen.unmount();

    // return
    setRouteParams({ toolId: tool[0].id, kind: 'return' });
    await renderScreen(<ToolMove />);
    expect(hasLabel(`${E('takenBy')}: Asanka Perera`)).toBe(true); // it follows the tool to whoever has it
    await typeInto(E('condition'), 'One rung bent');
    await pressLabel(E('save'));
    expect(rows('SELECT is_out FROM v_tool_status WHERE tool_id = ?', [tool[0].id])).toEqual([{ is_out: 0 }]);
    expect(rows('SELECT kind FROM tool_movements WHERE deleted_at IS NULL ORDER BY created_at').map((r) => (r as { kind: string }).kind)).toEqual(['issue', 'return']);
  });

  it('issuing to someone who is not on the worker list works with a name typed in', async () => {
    const project = saveProject({ name: 'Alpha Site' });
    const tool = saveTool({ name: 'Hammer' });
    setCurrent(project);
    setRouteParams({ toolId: tool, kind: 'issue' });
    await renderScreen(<ToolMove />);
    await typeInto(E('someoneElse'), 'Neighbour Nimal');
    await pressLabel(E('save'));
    expect(rows('SELECT taken_by, worker_id FROM tool_movements')).toEqual([{ taken_by: 'Neighbour Nimal', worker_id: null }]);
  });

  it('the tool form edits a tool and deletes it after asking', async () => {
    seedDemo();
    const id = toolId('Total station');
    setRouteParams({ id });
    const alert = mockAlert();
    await renderScreen(<ToolForm />);
    expect(inputValue(E('toolName'))).toBe('Total station');
    await typeInto(E('toolCode'), 'bm-t-004b');
    await pressLabel(E('save'));
    expect(rows('SELECT code FROM tools WHERE id = ?', [id])).toEqual([{ code: 'bm-t-004b' }]);
    await pressLabel(E('delete'));
    await pressAlertButton(alert, E('delete'));
    expect(rows('SELECT 1 FROM tools WHERE id = ? AND deleted_at IS NOT NULL', [id])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- site note

describe('note form', () => {
  it('needs the text of the note, then saves it with its weather', async () => {
    const project = saveProject({ name: 'Alpha Site' });
    setRouteParams({ projectId: project });
    await renderScreen(<NoteForm />);
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errNote'));
    expect(router.back).not.toHaveBeenCalled();
    await typeInto(E('whatHappened'), 'Slab poured at 9 am.');
    expect(visibleText()).not.toContain(E('errNote'));
    await pressLabel(E('weather_rain'));
    await pressLabel(E('save'));
    expect(rows('SELECT project_id, body, weather, day FROM site_notes WHERE deleted_at IS NULL')).toEqual([
      { project_id: project, body: 'Slab poured at 9 am.', weather: 'rain', day: today() },
    ]);
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------- nothing leaks

describe('the flows log nothing unexpected', () => {
  it('a normal save logs no console output', async () => {
    saveProject({ name: 'Alpha Site' });
    await renderScreen(<WorkerForm />);
    await typeInto(E('name'), 'Quiet Worker');
    await pressLabel(E('save'));
    expect(takeConsole()).toEqual([]);
  });
});

// ---------------------------------------------------------------- receipt photos on the expense form

describe('expense form: receipt photos', () => {
  afterEach(() => setCameraPermission(true)); // the next test gets a camera that works

  const photos = (owner: string) => rows<{ deleted_at: string | null }>("SELECT deleted_at FROM attachments WHERE owner_table = 'expenses' AND owner_id = ?", [owner]);

  it('photos taken before saving belong to the expense once it is saved', async () => {
    const project = saveProject({ name: 'Alpha Site' });
    setCurrent(project);
    queuePhotos(2);
    await renderScreen(<ExpenseForm />);
    await pressLabel(E('takePhoto'));
    await waitFor(() => expect(screen.queryAllByLabelText(new RegExp(`^${E('receiptPhotos')} [12]$`))).toHaveLength(2));
    expectClean('expense form with photos');
    await typeInto(E('amount'), '4,000');
    await pressLabel(E('save'));
    const expense = rows<{ id: string }>('SELECT id FROM expenses WHERE deleted_at IS NULL')[0].id;
    expect(photos(expense).filter((p) => p.deleted_at === null)).toHaveLength(2);
  });

  it('leaving the form without saving hides the photos taken for it', async () => {
    const project = saveProject({ name: 'Alpha Site' });
    setCurrent(project);
    queuePhotos(1);
    await renderScreen(<ExpenseForm />);
    await pressLabel(E('takePhoto'));
    await waitFor(() => expect(rows("SELECT 1 FROM attachments WHERE owner_table = 'expenses' AND deleted_at IS NULL")).toHaveLength(1));
    await screen.unmount();
    expect(rows("SELECT 1 FROM attachments WHERE owner_table = 'expenses' AND deleted_at IS NULL")).toHaveLength(0);
  });

  it('with the camera refused it explains and offers the gallery instead', async () => {
    const project = saveProject({ name: 'Alpha Site' });
    setCurrent(project);
    setCameraPermission(false);
    const alert = mockAlert();
    await renderScreen(<ExpenseForm />);
    await pressLabel(E('takePhoto'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls.at(-1)?.[0]).toBe(E('errorTitle'));
    expect(alert.mock.calls.at(-1)?.[1]).toBe(E('cameraOff'));
    expect((alert.mock.calls.at(-1)?.[2] as { text: string }[]).map((b) => b.text)).toEqual([E('cancel'), E('fromGallery'), E('settings')]);
    queuePhotos(1);
    await pressAlertButton(alert, E('fromGallery'));
    await waitFor(() => expect(rows("SELECT 1 FROM attachments WHERE owner_table = 'expenses' AND deleted_at IS NULL")).toHaveLength(1));
    takeConsole(); // the refused camera is logged in development
  });
});
