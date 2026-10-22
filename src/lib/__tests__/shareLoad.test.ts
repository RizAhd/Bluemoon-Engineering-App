/**
 * The loaders against the real SQL: demo-like data made through the repo functions, the numbers
 * compared with what the views report, deleted rows left out, missing ids answered with null, and a
 * second phone's data merged in. The messages themselves are tested in shareText.test.ts.
 */
import { all, first, mergeRow, newId, setSetting } from '@/db';
import { applyStandardSchedule, deleteEstimate, removeEstimateItem, removeEstimatePayment, saveEstimate, saveEstimateItem, saveEstimatePayment } from '@/db/estimates';
import { assignWorker, deleteRecord, moveTool, payWages, recordWorkDay, saveExpense, saveNote, saveProject, saveTool, saveWageEntry, saveWorker, unassignWorker } from '@/db/repo';
import { DATA_TABLES } from '@/db/schema';
import type { EstimateTotal, ProjectCost, ProjectWorkerBalance, WageDay, WorkerBalance } from '@/db/types';
import type { Lang } from '@/i18n';
import { saveCompanyProfile } from '@/lib/company';
import { addDays, today } from '@/lib/dates';
import { allocatePayments } from '@/lib/estimate';
import { formatLKR, parseCents } from '@/lib/money';
import { SHARE_LABELS } from '@/lib/shareLabels';
import {
  buildShareMessage,
  loadDaySheetShare,
  loadEstimateShare,
  loadExpensesShare,
  loadNoteShare,
  loadProjectShare,
  loadToolsOutShare,
  loadWorkerStatementShare,
  SHARE_KINDS,
} from '@/lib/shareLoad';
import { daySheetMessage, estimateMessage, expensesMessage, noteMessage, projectMessage, SHARE_LIMITS, toolsOutMessage, workerStatementMessage } from '@/lib/shareText';
import { mainPhone, openSecondPhone, resetDb, seedDemo, transfer, type Phone } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(120_000);

const TODAY = '2026-10-22';
const d = (n: number) => addDays(TODAY, -n);
const SCHOOL = 'Welimada Primary School Building';
const CULVERT = 'Badulla Culvert Repair';
const FOOTER = 'Developed with Bluemoon Site · 22 Oct 2026';
const lines = (...l: string[]) => l.join('\n');

let clock: ReturnType<typeof useClock>;
let b: Phone;
beforeAll(() => {
  b = openSecondPhone();
});
afterAll(() => b.dispose());
beforeEach(() => {
  resetDb();
  b.resetDb();
  clock = useClock(new Date(2026, 9, 22, 12, 0, 0));
});
afterEach(() => clock.restore());

const idOf = (table: 'projects' | 'workers' | 'tools', name: string) => first<{ id: string }>(`SELECT id FROM ${table} WHERE name LIKE ?`, [`${name}%`])?.id as string;
const noteId = (start: string) => first<{ id: string }>('SELECT id FROM site_notes WHERE body LIKE ?', [`${start}%`])?.id as string;
const expenseId = (paidTo: string) => first<{ id: string }>('SELECT id FROM expenses WHERE paid_to = ?', [paidTo])?.id as string;
/** Every "Rs 1,234.50" in a text, as cents, in the order they are printed. */
const amountsIn = (text: string) => (text.match(/Rs [\d,]+(?:\.\d{2})?/g) ?? []).map((a) => parseCents(a) as number);

// ================================================================ missing and deleted

describe('what is missing or deleted gives null', () => {
  it('every loader, and the wrapper for every kind, answers null for an id that does not exist', () => {
    expect(loadProjectShare('nope')).toBeNull();
    expect(loadEstimateShare('nope')).toBeNull();
    expect(loadDaySheetShare('nope', TODAY)).toBeNull();
    expect(loadWorkerStatementShare('nope')).toBeNull();
    expect(loadWorkerStatementShare('nope', 'also-nope')).toBeNull();
    expect(loadExpensesShare('nope')).toBeNull();
    expect(loadToolsOutShare('nope')).toBeNull();
    expect(loadNoteShare('nope')).toBeNull();
    for (const kind of SHARE_KINDS) expect({ kind, message: buildShareMessage(kind, 'nope', 'en') }).toEqual({ kind, message: null });
    // and for no id at all, where an id is needed
    for (const kind of ['project', 'estimate', 'daySheet', 'workerStatement', 'note'] as const) expect(buildShareMessage(kind, null, 'en')).toBeNull();
  });

  it('"all projects" needs no id and works on an empty phone', () => {
    expect(buildShareMessage('expenses', null, 'en')).toBe(lines('*Expenses — All projects*', 'Total: Rs 0', '', 'No expenses yet', '', FOOTER));
    expect(buildShareMessage('toolsOut', null, 'en')).toBe(lines('*Tools out — All projects*', 'No tools are out right now', '', FOOTER));
  });

  it('a day that is not a day gives null, however real the project', () => {
    const p = saveProject({ name: 'P' });
    for (const day of ['', 'today', '2026-02-30', '22-10-2026', '2026-10-2']) expect({ day, found: loadDaySheetShare(p, day) }).toEqual({ day, found: null });
    expect(loadDaySheetShare(p, TODAY)).not.toBeNull();
  });

  it('a deleted project takes its messages with it: project, day sheet, expenses, tools, notes, and a statement for it', () => {
    seedDemo();
    const school = idOf('projects', 'Welimada');
    const nimal = idOf('workers', 'Nimal');
    const note = noteId('First-floor');
    expect(loadProjectShare(school)).not.toBeNull();
    deleteRecord('projects', school);
    expect(loadProjectShare(school)).toBeNull();
    expect(loadDaySheetShare(school, d(1))).toBeNull();
    expect(loadExpensesShare(school)).toBeNull();
    expect(loadToolsOutShare(school)).toBeNull();
    expect(loadNoteShare(note)).toBeNull();
    expect(loadWorkerStatementShare(nimal, school)).toBeNull();
    // the worker himself, and the other project, are still there
    expect(loadWorkerStatementShare(nimal)).not.toBeNull();
    expect(loadProjectShare(idOf('projects', 'Badulla'))).not.toBeNull();
  });

  it('a deleted note, worker and estimate give null', () => {
    seedDemo();
    const note = noteId('Rain after');
    deleteRecord('site_notes', note);
    expect(loadNoteShare(note)).toBeNull();
    const kamal = idOf('workers', 'Kamal');
    deleteRecord('workers', kamal);
    expect(loadWorkerStatementShare(kamal)).toBeNull();
    const est = first<{ id: string }>("SELECT id FROM estimates WHERE title = 'Boundary wall, Welimada'")?.id as string;
    expect(loadEstimateShare(est)).not.toBeNull();
    deleteEstimate(est);
    expect(loadEstimateShare(est)).toBeNull();
    expect(buildShareMessage('estimate', est, 'en')).toBeNull();
  });
});

// ================================================================ the project

