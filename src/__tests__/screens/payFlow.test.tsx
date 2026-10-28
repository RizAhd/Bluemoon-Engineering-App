/**
 * Paying workers with fewer steps: the work form's Pay now box (one Save for the days and the payment, one
 * confirmation naming the worker and the amount), the Pay button on a worker's balance, and the owed amount on the
 * day sheet that fills Pay now with one tap.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { router } from 'expo-router';

import TodaysWorkScreen from '@/app/wage/today';
import WageForm from '@/app/wage/form';
import WorkerDetail from '@/app/worker/[id]';
import { ToastHost } from '@/components/ui/feedback';
import { setSetting } from '@/db';
import { assignWorker, payWages, recordWorkDay, saveProject, saveWorker } from '@/db/repo';
import { today } from '@/lib/dates';
import { mockAlert, resetDb } from '@/test-utils';
import { buildCleanSite, rows, setCurrent } from '@/test-utils/screenData';
import { fireEvent, hasLabel, inputValue, lastAlert, makeTr, pressAlertButton, pressLabel, renderScreen, screen, setRouteParams, typeInto, visibleText } from '@/test-utils/screenKit';

const E = makeTr('en');

beforeEach(() => {
  resetDb();
  setSetting('lang', 'en');
  setSetting('theme', 'light');
  setCurrent(null);
});

const wage = (kind: string) => rows(`SELECT amount_cents, days FROM wage_entries WHERE kind = '${kind}' AND deleted_at IS NULL ORDER BY created_at`);

function oneWorker() {
  const project = saveProject({ name: 'Alpha Site' });
  const asanka = saveWorker({ name: 'Asanka Perera', daily_rate_cents: 300_000 });
  assignWorker({ project_id: project, worker_id: asanka, rate_cents: 300_000 });
  return { project, asanka };
}

describe('work form: the days and the payment in one save', () => {
  it('tapping the owed amount fills Pay now; Save asks once, with the name and amount, and then records both', async () => {
    const { project, asanka } = oneWorker();
    setRouteParams({ projectId: project, workerId: asanka, kind: 'work' });
    const alert = mockAlert();
    await renderScreen(<WageForm />);
    expect(inputValue(E('payNow'))).toBe(''); // never pre-filled
    await pressLabel(`${E('weOwe')} Rs 3,000`); // the hint is a button
    expect(inputValue(E('payNow'))).toBe('3,000');
    await typeInto(E('payNow'), '2,000');

    await pressLabel(E('save'));
    expect(alert).toHaveBeenCalledTimes(1);
    const { title, message, buttons } = lastAlert(alert);
    expect(title).toBe(E('payNow'));
    expect(message).toBe('Asanka Perera — Rs 2,000');
    expect(buttons.map((b) => b.text)).toEqual([E('cancel'), `${E('payNow')} · Rs 2,000`]);
    expect(wage('work')).toHaveLength(0); // nothing saved before the confirm

    await pressAlertButton(alert, `${E('payNow')} · Rs 2,000`);
    expect(wage('work')).toEqual([{ amount_cents: 300_000, days: 1 }]);
    expect(wage('payment')).toEqual([{ amount_cents: 200_000, days: null }]);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('cancelling the confirmation saves nothing and stays on the form', async () => {
    const { project, asanka } = oneWorker();
    setRouteParams({ projectId: project, workerId: asanka, kind: 'work' });
    const alert = mockAlert();
    await renderScreen(<WageForm />);
    await typeInto(E('payNow'), '1,000');
    await pressLabel(E('save'));
    await pressAlertButton(alert, E('cancel'));
    expect(wage('work')).toHaveLength(0);
    expect(wage('payment')).toHaveLength(0);
    expect(router.back).not.toHaveBeenCalled();
  });

  it('with Pay now left empty it just saves the work, with no dialog (as before)', async () => {
    const { project, asanka } = oneWorker();
    setRouteParams({ projectId: project, workerId: asanka, kind: 'work' });
    const alert = mockAlert();
    await renderScreen(<WageForm />);
    await pressLabel(E('save'));
    expect(alert).not.toHaveBeenCalled();
    expect(wage('work')).toHaveLength(1);
    expect(wage('payment')).toHaveLength(0);
  });

  it('a missing worker is reported at once, before any money dialog', async () => {
    const { project } = oneWorker();
    setRouteParams({ projectId: project, kind: 'work' });
    const alert = mockAlert();
    await renderScreen(<WageForm />);
    await typeInto(E('payNow'), '1,000');
    await pressLabel(E('save'));
    expect(alert).not.toHaveBeenCalled();
    expect(visibleText()).toContain(E('errWorker'));
    expect(wage('payment')).toHaveLength(0);
  });

  it('paying more than is owed shows the warning and does not offer the tap-to-fill', async () => {
    const { project, asanka } = oneWorker();
    setRouteParams({ projectId: project, workerId: asanka, kind: 'work' });
    await renderScreen(<WageForm />);
    await typeInto(E('payNow'), '9,000');
    expect(visibleText()).toContain(E('payMore'));
    expect(hasLabel(`${E('weOwe')} Rs 3,000`)).toBe(false);
  });

  it('only a new work entry has the box: payments, advances and edits do not', async () => {
    const { project, asanka } = oneWorker();
    setRouteParams({ projectId: project, workerId: asanka, kind: 'payment' });
    await renderScreen(<WageForm />);
    expect(hasLabel(E('payNow'))).toBe(false);
  });
});

describe('the Pay button on a worker\'s balance', () => {
  it('shows what is owed on the project, asks once, and pays exactly that', async () => {
    const { project, asanka } = buildCleanSite();
    recordWorkDay({ project_id: project, worker_id: asanka, day: today(), days: 2 }); // Rs 6,000
    setCurrent(project);
    setRouteParams({ id: asanka });
    const alert = mockAlert();
    await renderScreen(
      <>
        <WorkerDetail />
        <ToastHost />
      </>,
    );
    await pressLabel(E('payAmount', { amount: 'Rs 6,000' }));
    const { title, message } = lastAlert(alert);
    expect(title).toBe(E('payNow'));
    expect(message).toBe('Asanka Perera · Clean Site — Rs 6,000');
    expect(wage('payment')).toHaveLength(0);
    await pressAlertButton(alert, `${E('payNow')} · Rs 6,000`);
    expect(wage('payment')).toEqual([{ amount_cents: 600_000, days: null }]);
    // settled: the button is gone
    expect(hasLabel(E('payAmount', { amount: 'Rs 6,000' }))).toBe(false);
  });

  it('is not there when nothing is owed', async () => {
    const { project, asanka } = buildCleanSite();
    recordWorkDay({ project_id: project, worker_id: asanka, day: today(), days: 1 });
    payWages({ project_id: project, worker_id: asanka, day: today(), amount_cents: 300_000 });
    setCurrent(project);
    setRouteParams({ id: asanka });
    await renderScreen(<WorkerDetail />);
    expect(screen.queryByText(/^Pay Rs/)).toBeNull();
    expect(hasLabel(E('payNow'))).toBe(false);
  });

  it('owed on two projects and none chosen: asks which project, then confirms that one', async () => {
    const a = saveProject({ name: 'Alpha Site' });
    const b = saveProject({ name: 'Beta Site' });
    const w = saveWorker({ name: 'Asanka Perera', daily_rate_cents: 300_000 });
    assignWorker({ project_id: a, worker_id: w, rate_cents: 300_000 });
    assignWorker({ project_id: b, worker_id: w, rate_cents: 300_000 });
    recordWorkDay({ project_id: a, worker_id: w, day: today(), days: 1 });
    recordWorkDay({ project_id: b, worker_id: w, day: today(), days: 2 });
    setCurrent(null);
    setRouteParams({ id: w });
    const alert = mockAlert();
    await renderScreen(<WorkerDetail />);
    await pressLabel(E('payNow')); // no single project to pay: the project is asked first
    expect(visibleText()).toContain('Rs 3,000');
    expect(visibleText()).toContain('Rs 6,000');
    await fireEvent.press(screen.getAllByText('Beta Site').at(-1)!);
    expect(lastAlert(alert).message).toBe('Asanka Perera · Beta Site — Rs 6,000');
    await pressAlertButton(alert, `${E('payNow')} · Rs 6,000`);
    expect(rows(`SELECT project_id, amount_cents FROM wage_entries WHERE kind = 'payment' AND deleted_at IS NULL`)).toEqual([{ project_id: b, amount_cents: 600_000 }]);
  });
});

describe('the day sheet: the owed amount fills Pay now', () => {
  it('one tap on "Unpaid for today\'s work" puts the amount in the box; typing is still possible', async () => {
    const site = buildCleanSite();
    recordWorkDay({ project_id: site.project, worker_id: site.asanka, day: today(), days: 1 });
    setCurrent(site.project);
    await renderScreen(<TodaysWorkScreen />);
    expect(inputValue(E('payNow'))).toBe('');
    await pressLabel(`${E('toPayToday')} Rs 3,000`);
    expect(inputValue(E('payNow'))).toBe('3,000');
    // filled, the hint is gone: it cannot be tapped again over a typed amount
    expect(hasLabel(`${E('toPayToday')} Rs 3,000`)).toBe(false);
  });
});
