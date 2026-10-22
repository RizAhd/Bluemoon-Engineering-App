/**
 * wage/today ("Today's work & pay") is the busiest screen on a site: render smoke tests for its
 * situations, then the real flow (tick a worker, pick days, set a pay amount, Save) against the database.
 *
 * How the screen works (and what these tests pin down): ticking a worker, picking the days and
 * changing a wage are written to the database at once; "Pay now" is never pre-filled; money only
 * moves after an Alert that lists each name and amount is confirmed.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import TodaysWorkScreen from '@/app/wage/today';
import { ToastHost } from '@/components/ui/feedback';
import { setSetting } from '@/db';
import { assignWorker, payWages, recordWorkDay, saveWorker } from '@/db/repo';
import { addDays, today } from '@/lib/dates';
import { mockAlert, resetDb, seedDemo } from '@/test-utils';
import { buildCleanSite, CULVERT, DRAIN, projectId, rows, SCHOOL, setCurrent, workerId } from '@/test-utils/screenData';
import {
  expectClean,
  fireEvent,
  inputValue,
  pressAlertButton,
  pressLabel,
  renderScreen,
  screen,
  setRouteParams,
  smokeScreen,
  takeConsole,
  typeInto,
  visibleText,
} from '@/test-utils/screenKit';

const yesterday = () => addDays(today(), -1);

// ---------------------------------------------------------------- render matrix

smokeScreen("wage/today (Today's work & pay)", () => <TodaysWorkScreen />, {
  db: 'demo',
  setup: () => {
    // A worker on the school with no rate yet: the row must ask for one instead of showing Rs 0 a day.
    const rateless = saveWorker({ name: 'Rateless Ravi', trade: 'Painter', daily_rate_cents: 0 });
    assignWorker({ project_id: projectId(SCHOOL), worker_id: rateless, rate_cents: 0 });
  },
  variants: [
    {
      name: 'project whose day already has entries',
      prepare: () => setCurrent(projectId(SCHOOL)),
      expect: (tr) => [
        tr('todaysWork'),
        tr('project'),
        SCHOOL,
        tr('date'),
        tr('dayAlreadyRecorded'),
        tr('markAllWorked'),
        'Nimal Perera',
        'Ruwan Jayasinghe',
        'Mason · Rs 3,500 / ' + tr('day'),
        tr('days'),
        '½',
        '1½',
        tr('amount'),
        tr('payNow'),
        'Rs 3,500', // Nimal: one day
        'Rs 5,400', // Ruwan: 1.5 days
        /^3,500$/m, // Nimal's amount box
        `${tr('toPayToday')} Rs 3,500`, // hint under Nimal's empty pay box
        tr('workersToday'),
        tr('wages'),
        'Rs 17,100',
        tr('wagesPaidToday'),
        `${tr('payAll')} · Rs 17,100`,
        tr('saveSheet'),
        tr('addWorkerToProject'),
        tr('notWorked'), // Rateless Ravi is not ticked
        tr('rateRequired'),
      ],
    },
    {
      name: 'narrow phone (320 wide)',
      width: 320,
      langs: ['en', 'si'],
      prepare: () => setCurrent(projectId(SCHOOL)),
      expect: (tr) => ['Nimal Perera', tr('saveSheet'), tr('wagesPaidToday')],
    },
    {
      name: 'tablet (768 wide)',
      width: 768,
      langs: ['en', 'ta'],
      prepare: () => setCurrent(projectId(SCHOOL)),
      expect: (tr) => ['Nimal Perera', tr('saveSheet'), 'Rs 17,100'],
    },
    {
      name: 'project, a day with no entries yet',
      prepare: () => {
        setCurrent(projectId(SCHOOL));
        setRouteParams({ day: addDays(today(), -30) });
      },
      expect: (tr) => [tr('todaysWork'), 'Nimal Perera', 'Anura Kumara', tr('notWorked'), tr('saveSheet'), tr('markAllWorked')],
      absent: (tr) => [tr('dayAlreadyRecorded')],
    },
    {
      name: 'an earlier day with work and wages already paid',
      prepare: () => {
        setCurrent(projectId(SCHOOL));
        setRouteParams({ day: yesterday() });
      },
      expect: (tr) => [tr('dayAlreadyRecorded'), 'Nimal Perera', tr('paid'), `${tr('paidToday')} · Rs 14,000`],
    },
    {
      name: 'second project with one worker paid and one not worked',
      prepare: () => setCurrent(projectId(CULVERT)),
      expect: (tr) => ['Saman Kumara', 'Kamal Silva', tr('paid'), tr('notWorked'), 'Rs 2,300 / ' + tr('day')],
    },
    {
      name: 'no project chosen',
      expect: (tr) => [tr('todaysWork'), tr('project'), tr('chooseProject'), tr('noProjectSelected'), tr('chooseProjectFirstHint')],
      absent: (tr) => [tr('saveSheet')],
    },
    {
      name: 'project with nobody assigned',
      prepare: () => setCurrent(projectId(DRAIN)),
      expect: (tr) => [tr('noWorkersOnProject'), tr('noWorkersOnProjectHint'), tr('addWorkerToProject'), tr('saveSheet')],
      absent: (tr) => [tr('markAllWorked')],
    },
    {
      name: 'a future day falls back to today',
      prepare: () => {
        setCurrent(projectId(SCHOOL));
        setRouteParams({ day: addDays(today(), 5) });
      },
      expect: (tr) => [tr('dayAlreadyRecorded'), 'Rs 17,100'],
    },
  ],
});

// ---------------------------------------------------------------- the real flow

const workRows = () =>
  rows<{ days: number; amount_cents: number; worker_id: string; project_id: string; day: string }>(
    "SELECT days, amount_cents, worker_id, project_id, day FROM wage_entries WHERE kind = 'work' AND deleted_at IS NULL ORDER BY created_at",
  );
const payRows = () =>
  rows<{ amount_cents: number; worker_id: string; day: string }>(
    "SELECT amount_cents, worker_id, day FROM wage_entries WHERE kind = 'payment' AND deleted_at IS NULL ORDER BY created_at",
  );

describe('wage/today: tick a worker, pick days, pay, save', () => {
  beforeEach(() => {
    resetDb();
    setSetting('lang', 'en');
    setSetting('theme', 'light');
  });

  it('records the day as it is ticked, then pays the typed amount after a confirmation', async () => {
    const site = buildCleanSite();
    setCurrent(site.project);
    const alert = mockAlert();
    await renderScreen(<TodaysWorkScreen />);
    expectClean('clean site');

    // nobody has worked yet
    expect(screen.queryAllByLabelText('Amount')).toHaveLength(0);
    expect(visibleText()).not.toContain('Already recorded');

    // tick Asanka: one full day at his rate is written at once
    await fireEvent.press(screen.getByLabelText('Asanka Perera'));
    await waitFor(() => expect(workRows()).toHaveLength(1));
    expect(workRows()[0]).toMatchObject({ days: 1, amount_cents: 300_000, worker_id: site.asanka, project_id: site.project, day: today() });
    expect(inputValue('Amount')).toBe('3,000');
    expect(inputValue('Pay now')).toBe(''); // money is never pre-filled
    expect(visibleText()).toContain('To pay today Rs 3,000');

    // pick 1.5 days: the wage follows the rate
    await pressLabel('1½ days');
    await waitFor(() => expect(workRows()[0].days).toBe(1.5));
    expect(workRows()).toHaveLength(1); // the same entry, not a second one
    expect(workRows()[0].amount_cents).toBe(450_000);
    expect(inputValue('Amount')).toBe('4,500');

    // pay only part of it
    await typeInto('Pay now', '2,000');
    expect(inputValue('Pay now')).toBe('2,000');
    expect(visibleText()).toContain('Rs 4,500'); // wages
    expect(payRows()).toHaveLength(0); // typing does not pay

    await pressLabel('Save today');
    expect(alert.mock.calls.at(-1)?.[0]).toBe('Pay now');
    expect(alert.mock.calls.at(-1)?.[1]).toBe('Asanka Perera — Rs 2,000');
    expect(payRows()).toHaveLength(0); // still nothing paid: waiting for the confirmation
    await pressAlertButton(alert, 'Pay now · Rs 2,000');
    await waitFor(() => expect(router.back).toHaveBeenCalled());

    expect(payRows()).toEqual([{ amount_cents: 200_000, worker_id: site.asanka, day: today() }]);
    // Bimal was not ticked: nothing recorded for him
    expect(rows('SELECT 1 FROM wage_entries WHERE worker_id = ? AND deleted_at IS NULL', [site.bimal])).toHaveLength(0);
  });

  it('cancelling the confirmation pays nothing and stays on the sheet', async () => {
    const site = buildCleanSite();
    setCurrent(site.project);
    const alert = mockAlert();
    await renderScreen(<TodaysWorkScreen />);
    await fireEvent.press(screen.getByLabelText('Bimal Silva'));
    await typeInto('Pay now', '1000');
    await pressLabel('Save today');
    expect(alert).toHaveBeenCalledTimes(1);
    expect(payRows()).toHaveLength(0);
    expect(router.back).not.toHaveBeenCalled();
  });

  it('reopening a day shows what was recorded; "Pay all" settles what is still owed after confirming', async () => {
    const site = buildCleanSite();
    recordWorkDay({ project_id: site.project, worker_id: site.asanka, day: today(), days: 1 });
    payWages({ project_id: site.project, worker_id: site.asanka, day: today(), amount_cents: 100_000 });
    setCurrent(site.project);
    const alert = mockAlert();
    await renderScreen(<TodaysWorkScreen />);
    expectClean('reopened');
    expect(visibleText()).toContain('Already recorded for this day');
    expect(inputValue('Amount')).toBe('3,000');
    expect(inputValue('Pay now')).toBe('');
    expect(visibleText()).toContain('Paid today Rs 1,000');
    expect(visibleText()).toContain('To pay today Rs 2,000');

    await pressLabel('Pay all · Rs 2,000');
    expect(alert.mock.calls.at(-1)?.[0]).toBe('Pay all');
    await pressAlertButton(alert, 'Pay all · Rs 2,000');
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(payRows().map((r) => r.amount_cents)).toEqual([100_000, 200_000]);
    expect(workRows()).toHaveLength(1);
  });

  it('"All worked today" ticks everyone; "Pay all" lists each name and amount, then pays them', async () => {
    const site = buildCleanSite();
    setCurrent(site.project);
    const alert = mockAlert();
    await renderScreen(<TodaysWorkScreen />);
    await pressLabel('All worked today');
    await waitFor(() => expect(workRows()).toHaveLength(2));
    expect(screen.getAllByLabelText('Amount')).toHaveLength(2);
    expect(inputValue('Amount', 0)).toBe('3,000');
    expect(inputValue('Amount', 1)).toBe('2,500');

    await pressLabel('Pay all · Rs 5,500');
    const shown = alert.mock.calls.at(-1);
    expect(shown?.[0]).toBe('Pay all');
    expect(shown?.[1]).toBe('Asanka Perera — Rs 3,000\nBimal Silva — Rs 2,500');
    await pressAlertButton(alert, 'Pay all · Rs 5,500');
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(payRows().map((r) => r.amount_cents)).toEqual([300_000, 250_000]);
  });

  it('Save today with nothing typed to pay just leaves, without asking', async () => {
    const site = buildCleanSite();
    setCurrent(site.project);
    const alert = mockAlert();
    await renderScreen(<TodaysWorkScreen />);
    await fireEvent.press(screen.getByLabelText('Asanka Perera'));
    await waitFor(() => expect(workRows()).toHaveLength(1));
    await pressLabel('Save today');
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(alert).not.toHaveBeenCalled();
    expect(payRows()).toHaveLength(0);
    expect(workRows()).toHaveLength(1);
  });

  it('a blank wage is refused with a message and the recorded wage is untouched', async () => {
    const site = buildCleanSite();
    setCurrent(site.project);
    await renderScreen(<TodaysWorkScreen />);
    await fireEvent.press(screen.getByLabelText('Bimal Silva'));
    await waitFor(() => expect(workRows()).toHaveLength(1));
    await typeInto('Amount', '');
    await fireEvent(screen.getAllByLabelText('Amount')[0], 'blur');
    expect(visibleText()).toContain('Enter an amount');
    await pressLabel('Save today');
    expect(router.back).not.toHaveBeenCalled();
    expect(workRows()[0].amount_cents).toBe(250_000);
    // typing again clears the message and a changed wage is saved when the field is left
    await typeInto('Amount', '2,800');
    expect(visibleText()).not.toContain('Enter an amount');
    await fireEvent(screen.getAllByLabelText('Amount')[0], 'blur');
    await waitFor(() => expect(workRows()[0].amount_cents).toBe(280_000));
  });

  it('paying more than the wage shows a warning on the pay box', async () => {
    const site = buildCleanSite();
    setCurrent(site.project);
    await renderScreen(<TodaysWorkScreen />);
    await fireEvent.press(screen.getByLabelText('Bimal Silva'));
    await typeInto('Pay now', '9000');
    expect(visibleText()).toContain("You are paying more than today's wage");
    expectClean('overpay');
  });

  it('a worker without a rate sends you to set the rate instead of ticking', async () => {
    const site = buildCleanSite();
    const nobody = saveWorker({ name: 'No Rate Nuwan', daily_rate_cents: 0 });
    assignWorker({ project_id: site.project, worker_id: nobody, rate_cents: 0 });
    setCurrent(site.project);
    await renderScreen(<TodaysWorkScreen />);
    expect(visibleText()).toContain('Enter the daily rate');
    await fireEvent.press(screen.getByLabelText('No Rate Nuwan'));
    expect(router.push).toHaveBeenCalledWith(`/worker/assign?projectId=${site.project}&workerId=${nobody}`);
    expect(workRows()).toHaveLength(0);
  });

  it('unticking a worker who was already paid asks first; confirming removes the work but keeps the payment', async () => {
    seedDemo();
    setCurrent(projectId(SCHOOL));
    setRouteParams({ day: yesterday() });
    const alert = mockAlert();
    await renderScreen(<TodaysWorkScreen />);
    await fireEvent.press(screen.getByLabelText('Nimal Perera'));
    expect(alert.mock.calls.at(-1)?.[0]).toBe('Delete this record?');
    const nimal = workerId('Nimal Perera');
    const kinds = () =>
      rows<{ kind: string }>('SELECT kind FROM wage_entries WHERE worker_id = ? AND day = ? AND deleted_at IS NULL ORDER BY kind', [nimal, yesterday()]).map(
        (r) => r.kind,
      );
    expect(kinds()).toEqual(['payment', 'work']); // nothing removed before the answer
    await pressAlertButton(alert, 'Delete');
    await waitFor(() => expect(kinds()).toEqual(['payment'])); // the work is gone, the money given stays
    expect(visibleText()).toContain('Not today');
    expect(visibleText()).toContain('Paid today Rs 14,000');
  });

  it('unticking a worker with no payment is immediate', async () => {
    const site = buildCleanSite();
    recordWorkDay({ project_id: site.project, worker_id: site.bimal, day: today(), days: 1 });
    setCurrent(site.project);
    const alert = mockAlert();
    await renderScreen(<TodaysWorkScreen />);
    await fireEvent.press(screen.getByLabelText('Bimal Silva'));
    expect(alert).not.toHaveBeenCalled();
    await waitFor(() => expect(workRows()).toHaveLength(0));
  });

  it('unticking offers Undo, which puts back the same days and wage', async () => {
    const site = buildCleanSite();
    recordWorkDay({ project_id: site.project, worker_id: site.asanka, day: today(), days: 1.5, amount_cents: 480_000 }); // a wage typed over the rate
    setCurrent(site.project);
    await renderScreen(
      <>
        <TodaysWorkScreen />
        <ToastHost />
      </>,
    );
    await fireEvent.press(screen.getByLabelText('Asanka Perera'));
    await waitFor(() => expect(workRows()).toHaveLength(0));
    expect(visibleText()).toContain('Deleted');
    await pressLabel('Undo');
    await waitFor(() => expect(workRows()).toHaveLength(1));
    expect(workRows()[0]).toMatchObject({ days: 1.5, amount_cents: 480_000 });
    expect(inputValue('Amount')).toBe('4,800');
  });

  it('the project picker switches the sheet to another project', async () => {
    seedDemo();
    setCurrent(projectId(SCHOOL));
    await renderScreen(<TodaysWorkScreen />);
    expect(visibleText()).toContain('Nimal Perera');
    await pressLabel(`Project: ${SCHOOL}`);
    await fireEvent.press(screen.getAllByText(CULVERT).at(-1)!);
    expect(visibleText()).toContain('Saman Kumara');
    expect(visibleText()).not.toContain('Nimal Perera');
    expectClean('switched project');
  });

  it('opening the screen logs nothing to the console', async () => {
    seedDemo();
    setCurrent(projectId(SCHOOL));
    await renderScreen(<TodaysWorkScreen />);
    expect(takeConsole()).toEqual([]);
  });
});