describe('the project message', () => {
  beforeEach(() => seedDemo());

  it('carries exactly the figures of the views, worked out by hand from the demo data', () => {
    const school = idOf('projects', 'Welimada');
    const data = loadProjectShare(school);
    if (!data) throw new Error('project missing');
    const view = first<ProjectCost>('SELECT * FROM v_project_cost WHERE project_id = ?', [school]);
    expect(data.cost).toEqual(view);
    // expenses 495,550; labour 17,500 + 17,100 + 8,800 + 16,200 + 2,200 = 61,800, of which 29,000 was given
    expect(data.cost).toMatchObject({ expense_cents: 49_555_000, labour_cents: 6_180_000, labour_paid_cents: 2_900_000 });
    expect(data.project).toMatchObject({ name: SCHOOL, client: 'Zonal Education Office, Welimada', location: 'Welimada', status: 'active', contract_cents: 1_850_000_000 });
    expect(data.categories).toEqual([
      { category: 'materials', cents: 28_140_000 },
      { category: 'subcontract', cents: 12_000_000 },
      { category: 'machinery', cents: 4_200_000 },
      { category: 'transport', cents: 1_850_000 },
      { category: 'fuel', cents: 1_200_000 },
      { category: 'utilities', cents: 965_000 },
      { category: 'tools', cents: 780_000 },
      { category: 'food', cents: 420_000 },
    ]);
    expect(data.categories.reduce((s, c) => s + c.cents, 0)).toBe(data.cost.expense_cents);
    expect(data.workerCount).toBe(5);
    expect(data.toolsOutCount).toBe(2); // the drill and the mixer; the ladder came back
    expect(data.noteCount).toBe(2);
    expect(data.notes.map((n) => n.day)).toEqual([d(0), d(1)]);
    expect(data.today).toBe(TODAY);
  });

  it('is the exact message for the school', () => {
    expect(buildShareMessage('project', idOf('projects', 'Welimada'), 'en')).toBe(
      lines(
        `*${SCHOOL}*`,
        'Client: Zonal Education Office, Welimada',
        'Location: Welimada',
        'Status: Active',
        '',
        'Contract value: Rs 18,500,000',
        'Total cost: Rs 557,350',
        'Expenses: Rs 495,550',
        'Labour (earned): Rs 61,800',
        'Labour paid: Rs 29,000',
        'Contract used: 3%',
        'Left in contract: Rs 17,942,650',
        '',
        'By category',
        'Materials: Rs 281,400',
        'Sub-contract: Rs 120,000',
        'Machine hire: Rs 42,000',
        'Transport: Rs 18,500',
        'Fuel: Rs 12,000',
        '… and 3 more',
        '',
        'Workers: 5',
        'Tools out: 2',
        '',
        'Latest notes',
        `${'22 Oct 2026'} — First-floor slab shuttering completed on the east side. Waiting for the bar-bending inspection before pouring.`,
        '21 Oct 2026 — Rain after 3 pm, work stopped for the day. Covered the cement bags.',
        '',
        FOOTER,
      ),
    );
  });

  it('is the exact message for the culvert: nothing out, one note, three categories, two workers', () => {
    expect(buildShareMessage('project', idOf('projects', 'Badulla'), 'en')).toBe(
      lines(
        `*${CULVERT}*`,
        'Client: RDA Badulla',
        'Location: Badulla',
        'Status: Active',
        '',
        'Contract value: Rs 4,200,000',
        'Total cost: Rs 86,400',
        'Expenses: Rs 75,900',
        'Labour (earned): Rs 10,500',
        'Labour paid: Rs 3,500',
        'Contract used: 2%',
        'Left in contract: Rs 4,113,600',
        '',
        'By category',
        'Materials: Rs 64,300',
        'Transport: Rs 8,500',
        'Food & tea: Rs 3,100',
        '',
        'Workers: 2',
        '',
        'Latest notes',
        '22 Oct 2026 — Old pipes removed. RDA engineer visited and approved the new levels.',
        '',
        FOOTER,
      ),
    );
  });

  it('a finished project with nothing booked: zero cost, no lists', () => {
    expect(buildShareMessage('project', idOf('projects', 'Bandarawela'), 'en')).toBe(
      lines(
        '*Bandarawela Drain Renovation*',
        'Client: Bandarawela UC',
        'Location: Bandarawela',
        'Status: Completed',
        '',
        'Contract value: Rs 2,750,000',
        'Total cost: Rs 0',
        'Expenses: Rs 0',
        'Labour (earned): Rs 0',
        'Labour paid: Rs 0',
        'Contract used: 0%',
        'Left in contract: Rs 2,750,000',
        '',
        'Workers: 0',
        '',
        FOOTER,
      ),
    );
  });

  it('follows the data: a worker who left, one taken off the project, a returned tool, a deleted note and a deleted expense', () => {
    const school = idOf('projects', 'Welimada');
    const count = () => loadProjectShare(school);
    expect(count()?.workerCount).toBe(5);

    // "Mark as left" changes the worker, not the assignment
    saveWorker({ id: idOf('workers', 'Nimal'), name: 'Nimal Perera', daily_rate_cents: 350_000, active: false });
    expect(count()?.workerCount).toBe(4);
    unassignWorker(school, idOf('workers', 'Ruwan'));
    expect(count()?.workerCount).toBe(3);
    // the wages of the worker who left and of the one taken off still count in the cost of the project
    expect(count()?.cost.labour_cents).toBe(6_180_000);

    expect(count()?.toolsOutCount).toBe(2);
    moveTool({ tool_id: idOf('tools', 'Hilti'), kind: 'return', project_id: school, worker_id: idOf('workers', 'Sunil'), day: d(0) });
    expect(count()?.toolsOutCount).toBe(1);
    deleteRecord('tools', idOf('tools', 'Concrete mixer'));
    expect(count()?.toolsOutCount).toBe(0);

    deleteRecord('site_notes', noteId('Rain after'));
    expect(count()?.noteCount).toBe(1);
    expect(count()?.notes.map((n) => n.body.slice(0, 11))).toEqual(['First-floor']);

    const before = count();
    deleteRecord('expenses', expenseId('Lanka Cement Depot, Welimada'));
    const after = count();
    expect(after?.cost.expense_cents).toBe((before?.cost.expense_cents ?? 0) - 18_500_000);
    expect(after?.categories[0]).toEqual({ category: 'subcontract', cents: 12_000_000 }); // materials fell to 96,400
    expect(after?.categories.find((c) => c.category === 'materials')?.cents).toBe(9_640_000);
    expect(after?.cost).toEqual(first<ProjectCost>('SELECT * FROM v_project_cost WHERE project_id = ?', [school]));
  });

  it('a worker assigned twice (two phones assigned him before they met) is one worker', () => {
    const school = idOf('projects', 'Welimada');
    const sunil = idOf('workers', 'Sunil');
    for (const stamp of ['2099-01-01T00:00:00.000Z', '2099-02-01T00:00:00.000Z']) {
      mergeRow('project_workers', { id: newId(), created_at: stamp, updated_at: stamp, deleted_at: null, version: 1, device_id: 'phone-b', project_id: school, worker_id: sunil, rate_cents: 400_000, active: 1 });
    }
    expect(all('SELECT id FROM project_workers WHERE project_id = ? AND worker_id = ? AND deleted_at IS NULL', [school, sunil])).toHaveLength(3);
    expect(loadProjectShare(school)?.workerCount).toBe(5);
  });

  it('is told in the language it is asked for, with the same figures', () => {
    const school = idOf('projects', 'Welimada');
    const en = buildShareMessage('project', school, 'en') as string;
    for (const lang of ['si', 'ta'] as const) {
      const text = buildShareMessage('project', school, lang) as string;
      expect(text).toContain(SHARE_LABELS[lang].totalCost);
      expect(text).not.toContain('Total cost');
      expect(amountsIn(text)).toEqual(amountsIn(en));
    }
  });
});

// ================================================================ the estimate

