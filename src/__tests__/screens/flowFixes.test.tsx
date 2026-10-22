/**
 * Regression tests for UI-flow bugs found in review:
 *  - a double tap on Save saved twice and went back twice (hooks/form.ts),
 *  - a validation error was only shown under its field, which can be off screen (hooks/form.ts),
 *  - a worker who is not on the project's roster could not be paid from their own screen (wage/form.tsx),
 *  - Today's "worked / to pay today" counted people who are not on the roster (Today tab),
 *  - Recent activity listed movements of deleted tools (Today tab),
 *  - the quick-add "New worker" did not put the worker on the current project (add.tsx).
 * (The "backup after local midnight" fix is tested in timezone.test.tsx.)
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { router } from 'expo-router';
import { useEffect } from 'react';

import TodayScreen from '@/app/(tabs)/index';
import AddSheet from '@/app/add';
import NoteForm from '@/app/note/form';
import WageForm from '@/app/wage/form';
import { ToastHost } from '@/components/ui/feedback';
import { setSetting } from '@/db';
import { assignWorker, deleteRecord, moveTool, recordWorkDay, saveProject, saveTool, saveWageEntry, saveWorker, unassignWorker, ValidationError } from '@/db/repo';
import { useRecordForm } from '@/hooks/form';
import { today } from '@/lib/dates';
import { mockAlert, resetDb, seedDemo } from '@/test-utils';
import { buildCleanSite, CULVERT, projectId, rows, SCHOOL, setCurrent } from '@/test-utils/screenData';
import {
  act,
  expectClean,
  fireEvent,
  hasLabel,
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

// ---------------------------------------------------------------- useRecordForm

type Form = ReturnType<typeof useRecordForm>;

function Probe({ on }: { on: (form: Form) => void }) {
  const form = useRecordForm('tools');
  useEffect(() => {
    on(form);
  });
  return null;
}

/** Mounts the hook (with a toast host, so toasts can be read) and returns a getter for its latest value. */
async function mountForm(): Promise<() => Form> {
  let latest: Form | null = null;
  await renderScreen(
    <>
      <Probe
        on={(f) => {
          latest = f;
        }}
      />
      <ToastHost />
    </>,
  );
  return () => latest as unknown as Form;
}