describe('the estimate message', () => {
  /** The three lines of the round-trip test: awkward quantities and rates, so the sums have to round. */
  function makeEstimate(over: { tax_bp?: number; discount_cents?: number; schedule?: boolean; terms?: string } = {}) {
    const id = saveEstimate({
      client_name: 'Mr. K. A. Perera',
      client_phone: '071 234 5678',
      title: 'Boundary wall and gate',
      location: 'Welimada',
      issue_day: TODAY,
      valid_days: 30,
      tax_bp: over.tax_bp ?? 0,
    });
    saveEstimateItem({ estimate_id: id, description: 'Excavation', unit: 'm³', qty_milli: 12_500, rate_cents: 1_250_050 });
    saveEstimateItem({ estimate_id: id, description: 'Brick masonry wall', unit: 'm²', qty_milli: 48_250, rate_cents: 2_345_675 });
    saveEstimateItem({ estimate_id: id, description: 'Steel gate', unit: 'nos', qty_milli: 1000, rate_cents: 18_500_000 });
    if (over.discount_cents) saveEstimate({ id, discount_cents: over.discount_cents });
    if (over.schedule !== false) applyStandardSchedule(id);
    return id;
  }
  const totalOf = (id: string) => first<EstimateTotal>('SELECT * FROM v_estimate_total WHERE estimate_id = ?', [id]) as EstimateTotal;

  beforeEach(() => saveCompanyProfile({ name: 'Bluemoon Engineering (Pvt) Ltd', phone: '011 222 3333' }));

  it('prints the numbers of v_estimate_total, to the cent, and the stages add up to the total', () => {
    const id = makeEstimate({ tax_bp: 1800, discount_cents: 500_000 });
    const t = totalOf(id);
    const text = buildShareMessage('estimate', id, 'en') as string;
    expect(text).toContain(`Items: ${t.item_count}\n`);
    expect(text).toContain(`Subtotal: ${formatLKR(t.subtotal_cents)}\n`);
    expect(text).toContain(`Discount: -${formatLKR(t.discount_cents)}\n`);
    expect(text).toContain(`Tax (18%): ${formatLKR(t.tax_cents)}\n`);
    expect(text).toContain(`*TOTAL: ${formatLKR(t.total_cents)}*\n`);
    expect(t.item_count).toBe(3);
    // subtotal 12.5 x 12,500.50 + 48.25 x 23,456.75 + 1 x 185,000 = 156,256.25 + 1,131,775.... (rounded line by line)
    expect(t.discount_cents).toBe(500_000);
    expect(t.total_cents).toBe(t.subtotal_cents - t.discount_cents + t.tax_cents);

    const stages = allocatePayments(t.total_cents, [3000, 4000, 3000]);
    expect(stages.reduce((s, c) => s + c, 0)).toBe(t.total_cents);
    expect(text).toContain(`Advance (30%): ${formatLKR(stages[0])}\nProgress payment (40%): ${formatLKR(stages[1])}\nOn completion (30%): ${formatLKR(stages[2])}\n`);
    // read back from the text: the three stage amounts are the last three amounts before the company details and sum to the total
    const printed = amountsIn(text.slice(text.indexOf('Payment schedule')));
    expect(printed).toEqual(stages);
    expect(printed.reduce((s, c) => s + c, 0)).toBe(t.total_cents);

    expect(text).toContain('Valid until: 21 Nov 2026');
    expect(text).toContain('Bluemoon Engineering (Pvt) Ltd\nPhone: 011 222 3333\n');
  });

  it.each([
    { tax_bp: 0, discount_cents: 0 },
    { tax_bp: 1800, discount_cents: 0 },
    { tax_bp: 1250, discount_cents: 1_000_001 },
    { tax_bp: 1, discount_cents: 123_456 },
    { tax_bp: 10000, discount_cents: 99_999_999 },
    { tax_bp: 799, discount_cents: 5 },
  ])('matches the view for tax $tax_bp bp and discount $discount_cents cents', ({ tax_bp, discount_cents }) => {
    const id = makeEstimate({ tax_bp, discount_cents });
    const t = totalOf(id);
    const text = buildShareMessage('estimate', id, 'en') as string;
    const printed = amountsIn(text);
    // the figure lines, in the order they are printed
    const expected = [t.subtotal_cents, ...(t.discount_cents > 0 ? [t.discount_cents] : []), ...(tax_bp > 0 ? [t.tax_cents] : []), t.total_cents];
    expect(printed.slice(0, expected.length)).toEqual(expected);
    // and the stages after them
    expect(printed.slice(expected.length)).toEqual(allocatePayments(t.total_cents, [3000, 4000, 3000]));
    // no discount line without a discount, no tax line without tax
    expect(text.includes('Discount')).toBe(t.discount_cents > 0);
    expect(text.includes('Tax (')).toBe(tax_bp > 0);
  });

  it('the same numbers in Sinhala and in Tamil', () => {
    const id = makeEstimate({ tax_bp: 1800, discount_cents: 500_000 });
    const en = amountsIn(buildShareMessage('estimate', id, 'en') as string);
    for (const lang of ['si', 'ta'] as Lang[]) {
      const text = buildShareMessage('estimate', id, lang) as string;
      expect(amountsIn(text)).toEqual(en);
      expect(text).toContain(`*${SHARE_LABELS[lang].grandTotal}: ${formatLKR(totalOf(id).total_cents)}*`);
    }
  });

  it('a removed item leaves the numbers at once, and the count follows', () => {
    const id = makeEstimate({ schedule: false });
    const before = totalOf(id);
    const gate = first<{ id: string }>("SELECT id FROM estimate_items WHERE description = 'Steel gate'")?.id as string;
    removeEstimateItem(gate);
    const after = totalOf(id);
    expect(after.subtotal_cents).toBe(before.subtotal_cents - 18_500_000);
    const text = buildShareMessage('estimate', id, 'en') as string;
    expect(text).toContain('Items: 2\n');
    expect(text).toContain(`Subtotal: ${formatLKR(after.subtotal_cents)}\n`);
    expect(text).toContain(`*TOTAL: ${formatLKR(after.total_cents)}*`);
    expect(text).not.toContain('Payment schedule');
  });

  it('stages that do not add up to 100 % stand alone; a removed stage is gone', () => {
    const id = makeEstimate({ schedule: false });
    saveEstimatePayment({ estimate_id: id, label: 'Advance', percent_bp: 2500 });
    const second = saveEstimatePayment({ estimate_id: id, label: 'Balance', percent_bp: 1250 });
    const t = totalOf(id);
    const [a, bal] = allocatePayments(t.total_cents, [2500, 1250]);
    const text = buildShareMessage('estimate', id, 'en') as string;
    expect(text).toContain(`Advance (25%): ${formatLKR(a)}\nBalance (12.5%): ${formatLKR(bal)}\n`);
    removeEstimatePayment(second);
    expect(buildShareMessage('estimate', id, 'en')).not.toContain('Balance');
  });

  it('prints the company phone as saved on this phone now, and only what is filled in', () => {
    const id = makeEstimate();
    expect(buildShareMessage('estimate', id, 'en')).toContain('Phone: 011 222 3333');
    saveCompanyProfile({ phone: '077 337 0056' });
    expect(buildShareMessage('estimate', id, 'en')).toContain('Phone: 077 337 0056');
    saveCompanyProfile({ phone: '', name: '' });
    expect(buildShareMessage('estimate', id, 'en')).not.toContain('Phone');
  });

  it('an estimate with no lines at all is a message with zero money, not a failure', () => {
    const id = saveEstimate({ client_name: 'Empty Co', title: 'Nothing yet', issue_day: TODAY });
    const text = buildShareMessage('estimate', id, 'en') as string;
    expect(text).toContain('Items: 0\nSubtotal: Rs 0\n*TOTAL: Rs 0*');
    expect(text.split('\n')[0]).toMatch(/^\*Estimate EST-2026-\d{3}\*$/);
  });

  it('the demo estimates: the draft with its discount and the standard stages, and the accepted one with tax', () => {
    seedDemo();
    const draft = first<{ id: string }>("SELECT id FROM estimates WHERE title = 'Boundary wall, Welimada'")?.id as string;
    const accepted = first<{ id: string }>("SELECT id FROM estimates WHERE title = 'Retaining wall, Bandarawela'")?.id as string;
    for (const id of [draft, accepted]) {
      const t = totalOf(id);
      const text = buildShareMessage('estimate', id, 'en') as string;
      expect(text).toContain(`*TOTAL: ${formatLKR(t.total_cents)}*`);
      const stageAmounts = amountsIn(text.slice(text.indexOf('Payment schedule')));
      expect(stageAmounts.reduce((s, c) => s + c, 0)).toBe(t.total_cents);
    }
    expect(buildShareMessage('estimate', accepted, 'en')).toContain('Tax (18%): ');
    expect(buildShareMessage('estimate', draft, 'en')).toContain('Discount: -Rs 20,000');
  });
});