describe('useRecordForm: Save cannot run twice', () => {
  it('a second submit while the first one is still going is ignored', async () => {
    const form = await mountForm();
    const fn = jest.fn();
    await act(async () => {
      form().submit(fn);
      form().submit(fn);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('a tap after the save worked is ignored too (the screen is closing)', async () => {
    const form = await mountForm();
    const fn = jest.fn();
    await act(async () => form().submit(fn));
    await act(async () => form().submit(fn));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('submitAsync ignores a second call while the first is waiting, and goes back once', async () => {
    const form = await mountForm();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fn = jest.fn(() => gate);
    await act(async () => {
      void form().submitAsync(fn);
      void form().submitAsync(fn);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
    await act(async () => {
      release();
      await gate;
    });
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('a failed save lets the next tap through (validation error, then any other error)', async () => {
    const alert = mockAlert();
    const form = await mountForm();
    const ok = jest.fn();

    await act(async () =>
      form().submit(() => {
        throw new ValidationError('name', 'errName');
      }),
    );
    expect(router.back).not.toHaveBeenCalled();
    await act(async () =>
      form().submit(() => {
        throw new Error('disk full');
      }),
    );
    expect(alert).toHaveBeenCalled(); // showError
    takeConsole(); // reportError logs in development
    expect(router.back).not.toHaveBeenCalled();

    await act(async () => form().submit(ok));
    expect(ok).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('submitAsync: a failure lets the next call through', async () => {
    const form = await mountForm();
    const ok = jest.fn(async () => undefined);
    await act(async () => {
      await form().submitAsync(async () => {
        throw new ValidationError('name', 'errName');
      });
    });
    expect(router.back).not.toHaveBeenCalled();
    await act(async () => {
      await form().submitAsync(ok);
    });
    expect(ok).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('on a real form a double tap on Save writes the note once and goes back once', async () => {
    const project = saveProject({ name: 'Alpha Site' });
    setRouteParams({ projectId: project });
    await renderScreen(<NoteForm />);
    await typeInto(E('whatHappened'), 'Slab poured at 9 am.');
    const save = screen.getAllByLabelText(E('save'), { exact: true })[0];
    await fireEvent.press(save);
    await fireEvent.press(save);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(rows('SELECT version FROM site_notes WHERE deleted_at IS NULL')).toEqual([{ version: 1 }]);
    expect(rows("SELECT 1 FROM audit_log WHERE table_name = 'site_notes'")).toHaveLength(1);
  });
});

describe('useRecordForm: every field error is also said in a toast', () => {
  it('a ValidationError shows its message in a toast, as well as under the field', async () => {
    const form = await mountForm();
    expect(visibleText()).not.toContain(E('errWorker'));
    await act(async () =>
      form().submit(() => {
        throw new ValidationError('worker_id', 'errWorker');
      }),
    );
    expect(visibleText()).toContain(E('errWorker')); // nothing else on this screen shows it: this is the toast
    expect(form().err('worker_id')).toBe(E('errWorker'));
    expectClean('validation toast');
  });

  it('on the wage form the message is under the field and in the toast', async () => {
    const project = saveProject({ name: 'Alpha Site' });
    setRouteParams({ projectId: project, kind: 'advance' });
    await renderScreen(
      <>
        <WageForm />
        <ToastHost />
      </>,
    );
    await pressLabel(E('save'));
    expect(screen.getAllByText(E('errWorker'))).toHaveLength(2);
    expect(router.back).not.toHaveBeenCalled();
  });

  it('a save that works shows "Saved on phone" once', async () => {
    const form = await mountForm();
    await act(async () => form().submit(() => undefined));
    expect(screen.getAllByText(E('savedOnPhone'))).toHaveLength(1);
  });
});

describe('useRecordForm: confirmDelete', () => {
  it('goes back one screen by default', async () => {
    const alert = mockAlert();
    const form = await mountForm();
    const fn = jest.fn();
    await act(async () => form().confirmDelete(fn));
    expect(fn).not.toHaveBeenCalled(); // nothing happens before the answer
    await pressAlertButton(alert, E('delete'));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.dismiss).not.toHaveBeenCalled();
  });

  it('closes a stack of screens when asked to', async () => {
    const alert = mockAlert();
    const form = await mountForm();
    const fn = jest.fn();
    await act(async () => form().confirmDelete(fn, 2));
    await pressAlertButton(alert, E('delete'));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(router.dismiss).toHaveBeenCalledWith(2);
    expect(router.back).not.toHaveBeenCalled();
  });

  it('a delete that fails stays on the screen', async () => {
    const alert = mockAlert();
    const form = await mountForm();
    await act(async () =>
      form().confirmDelete(() => {
        throw new Error('locked');
      }, 2),
    );
    await pressAlertButton(alert, E('delete'));
    takeConsole(); // reportError logs in development
    expect(router.back).not.toHaveBeenCalled();
    expect(router.dismiss).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- wage form: the worker it was opened for

function siteWithRoster() {
  const project = saveProject({ name: 'Alpha Site' });
  const asanka = saveWorker({ name: 'Asanka Perera', daily_rate_cents: 300_000 });
  assignWorker({ project_id: project, worker_id: asanka, rate_cents: 300_000 });
  return { project, asanka };
}

const payments = () =>
  rows<{ kind: string; worker_id: string; project_id: string; amount_cents: number; day: string }>(
    'SELECT kind, worker_id, project_id, amount_cents, day FROM wage_entries WHERE deleted_at IS NULL',
  );

/** Open a SelectField's sheet and choose the entry with this title (the sheet is drawn after the screen). */
async function choose(fieldLabel: string, current: string, title: string) {
  await pressLabel(`${fieldLabel}: ${current}`);
  await fireEvent.press(screen.getAllByText(title).at(-1)!);
}

describe('wage form: a worker who is not on the roster can still be paid', () => {
  const outsiders: [string, (project: string) => string][] = [
    ['on no project', () => saveWorker({ name: 'Nimal Outsider', daily_rate_cents: 200_000 })],
    [
      'taken off the project',
      (project) => {
        const id = saveWorker({ name: 'Nimal Outsider', daily_rate_cents: 200_000 });
        assignWorker({ project_id: project, worker_id: id, rate_cents: 200_000 });
        unassignWorker(project, id);
        return id;
      },
    ],
    ['who left', () => saveWorker({ name: 'Nimal Outsider', daily_rate_cents: 200_000, active: false })],
  ];

  it.each(outsiders)('pay a worker %s: they stay selected and the payment is saved', async (_name, make) => {
    const { project } = siteWithRoster(); // the project has a roster, which used to hide everyone else
    const worker = make(project);
    setRouteParams({ workerId: worker, projectId: project, kind: 'payment', amount: '150000' });
    await renderScreen(<WageForm />);
    expect(hasLabel(`${E('worker')}: Nimal Outsider`)).toBe(true);

    await pressLabel(E('save'));
    expect(visibleText()).not.toContain(E('errWorker'));
    expect(payments()).toEqual([{ kind: 'payment', worker_id: worker, project_id: project, amount_cents: 150_000, day: today() }]);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('works from the current project too, and records a work day at the worker\'s own rate', async () => {
    const { project } = siteWithRoster();
    const worker = saveWorker({ name: 'Nimal Outsider', daily_rate_cents: 200_000 });
    setCurrent(project);
    setRouteParams({ workerId: worker, kind: 'work' });
    await renderScreen(<WageForm />);
    expect(hasLabel(`${E('worker')}: Nimal Outsider`)).toBe(true);
    expect(visibleText()).toContain('2000'); // no roster row: the worker's usual rate
    await pressLabel(E('save'));
    expect(payments()).toEqual([{ kind: 'work', worker_id: worker, project_id: project, amount_cents: 200_000, day: today() }]);
  });

  it('the roster is still offered, and another worker can be chosen instead', async () => {
    const { project, asanka } = siteWithRoster();
    const worker = saveWorker({ name: 'Nimal Outsider', daily_rate_cents: 200_000 });
    setRouteParams({ workerId: worker, projectId: project, kind: 'payment', amount: '100000' });
    await renderScreen(<WageForm />);
    await choose(E('worker'), 'Nimal Outsider', 'Asanka Perera');
    expect(hasLabel(`${E('worker')}: Asanka Perera`)).toBe(true);
    // and back again: the worker the form was opened for stays on offer
    await choose(E('worker'), 'Asanka Perera', 'Nimal Outsider');
    expect(hasLabel(`${E('worker')}: Nimal Outsider`)).toBe(true);
    await choose(E('worker'), 'Nimal Outsider', 'Asanka Perera');
    await pressLabel(E('save'));
    expect(payments()).toMatchObject([{ worker_id: asanka, amount_cents: 100_000 }]);
  });

  it('a worker id that no longer exists is not offered (Save asks for a worker)', async () => {
    const { project } = siteWithRoster();
    setRouteParams({ workerId: 'gone', projectId: project, kind: 'advance' });
    await renderScreen(<WageForm />);
    expect(hasLabel(`${E('worker')}: ${E('worker')}`)).toBe(true);
    await pressLabel(E('save'));
    expect(visibleText()).toContain(E('errWorker'));
    expect(payments()).toEqual([]);
  });

  it('editing an entry of a worker who is on no project keeps that worker', async () => {
    const { project } = siteWithRoster();
    const worker = saveWorker({ name: 'Nimal Outsider', daily_rate_cents: 200_000 });
    const entry = saveWageEntry({ worker_id: worker, project_id: project, day: today(), kind: 'payment', amount_cents: 100_000 });
    setRouteParams({ id: entry });
    await renderScreen(<WageForm />);
    expect(hasLabel(`${E('worker')}: Nimal Outsider`)).toBe(true);
    await typeInto(E('amount'), '1,200');
    await pressLabel(E('save'));
    expect(rows('SELECT worker_id, project_id, amount_cents, version FROM wage_entries WHERE id = ?', [entry])).toEqual([
      { worker_id: worker, project_id: project, amount_cents: 120_000, version: 2 },
    ]);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('editing an entry of a worker taken off the project keeps that worker', async () => {
    const { project } = siteWithRoster();
    const worker = saveWorker({ name: 'Nimal Outsider', daily_rate_cents: 200_000 });
    assignWorker({ project_id: project, worker_id: worker, rate_cents: 200_000 });
    const entry = saveWageEntry({ worker_id: worker, project_id: project, day: today(), kind: 'advance', amount_cents: 50_000 });
    unassignWorker(project, worker);
    setRouteParams({ id: entry });
    await renderScreen(<WageForm />);
    expect(hasLabel(`${E('worker')}: Nimal Outsider`)).toBe(true);
    await pressLabel(E('save'));
    expect(rows('SELECT worker_id, version FROM wage_entries WHERE id = ?', [entry])).toEqual([{ worker_id: worker, version: 2 }]);
  });
});

// ---------------------------------------------------------------- Today tab

describe('Today tab: "worked" and "to pay today" count the roster only', () => {
  /** Asanka (on the roster) worked a day for Rs 3,000. Bimal worked a day and was then taken off the project. Chaminda was never on it. */
  function workedDay() {
    const site = buildCleanSite();
    const chaminda = saveWorker({ name: 'Chaminda Outsider', daily_rate_cents: 0 });
    recordWorkDay({ project_id: site.project, worker_id: site.asanka, day: today(), days: 1 });
    recordWorkDay({ project_id: site.project, worker_id: site.bimal, day: today(), days: 1 });
    unassignWorker(site.project, site.bimal);
    recordWorkDay({ project_id: site.project, worker_id: chaminda, day: today(), days: 2, amount_cents: 700_000 });
    return site;
  }

  it('with a project: only people on its roster are summed', async () => {
    const site = workedDay();
    setCurrent(site.project);
    await renderScreen(<TodayScreen />);
    expectClean('today roster');
    expect(visibleText()).toContain(`1 ${E('worked')} · ${E('toPayToday')} Rs 3,000`);
    expect(visibleText()).not.toContain('Rs 10,000');
  });

  it('a payment on the day lowers what is left to pay; people off the roster still do not count', async () => {
    const site = workedDay();
    saveWageEntry({ worker_id: site.asanka, project_id: site.project, day: today(), kind: 'payment', amount_cents: 100_000 });
    setCurrent(site.project);
    await renderScreen(<TodayScreen />);
    expect(visibleText()).toContain(`1 ${E('worked')} · ${E('toPayToday')} Rs 2,000`);
  });

  it('with All projects the work card is a chooser, not a sum', async () => {
    workedDay();
    await renderScreen(<TodayScreen />);
    expect(visibleText()).toContain(E('noProjectSelected'));
    expect(visibleText()).not.toMatch(/\d+ worked/);
  });
});

describe('Today tab: recent activity hides deleted tools and movements', () => {
  it('a movement of a deleted tool, and a deleted movement, are not listed', async () => {
    const site = buildCleanSite();
    const move = (tool: string) => moveTool({ tool_id: tool, kind: 'issue', project_id: site.project, worker_id: site.asanka, day: today() });
    const shown = saveTool({ name: 'Visible Drill', code: 'BM-T-801' });
    const deletedTool = saveTool({ name: 'Deleted Saw', code: 'BM-T-802' });
    const deletedMove = saveTool({ name: 'Voided Ladder', code: 'BM-T-803' });
    move(shown);
    move(deletedTool);
    const voided = move(deletedMove);
    deleteRecord('tools', deletedTool);
    deleteRecord('tool_movements', voided);
    setCurrent(site.project);
    await renderScreen(<TodayScreen />);
    expectClean('today recent tools');
    expect(visibleText()).toContain('Visible Drill');
    expect(visibleText()).not.toContain('Deleted Saw');
    expect(visibleText()).not.toContain('Voided Ladder');
  });

  it('the same with All projects', async () => {
    const site = buildCleanSite();
    const tool = saveTool({ name: 'Deleted Saw', code: 'BM-T-802' });
    moveTool({ tool_id: tool, kind: 'issue', project_id: site.project, worker_id: site.asanka, day: today() });
    deleteRecord('tools', tool);
    await renderScreen(<TodayScreen />);
    expect(visibleText()).not.toContain('Deleted Saw');
  });
});

// ---------------------------------------------------------------- quick-add sheet

describe('quick-add sheet: New worker', () => {
  it('with a project chosen it opens the assign screen for that project', async () => {
    seedDemo();
    setCurrent(projectId(SCHOOL));
    await renderScreen(<AddSheet />);
    await fireEvent.press(screen.getByText(E('newWorker')));
    expect(router.replace).toHaveBeenCalledWith(`/worker/assign?projectId=${projectId(SCHOOL)}`);
  });

  it('follows the current project when it changes', async () => {
    seedDemo();
    setCurrent(projectId(CULVERT));
    await renderScreen(<AddSheet />);
    await fireEvent.press(screen.getByText(E('newWorker')));
    expect(router.replace).toHaveBeenCalledWith(`/worker/assign?projectId=${projectId(CULVERT)}`);
  });

  it('with All projects it still opens the plain worker form', async () => {
    seedDemo();
    await renderScreen(<AddSheet />);
    await fireEvent.press(screen.getByText(E('newWorker')));
    expect(router.replace).toHaveBeenCalledWith('/worker/form');
  });

  it('the other choices are unchanged by the project', async () => {
    seedDemo();
    setCurrent(projectId(SCHOOL));
    await renderScreen(<AddSheet />);
    await fireEvent.press(screen.getByText(E('giveAdvance')));
    expect(router.replace).toHaveBeenLastCalledWith('/wage/form?kind=advance');
  });
});