// ================================================================ work and pay of a day

describe('the work and pay message', () => {
  beforeEach(() => seedDemo());
  const school = () => idOf('projects', 'Welimada');
  const dayRows = (day: string) => all<WageDay>('SELECT * FROM v_wage_day WHERE project_id = ? AND day = ?', [school(), day]);

  it('is the exact sheet of yesterday: four workers, two of them paid', () => {
    expect(buildShareMessage('daySheet', school(), 'en', { day: d(1) })).toBe(
      lines(
        `*Work and pay — ${SCHOOL}*`,
        'Date: 21 Oct 2026',
        '',
        'Kamal Silva — 1 day — Rs 2,200 (not paid)',
        'Nimal Perera — 1 day — Rs 3,500 (paid Rs 14,000)',
        'Ruwan Jayasinghe — 1.5 days — Rs 5,400 (not paid)',
        'Sunil Fernando — 1 day — Rs 3,800 (paid Rs 10,000)',
        '',
        'Workers: 4',
        'Days: 4.5',
        'Wages: Rs 14,900',
        'Paid: Rs 24,000',
        'To pay: Rs 7,600',
        '',
        FOOTER,
      ),
    );
  });

  it('the day before: the advance is on Kamal\'s line and in the totals; Sunil worked half a day', () => {
    expect(buildShareMessage('daySheet', school(), 'en', { day: d(2) })).toBe(
      lines(
        `*Work and pay — ${SCHOOL}*`,
        'Date: 20 Oct 2026',
        '',
        'Kamal Silva — 1 day — Rs 2,200 (not paid, advance Rs 5,000)',
        'Nimal Perera — 1 day — Rs 3,500 (not paid)',
        'Ruwan Jayasinghe — 1.5 days — Rs 5,400 (not paid)',
        'Sunil Fernando — 0.5 days — Rs 1,900 (not paid)',
        '',
        'Workers: 4',
        'Days: 4',
        'Wages: Rs 13,000',
        'Paid: Rs 0',
        'Advances: Rs 5,000',
        'To pay: Rs 13,000',
        '',
        FOOTER,
      ),
    );
  });

  it('without a day it is today\'s sheet: five workers, nobody paid', () => {
    const text = buildShareMessage('daySheet', school(), 'en') as string;
    expect(text).toContain('Date: 22 Oct 2026');
    expect(text).toContain('Workers: 5\nDays: 5.5\nWages: Rs 17,100\nPaid: Rs 0\nTo pay: Rs 17,100');
  });

  it('adds up to what v_wage_day reports, for every day of the demo', () => {
    for (let n = 0; n <= 6; n++) {
      const rows = dayRows(d(n));
      const data = loadDaySheetShare(school(), d(n));
      expect(data?.rows).toHaveLength(rows.length);
      const text = daySheetMessage(data as NonNullable<typeof data>, 'en');
      if (rows.length === 0) {
        expect(text).toContain('No work recorded for this day'); // the demo has work on five days only
        continue;
      }
      const worked = rows.filter((r) => r.days != null);
      expect(text).toContain(`Workers: ${worked.length}\n`);
      expect(text).toContain(`Wages: ${formatLKR(rows.reduce((s, r) => s + r.work_cents, 0))}\n`);
      expect(text).toContain(`Paid: ${formatLKR(rows.reduce((s, r) => s + r.paid_cents, 0))}\n`);
      expect(text).toContain(`To pay: ${formatLKR(worked.reduce((s, r) => s + Math.max(0, r.work_cents - r.paid_cents), 0))}`);
      expect(text).toContain(`Days: ${worked.reduce((s, r) => s + (r.days ?? 0), 0)}\n`);
    }
    expect(dayRows(d(0))).toHaveLength(5);
    expect(dayRows(d(5))).toHaveLength(0);
  });

  it('the culvert\'s sheet is the culvert\'s only', () => {
    const culvert = idOf('projects', 'Badulla');
    const text = buildShareMessage('daySheet', culvert, 'en', { day: d(0) }) as string;
    expect(text).toContain('Saman Kumara — 1 day — Rs 3,500 (paid Rs 3,500)');
    expect(text).toContain('Workers: 1\nDays: 1\nWages: Rs 3,500\nPaid: Rs 3,500\nTo pay: Rs 0');
    expect(text).not.toContain('Nimal');
  });

  it('a day nobody worked is an empty sheet, not null', () => {
    expect(buildShareMessage('daySheet', school(), 'en', { day: d(30) })).toBe(
      lines(`*Work and pay — ${SCHOOL}*`, 'Date: 22 Sep 2026', '', 'No work recorded for this day', '', FOOTER),
    );
  });

  it('a deleted work entry is off the sheet; so is a deleted worker; a payment without work goes under "Other payments"', () => {
    const nimal = idOf('workers', 'Nimal');
    const anura = idOf('workers', 'Anura');
    const entry = first<{ id: string }>("SELECT id FROM wage_entries WHERE worker_id = ? AND day = ? AND kind = 'work'", [nimal, d(1)])?.id as string;
    deleteRecord('wage_entries', entry);
    payWages({ project_id: school(), worker_id: anura, day: d(1), amount_cents: 200_000 });
    deleteRecord('workers', idOf('workers', 'Sunil'));
    const text = buildShareMessage('daySheet', school(), 'en', { day: d(1) }) as string;
    // Nimal's payment of 14,000 stays on the day (v_wage_day) but he did not work: other payments
    expect(text).not.toContain('Nimal Perera — 1 day');
    expect(text).toContain('Other payments\nAnura Kumara — paid Rs 2,000\nNimal Perera — paid Rs 14,000\n');
    expect(text).not.toContain('Sunil');
    expect(text).toContain('Workers: 2\nDays: 2.5\nWages: Rs 7,600\nPaid: Rs 16,000\nTo pay: Rs 7,600');
  });

  it('the same sheet in Sinhala and Tamil has the same amounts', () => {
    const en = amountsIn(buildShareMessage('daySheet', school(), 'en', { day: d(1) }) as string);
    for (const lang of ['si', 'ta'] as Lang[]) {
      expect(amountsIn(buildShareMessage('daySheet', school(), lang, { day: d(1) }) as string)).toEqual(en);
    }
  });
});

// ================================================================ one worker

describe('the worker statement', () => {
  beforeEach(() => seedDemo());
  const wb = (worker: string) => first<WorkerBalance>('SELECT * FROM v_worker_balance WHERE worker_id = ?', [worker]) as WorkerBalance;

  it('is the exact statement of Nimal: his balance across all projects and the one project he is on', () => {
    expect(buildShareMessage('workerStatement', idOf('workers', 'Nimal'), 'en')).toBe(
      lines(
        '*Nimal Perera*',
        'Trade: Mason',
        'Daily rate: Rs 3,500',
        '',
        'Earned: Rs 17,500',
        'Advances: Rs 0',
        'Paid: Rs 14,000',
        'To pay: Rs 3,500',
        '',
        'Per project',
        `${SCHOOL} — 5 days — to pay Rs 3,500`,
        '',
        'Last payments and advances',
        `21 Oct 2026 — Payment — Rs 14,000 — ${SCHOOL}`,
        '',
        FOOTER,
      ),
    );
  });

  it('Kamal is on two projects: a line each, the advance, and a total that is the worker view\'s', () => {
    const kamal = idOf('workers', 'Kamal');
    const data = loadWorkerStatementShare(kamal);
    const view = wb(kamal);
    expect(data?.totals).toEqual({ earned_cents: view.earned_cents, advance_cents: view.advance_cents, paid_cents: view.paid_cents, balance_cents: view.balance_cents });
    expect(view).toMatchObject({ earned_cents: 880_000, advance_cents: 500_000, paid_cents: 0, balance_cents: 380_000 });
    // the lines come from v_project_worker_balance, in the worker screen's order
    const lineViews = all<ProjectWorkerBalance & { project_name: string }>(
      `SELECT b.*, p.name AS project_name FROM v_project_worker_balance b JOIN projects p ON p.id = b.project_id WHERE b.worker_id = ? ORDER BY p.name`,
      [kamal],
    );
    expect(data?.projects).toEqual(lineViews.map((l) => ({ name: l.project_name, days_total: l.days_total, balance_cents: l.balance_cents })));
    expect(buildShareMessage('workerStatement', kamal, 'en')).toBe(
      lines(
        '*Kamal Silva*',
        'Trade: Helper',
        'Daily rate: Rs 2,200',
        '',
        'Earned: Rs 8,800',
        'Advances: Rs 5,000',
        'Paid: Rs 0',
        'To pay: Rs 3,800',
        '',
        'Per project',
        `${CULVERT} — settled`,
        `${SCHOOL} — 4 days — to pay Rs 3,800`,
        '',
        'Last payments and advances',
        `20 Oct 2026 — Advance — Rs 5,000 — ${SCHOOL}`,
        '',
        FOOTER,
      ),
    );
  });

  it('for one project it has that project\'s figures and rate, and no list of projects', () => {
    const kamal = idOf('workers', 'Kamal');
    const school = idOf('projects', 'Welimada');
    const row = first<ProjectWorkerBalance>('SELECT * FROM v_project_worker_balance WHERE project_id = ? AND worker_id = ?', [school, kamal]) as ProjectWorkerBalance;
    const data = loadWorkerStatementShare(kamal, school);
    expect(data?.totals).toEqual({ earned_cents: row.earned_cents, advance_cents: row.advance_cents, paid_cents: row.paid_cents, balance_cents: row.balance_cents });
    expect(data?.worker.daily_rate_cents).toBe(row.rate_cents);
    expect(data?.projectName).toBe(SCHOOL);
    expect(data?.projects).toEqual([]);
    expect(buildShareMessage('workerStatement', kamal, 'en', { projectId: school })).toBe(
      lines(
        '*Kamal Silva*',
        'Trade: Helper',
        `Project: ${SCHOOL}`,
        'Daily rate: Rs 2,200',
        '',
        'Earned: Rs 8,800',
        'Advances: Rs 5,000',
        'Paid: Rs 0',
        'To pay: Rs 3,800',
        '',
        'Last payments and advances',
        '20 Oct 2026 — Advance — Rs 5,000',
        '',
        FOOTER,
      ),
    );
    // on the culvert he has the other rate and nothing booked
    const culvert = loadWorkerStatementShare(kamal, idOf('projects', 'Badulla'));
    expect(culvert?.worker.daily_rate_cents).toBe(230_000);
    expect(culvert?.totals).toEqual({ earned_cents: 0, advance_cents: 0, paid_cents: 0, balance_cents: 0 });
    expect(culvert?.recentCount).toBe(0);
  });

  it('the total of a worker is the view\'s even when the project lines do not explain all of it (wages on a project he is not assigned to)', () => {
    const nimal = idOf('workers', 'Nimal');
    const culvert = idOf('projects', 'Badulla');
    payWages({ project_id: culvert, worker_id: nimal, day: d(0), amount_cents: 100_000 });
    const data = loadWorkerStatementShare(nimal);
    expect(data?.totals.paid_cents).toBe(wb(nimal).paid_cents);
    expect(data?.totals.balance_cents).toBe(350_000 - 100_000);
    expect(data?.projects.map((p) => p.name)).toEqual([SCHOOL]); // no assignment on the culvert, so no line
    // and for the culvert alone: his payment there is found although he is not assigned
    const onCulvert = loadWorkerStatementShare(nimal, culvert);
    expect(onCulvert?.totals).toEqual({ earned_cents: 0, advance_cents: 0, paid_cents: 100_000, balance_cents: -100_000 });
    expect(buildShareMessage('workerStatement', nimal, 'en', { projectId: culvert })).toContain('Advance over: Rs 1,000');
  });

  it('lists the newest payments and advances (5), says how many more, and leaves out a deleted one', () => {
    const nimal = idOf('workers', 'Nimal');
    const school = idOf('projects', 'Welimada');
    const ids: string[] = [];
    for (let i = 1; i <= 8; i++) {
      clock.tick(1);
      ids.push(payWages({ project_id: school, worker_id: nimal, day: d(1 + i), amount_cents: i * 10_000 }));
    }
    const data = loadWorkerStatementShare(nimal);
    expect(data?.recentCount).toBe(9); // the weekly pay of the demo and the eight new ones
    expect(data?.recent).toHaveLength(SHARE_LIMITS.payments);
    expect(data?.recent.map((r) => r.day)).toEqual([d(1), d(2), d(3), d(4), d(5)]);
    expect(data?.recent[0]).toMatchObject({ kind: 'payment', amount_cents: 1_400_000, project_name: SCHOOL });
    const text = workerStatementMessage(data as NonNullable<typeof data>, 'en');
    expect(text).toContain('… and 4 more');
    deleteRecord('wage_entries', ids[0]); // d(2)
    expect(loadWorkerStatementShare(nimal)?.recentCount).toBe(8);
    expect(loadWorkerStatementShare(nimal)?.recent.map((r) => r.day)).toEqual([d(1), d(3), d(4), d(5), d(6)]);
  });

  it('a worker with nothing booked is settled with no lists; one who has had more than he earned owes the advance back', () => {
    const idle = saveWorker({ name: 'Idle Worker', daily_rate_cents: 0 });
    expect(buildShareMessage('workerStatement', idle, 'en')).toBe(lines('*Idle Worker*', 'Earned: Rs 0', 'Advances: Rs 0', 'Paid: Rs 0', 'Balance: Settled', '', FOOTER));
    const p = saveProject({ name: 'P' });
    const w = saveWorker({ name: 'Borrower', daily_rate_cents: 100_000 });
    assignWorker({ project_id: p, worker_id: w, rate_cents: 100_000 });
    recordWorkDay({ project_id: p, worker_id: w, day: d(1), days: 1 });
    saveWageEntry({ worker_id: w, project_id: p, day: d(1), kind: 'advance', amount_cents: 150_000 });
    const text = buildShareMessage('workerStatement', w, 'en') as string;
    expect(text).toContain('Advance over: Rs 500');
    expect(text).toContain('P — 1 day — advance over Rs 500');
  });

  it('is told in Tamil and Sinhala with the same amounts', () => {
    const nimal = idOf('workers', 'Nimal');
    const en = amountsIn(buildShareMessage('workerStatement', nimal, 'en') as string);
    for (const lang of ['si', 'ta'] as Lang[]) expect(amountsIn(buildShareMessage('workerStatement', nimal, lang) as string)).toEqual(en);
  });
});

// ================================================================ expenses

describe('the expenses message', () => {
  it('carries the total and the number of all expenses, and the newest rows (the demo)', () => {
    seedDemo();
    const data = loadExpensesShare(null, 3);
    // all 12 expenses of the demo, Rs 495,550 on the school and Rs 75,900 on the culvert
    expect(data).toMatchObject({ projectName: null, totalCents: 57_145_000, totalCount: 12 });
    expect(first('SELECT SUM(amount_cents) AS s, COUNT(*) AS n FROM expenses WHERE deleted_at IS NULL')).toEqual({ s: 57_145_000, n: 12 });
    // the newest day has three expenses: two on the school and one on the culvert
    expect(data?.rows.map((r) => r.amount_cents).sort((x, y) => x - y)).toEqual([420_000, 6_430_000, 18_500_000]);
    expect(data?.rows.every((r) => r.day === d(0))).toBe(true);
    const text = expensesMessage(data as NonNullable<typeof data>, 'en');
    expect(text).toContain('Total: Rs 571,450 (12 expenses)');
    expect(text).toContain('\n… and 9 more\n');
    expect(text.split('\n')[0]).toBe('*Expenses — All projects*');
  });

  it('for one project: its own total and rows, newest first (the order of the Expenses tab)', () => {
    const p = saveProject({ name: 'Site A' });
    const q = saveProject({ name: 'Site B' });
    const add = (project: string, day: string, category: Parameters<typeof saveExpense>[0]['category'], rupees: number, paid_to: string) => {
      clock.tick(1);
      return saveExpense({ project_id: project, day, category, amount_cents: rupees * 100, paid_to, method: 'cash' });
    };
    add(p, '2026-10-20', 'materials', 1000, 'Shop 1');
    add(p, '2026-10-21', 'fuel', 2000, 'Shop 2');
    add(q, '2026-10-21', 'food', 500, 'Other site');
    add(p, '2026-10-21', 'transport', 3000, 'Shop 3');
    add(p, '2026-10-19', 'other', 4000, 'Shop 0');

    expect(buildShareMessage('expenses', p, 'en')).toBe(
      lines(
        '*Expenses — Site A*',
        'Total: Rs 10,000 (4 expenses)',
        '',
        '21 Oct 2026 — Transport — Shop 3 — Rs 3,000',
        '21 Oct 2026 — Fuel — Shop 2 — Rs 2,000',
        '20 Oct 2026 — Materials — Shop 1 — Rs 1,000',
        '19 Oct 2026 — Other — Shop 0 — Rs 4,000',
        '',
        FOOTER,
      ),
    );
    // all projects: every row names its project, the total is of everything
    expect(buildShareMessage('expenses', null, 'en')).toBe(
      lines(
        '*Expenses — All projects*',
        'Total: Rs 10,500 (5 expenses)',
        '',
        '21 Oct 2026 — Transport — Shop 3 — Rs 3,000 — Site A',
        '21 Oct 2026 — Food & tea — Other site — Rs 500 — Site B',
        '21 Oct 2026 — Fuel — Shop 2 — Rs 2,000 — Site A',
        '20 Oct 2026 — Materials — Shop 1 — Rs 1,000 — Site A',
        '19 Oct 2026 — Other — Shop 0 — Rs 4,000 — Site A',
        '',
        FOOTER,
      ),
    );
  });

  it('the limit is how many rows are loaded; the total and the count are always all of them', () => {
    const p = saveProject({ name: 'Site A' });
    for (let i = 1; i <= 40; i++) {
      clock.tick(1);
      saveExpense({ project_id: p, day: d(0), category: 'fuel', amount_cents: 100_000, paid_to: `Shop ${i}`, method: 'cash' });
    }
    expect(loadExpensesShare(p)?.rows).toHaveLength(30); // the default is the message's own cap
    expect(loadExpensesShare(p, 5)?.rows.map((r) => r.paid_to)).toEqual(['Shop 40', 'Shop 39', 'Shop 38', 'Shop 37', 'Shop 36']);
    expect(loadExpensesShare(p, 5)).toMatchObject({ totalCents: 4_000_000, totalCount: 40 });
    for (const bad of [0, -3, 2.5, Number.NaN]) expect(loadExpensesShare(p, bad)?.rows).toHaveLength(30);
    expect(loadExpensesShare(p, 100_000)?.rows).toHaveLength(40);
    const text = buildShareMessage('expenses', p, 'en', { limit: 5 }) as string;
    expect(text).toContain('Total: Rs 40,000 (40 expenses)');
    expect(text).toContain('\n… and 35 more\n');
  });

  it('a deleted expense is off the list and out of the total', () => {
    seedDemo();
    const school = idOf('projects', 'Welimada');
    expect(loadExpensesShare(school)).toMatchObject({ totalCents: 49_555_000, totalCount: 9 });
    deleteRecord('expenses', expenseId('Perera Transport'));
    const data = loadExpensesShare(school);
    expect(data).toMatchObject({ totalCents: 49_555_000 - 1_850_000, totalCount: 8 });
    expect(data?.rows.map((r) => r.paid_to)).not.toContain('Perera Transport');
    expect(data?.rows).toHaveLength(8);
  });

  it('in Sinhala and Tamil: the same figures', () => {
    seedDemo();
    const school = idOf('projects', 'Welimada');
    const en = amountsIn(buildShareMessage('expenses', school, 'en') as string);
    expect(en[0]).toBe(49_555_000);
    for (const lang of ['si', 'ta'] as Lang[]) expect(amountsIn(buildShareMessage('expenses', school, lang) as string)).toEqual(en);
  });
});

// ================================================================ tools out

describe('the tools-out message', () => {
  beforeEach(() => seedDemo());

  it('lists what is out now with whom, since when and where (the demo: the drill and the mixer)', () => {
    expect(buildShareMessage('toolsOut', null, 'en')).toBe(
      lines(
        '*Tools out — All projects*',
        'Tools out: 2',
        '',
        `Concrete mixer (BM-T-002) — with Nimal Perera — since 19 Oct 2026 — ${SCHOOL}`,
        `Hilti drill (BM-T-001) — with Sunil Fernando — since 20 Oct 2026 — ${SCHOOL}`,
        '',
        FOOTER,
      ),
    );
  });

  it('for one project the project is the title, not every line; for a project with nothing out the message says so', () => {
    expect(buildShareMessage('toolsOut', idOf('projects', 'Welimada'), 'en')).toBe(
      lines(
        `*Tools out — ${SCHOOL}*`,
        'Tools out: 2',
        '',
        'Concrete mixer (BM-T-002) — with Nimal Perera — since 19 Oct 2026',
        'Hilti drill (BM-T-001) — with Sunil Fernando — since 20 Oct 2026',
        '',
        FOOTER,
      ),
    );
    expect(buildShareMessage('toolsOut', idOf('projects', 'Badulla'), 'en')).toBe(lines(`*Tools out — ${CULVERT}*`, 'No tools are out right now', '', FOOTER));
  });

  it('agrees with v_tool_status', () => {
    const out = all<{ name: string }>('SELECT name FROM v_tool_status WHERE is_out = 1 ORDER BY name COLLATE NOCASE');
    expect(loadToolsOutShare(null)?.tools.map((t) => t.name)).toEqual(out.map((o) => o.name));
  });

  it('a tool taken by someone outside the company shows his name; a returned tool, a deleted tool and a deleted movement are not out', () => {
    const station = idOf('tools', 'Total station');
    moveTool({ tool_id: station, kind: 'issue', taken_by: 'Contractor Silva', day: d(1) });
    let tools = loadToolsOutShare(null)?.tools ?? [];
    expect(tools.map((t) => t.name)).toEqual(['Concrete mixer', 'Hilti drill', 'Total station']);
    expect(tools[2]).toEqual({ name: 'Total station', code: 'BM-T-004', with_name: 'Contractor Silva', since: d(1), project_name: null });
    expect(buildShareMessage('toolsOut', null, 'en')).toContain('Total station (BM-T-004) — with Contractor Silva — since 21 Oct 2026\n');

    clock.tick(1);
    moveTool({ tool_id: station, kind: 'return', day: d(0) });
    deleteRecord('tools', idOf('tools', 'Concrete mixer'));
    tools = loadToolsOutShare(null)?.tools ?? [];
    expect(tools.map((t) => t.name)).toEqual(['Hilti drill']);

    const issue = first<{ id: string }>("SELECT id FROM tool_movements WHERE kind = 'issue' AND tool_id = ?", [idOf('tools', 'Hilti')])?.id as string;
    deleteRecord('tool_movements', issue);
    expect(loadToolsOutShare(null)?.tools).toEqual([]);
  });

  it('a tool with no code is just its name', () => {
    const t = saveTool({ name: 'Wheelbarrow' });
    moveTool({ tool_id: t, kind: 'issue', taken_by: 'Somebody', day: d(0) });
    expect(buildShareMessage('toolsOut', null, 'en')).toContain('Wheelbarrow — with Somebody — since 22 Oct 2026\n');
  });
});

// ================================================================ notes

describe('the note message', () => {
  beforeEach(() => seedDemo());

  it('is the exact note: project, day, weather, the text', () => {
    expect(buildShareMessage('note', noteId('First-floor'), 'en')).toBe(
      lines(
        `*Site note — ${SCHOOL}*`,
        'Date: 22 Oct 2026',
        'Weather: Sunny',
        '',
        'First-floor slab shuttering completed on the east side. Waiting for the bar-bending inspection before pouring.',
        '',
        FOOTER,
      ),
    );
    expect(buildShareMessage('note', noteId('Rain after'), 'ta')).toContain('வானிலை: மழை');
    expect(buildShareMessage('note', noteId('Old pipes'), 'si')).toContain('කාලගුණය: වලාකුළු');
  });

  it('keeps the paragraphs of a note typed over several lines, whole', () => {
    const school = idOf('projects', 'Welimada');
    const long = `Delivery from the depot at 8 am.\n\nCement: 50 bags.\nSand: 2 loads.\n${'Inspection by the engineer went well. '.repeat(20)}`;
    const id = saveNote({ project_id: school, day: d(0), body: long, weather: null });
    const text = buildShareMessage('note', id, 'en') as string;
    expect(loadNoteShare(id)?.body).toBe(long.trim()); // the note is saved trimmed
    expect(text).toContain('\n\nDelivery from the depot at 8 am.\n\nCement: 50 bags.\nSand: 2 loads.\nInspection by the engineer went well. Inspection');
    expect(text).not.toContain('Weather');
    expect(text.endsWith(FOOTER)).toBe(true);
  });
});

// ================================================================ the wrapper

describe('buildShareMessage', () => {
  beforeEach(() => seedDemo());
  const school = () => idOf('projects', 'Welimada');

  it('is the loader and the builder together, for every kind', () => {
    const nimal = idOf('workers', 'Nimal');
    const est = first<{ id: string }>("SELECT id FROM estimates WHERE title = 'Boundary wall, Welimada'")?.id as string;
    for (const lang of ['en', 'si', 'ta'] as Lang[]) {
      expect(buildShareMessage('project', school(), lang)).toBe(projectMessage(loadProjectShare(school()) as never, lang));
      expect(buildShareMessage('estimate', est, lang)).toBe(estimateMessage(loadEstimateShare(est) as never, lang));
      expect(buildShareMessage('daySheet', school(), lang, { day: d(1) })).toBe(daySheetMessage(loadDaySheetShare(school(), d(1)) as never, lang));
      expect(buildShareMessage('workerStatement', nimal, lang)).toBe(workerStatementMessage(loadWorkerStatementShare(nimal) as never, lang));
      expect(buildShareMessage('expenses', school(), lang)).toBe(expensesMessage(loadExpensesShare(school()) as never, lang));
      expect(buildShareMessage('toolsOut', school(), lang)).toBe(toolsOutMessage(loadToolsOutShare(school()) as never, lang));
      const note = noteId('First-floor');
      expect(buildShareMessage('note', note, lang)).toBe(noteMessage(loadNoteShare(note) as never, lang));
    }
  });

  it('every message made from the demo data is clean, in every language', () => {
    const nimal = idOf('workers', 'Nimal');
    const est = first<{ id: string }>("SELECT id FROM estimates WHERE title = 'Retaining wall, Bandarawela'")?.id as string;
    const targets: [Parameters<typeof buildShareMessage>[0], string | null][] = [
      ['project', school()],
      ['project', idOf('projects', 'Bandarawela')],
      ['estimate', est],
      ['daySheet', school()],
      ['workerStatement', nimal],
      ['expenses', null],
      ['toolsOut', null],
      ['note', noteId('Rain after')],
    ];
    for (const lang of ['en', 'si', 'ta'] as Lang[]) {
      for (const [kind, id] of targets) {
        const text = buildShareMessage(kind, id, lang) as string;
        expect({ kind, lang, ok: typeof text === 'string' }).toEqual({ kind, lang, ok: true });
        expect(text).toMatch(/^\*[^*\n]+\*\n/);
        expect(text).not.toMatch(/undefined|null|NaN/);
        expect(text.length).toBeLessThanOrEqual(SHARE_LIMITS.message);
        expect(text.endsWith(` · ${'22 Oct 2026'}`)).toBe(true);
      }
    }
  });

  it('the language is the app\'s language setting when none is given, English on a phone that never chose', () => {
    expect(buildShareMessage('project', school())).toContain('Total cost');
    setSetting('lang', 'si');
    expect(buildShareMessage('project', school())).toContain(SHARE_LABELS.si.totalCost);
    setSetting('lang', 'ta');
    expect(buildShareMessage('project', school())).toContain(SHARE_LABELS.ta.totalCost);
    // an explicit language wins over the setting
    expect(buildShareMessage('project', school(), 'en')).toContain('Total cost');
    expect(buildShareMessage('project', school(), undefined)).toContain(SHARE_LABELS.ta.totalCost);
    // a setting that is nonsense falls back to the phone's language (English here)
    setSetting('lang', 'xx');
    expect(buildShareMessage('project', school())).toContain('Total cost');
  });

  it('only reads: nothing is written, no version moves, nothing is logged', () => {
    const snapshot = () => ({
      audit: first<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n,
      settings: all('SELECT * FROM settings ORDER BY key'),
      tables: DATA_TABLES.map((t) => first(`SELECT COUNT(*) AS n, SUM(version) AS v, MAX(updated_at) AS u FROM ${t}`)),
    });
    const before = snapshot();
    const nimal = idOf('workers', 'Nimal');
    const est = first<{ id: string }>("SELECT id FROM estimates WHERE title = 'Boundary wall, Welimada'")?.id as string;
    for (const lang of ['en', 'si', 'ta'] as Lang[]) {
      buildShareMessage('project', school(), lang);
      buildShareMessage('estimate', est, lang);
      buildShareMessage('daySheet', school(), lang, { day: d(1) });
      buildShareMessage('workerStatement', nimal, lang);
      buildShareMessage('workerStatement', nimal, lang, { projectId: school() });
      buildShareMessage('expenses', null, lang);
      buildShareMessage('toolsOut', school(), lang);
      buildShareMessage('note', noteId('Rain after'), lang);
    }
    buildShareMessage('project', school()); // the language from the settings
    expect(snapshot()).toEqual(before);
  });

  it('the footer carries today\'s date from the clock, whatever day the sheet is about', () => {
    clock.set(new Date(2026, 11, 1, 9, 0, 0));
    expect(today()).toBe('2026-12-01');
    expect(buildShareMessage('daySheet', school(), 'en', { day: d(1) })?.endsWith('Developed with Bluemoon Site · 1 Dec 2026')).toBe(true);
  });
});

// ================================================================ a second phone

describe('data that came from another phone', () => {
  it('is shared like any other, and a worker assigned on both phones counts once', async () => {
    const a = mainPhone();
    const projectId = a.repo.saveProject({ name: 'Shared Site', client: 'Client Co', location: 'Welimada', contract_cents: 100_000_000 });
    const workerId = a.repo.saveWorker({ name: 'Shared Worker', trade: 'Mason', daily_rate_cents: 300_000 });
    await transfer(a, b); // both phones have the project and the worker, nobody is assigned yet

    a.repo.assignWorker({ project_id: projectId, worker_id: workerId, rate_cents: 300_000 });
    b.repo.assignWorker({ project_id: projectId, worker_id: workerId, rate_cents: 320_000 });
    b.repo.recordWorkDay({ project_id: projectId, worker_id: workerId, day: d(1), days: 2 });
    b.repo.payWages({ project_id: projectId, worker_id: workerId, day: d(1), amount_cents: 200_000 });
    b.repo.saveExpense({ project_id: projectId, day: d(1), category: 'materials', amount_cents: 5_000_000, paid_to: 'Phone B Depot', method: 'cash' });
    b.repo.saveNote({ project_id: projectId, day: d(1), body: 'Written on the other phone.', weather: 'rain' });
    const tool = b.repo.saveTool({ name: 'Phone B drill', code: 'B-1' });
    b.repo.moveTool({ tool_id: tool, kind: 'issue', project_id: projectId, worker_id: workerId, day: d(1) });
    await transfer(b, a);

    // phone A now has two live assignments of the same worker; the views count him once
    expect(a.db.all('SELECT id FROM project_workers WHERE project_id = ? AND worker_id = ? AND deleted_at IS NULL', [projectId, workerId])).toHaveLength(2);

    const data = loadProjectShare(projectId);
    const viewOnB = b.db.first<ProjectCost>('SELECT * FROM v_project_cost WHERE project_id = ?', [projectId]);
    expect(data?.cost).toEqual(viewOnB); // the figures are the other phone's, to the cent
    // 50,000 spent; two days worked on phone B at its rate of 3,200 is 6,400, of which 2,000 was paid
    expect(data?.cost).toMatchObject({ expense_cents: 5_000_000, labour_cents: 640_000, labour_paid_cents: 200_000 });
    expect(data?.workerCount).toBe(1);
    expect(data?.toolsOutCount).toBe(1);
    expect(data?.noteCount).toBe(1);

    const text = buildShareMessage('project', projectId, 'en') as string;
    expect(text).toContain('Workers: 1\nTools out: 1\n');
    expect(text).toContain('Total cost: Rs 56,400'); // 50,000 + 6,400
    expect(buildShareMessage('toolsOut', projectId, 'en')).toContain('Phone B drill (B-1) — with Shared Worker');
    expect(buildShareMessage('note', first<{ id: string }>('SELECT id FROM site_notes')?.id as string, 'en')).toContain('Weather: Rain');
    expect(buildShareMessage('daySheet', projectId, 'en', { day: d(1) })).toContain('Shared Worker — 2 days — Rs 6,400 (paid Rs 2,000)');
  });
});

// ================================================================ typed text in the database

describe('typed text in the database can not break a message', () => {
  const NASTY = [
    '*Bold* name',
    'Line one\nLine two\r\nLine three',
    'ක්‍ෂ'.repeat(80),
    'ஸ்ரீ'.repeat(70),
    'x'.repeat(300),
    '😀 site',
    'back`tick',
    '  padded  ',
    '5*5 plate',
    '***',
    'a: b: c',
  ];

  /** What must hold for every message; returns the first thing that does not. */
  function problem(text: string, estimate: boolean, lang: Lang): string | null {
    const all = text.split('\n');
    if (text.length > SHARE_LIMITS.message) return 'too long';
    if (/undefined|null|NaN|Infinity/.test(text)) return 'undefined, null, NaN or Infinity';
    if (!/^\*[^*\n]+\*$/.test(all[0])) return `the first line is not a bold title: ${all[0]}`;
    if ((text.match(/\*/g) ?? []).length !== (estimate ? 4 : 2)) return 'asterisks';
    if (text.includes('`')) return 'a back-tick';
    if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u{2028}\u{2029}]/u.test(text)) return 'a control character';
    if (/[\uD800-\uDFFF]/u.test(text)) return 'a lone surrogate';
    if (/\n\n\n/.test(text) || text.startsWith('\n') || text.endsWith('\n')) return 'blank lines in the wrong place';
    for (const line of all) {
      if (line !== line.trim()) return `an untidy line: "${line}"`;
      if (/:\s*$/.test(line)) return `a label without a value: "${line}"`;
    }
    return all[all.length - 1].startsWith(SHARE_LABELS[lang].footer) ? null : 'the footer is not last';
  }

  it.each(NASTY.map((s, i) => [i, s] as const))('every message about data typed as #%i is clean in every language', (i, s) => {
    const p = saveProject({ name: s, client: s, location: s, contract_cents: 100_000_000 + i, status: 'active' });
    const w = saveWorker({ name: s, trade: s, daily_rate_cents: 350_000, phone: '0771234567' });
    assignWorker({ project_id: p, worker_id: w, rate_cents: 350_000 });
    recordWorkDay({ project_id: p, worker_id: w, day: d(1), days: 1.5 });
    payWages({ project_id: p, worker_id: w, day: d(1), amount_cents: 100_000, note: s });
    saveExpense({ project_id: p, day: d(1), category: 'materials', amount_cents: 123_456, paid_to: s, method: 'cash', note: s });
    const tool = saveTool({ name: s, code: s, notes: s });
    moveTool({ tool_id: tool, kind: 'issue', project_id: p, taken_by: s, day: d(1), note: s });
    const note = saveNote({ project_id: p, day: d(1), body: s, weather: 'sunny' });
    const est = saveEstimate({ number: s, client_name: s, title: s, location: s, issue_day: TODAY, tax_bp: 1800 });
    saveEstimateItem({ estimate_id: est, description: s, qty_milli: 1500, rate_cents: 12_345 });
    saveEstimatePayment({ estimate_id: est, label: s, percent_bp: 10000 });

    for (const lang of ['en', 'si', 'ta'] as Lang[]) {
      const made: [string, string | null, boolean][] = [
        ['project', buildShareMessage('project', p, lang), false],
        ['estimate', buildShareMessage('estimate', est, lang), true],
        ['daySheet', buildShareMessage('daySheet', p, lang, { day: d(1) }), false],
        ['statement', buildShareMessage('workerStatement', w, lang), false],
        ['statement of a project', buildShareMessage('workerStatement', w, lang, { projectId: p }), false],
        ['expenses', buildShareMessage('expenses', p, lang), false],
        ['all expenses', buildShareMessage('expenses', null, lang), false],
        ['tools', buildShareMessage('toolsOut', p, lang), false],
        ['all tools', buildShareMessage('toolsOut', null, lang), false],
        ['note', buildShareMessage('note', note, lang), false],
      ];
      for (const [what, text, isEstimate] of made) {
        expect({ what, lang, made: text !== null }).toEqual({ what, lang, made: true });
        expect({ what, lang, why: problem(text as string, isEstimate, lang) }).toEqual({ what, lang, why: null });
      }
    }
  });
});
