/**
 * The printable lists (src/lib/reports) must say the same as the screens: their figures come from the
 * same views and queries, and the HTML has to agree with the database to the cent and to the row.
 * Loaders and builders are run against the demo data set, with records deleted and added on top.
 */
import { all, first } from '@/db';
import { deleteRecord, moveTool, payWages, recordWorkDay, saveExpense, saveNote, saveWageEntry, saveWorker, unassignWorker } from '@/db/repo';
import type { ProjectWorkerBalance, WageDay, Worker, WorkerBalance } from '@/db/types';
import { expenseWhere, type ExpenseFilter } from '@/hooks/data';
import { en } from '@/i18n/en';
import { addDays } from '@/lib/dates';
import { formatLKR, parseCents } from '@/lib/money';
import { pageHtml, pdfFileName } from '@/lib/pdfShell';
import { buildDaySheetHtml } from '@/lib/reports/daySheetHtml';
import { buildExpensesHtml } from '@/lib/reports/expensesHtml';
import { loadDaySheet, loadExpenses, loadNotes, loadToolsRegister, loadWorkersList, loadWorkerStatement } from '@/lib/reports/load';
import { buildNotesHtml } from '@/lib/reports/notesHtml';
import { buildToolsRegisterHtml } from '@/lib/reports/toolsRegisterHtml';
import { buildWorkerStatementHtml } from '@/lib/reports/workerStatementHtml';
import { buildWorkersListHtml } from '@/lib/reports/workersListHtml';
import { LETTERHEAD_MARGIN_MM, PLAIN_MARGIN_MM } from '@/lib/letterhead';
import { SHARE_LABELS, shareLabels } from '@/lib/shareLabels';
import { buildShareMessage } from '@/lib/shareLoad';
import { unpaidForDay } from '@/lib/wages';
import { resetDb, seedDemo } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

const TODAY = '2026-10-22';
let clock: ReturnType<typeof useClock>;
beforeEach(() => {
  resetDb();
  clock = useClock(new Date(2026, 9, 22, 12, 0, 0));
  seedDemo();
});
afterEach(() => clock.restore());

const idOf = (table: 'projects' | 'workers' | 'tools', like: string) => first<{ id: string }>(`SELECT id FROM ${table} WHERE name LIKE ? AND deleted_at IS NULL`, [`${like}%`])?.id as string;
/** The keys themselves as labels, so sections can be found without a language. */
const t = (key: keyof typeof en, vars?: Record<string, string | number>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

/** Every "Rs 1,234.50" in the html, in cents. */
const amounts = (html: string): number[] => [...html.matchAll(/Rs ([\d,]+(?:\.\d\d)?)/g)].map((m) => parseCents(m[1]) as number);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** The html between a section heading and the next one (or the footer). */
function section(html: string, key: string): string {
  const start = html.indexOf(`<h2>${key}`);
  if (start < 0) return '';
  const next = html.indexOf('<h2>', start + 4);
  return html.slice(start, next < 0 ? html.indexOf('<div class="foot">') : next);
}
/** The data rows of the first table in `html` (the totals row left out), and that totals row. */
function tableRows(html: string): { rows: string[]; total: string | null } {
  const body = html.slice(html.indexOf('<tbody>') + 7, html.indexOf('</tbody>'));
  const totalAt = body.indexOf('<tr class="total">');
  const data = totalAt < 0 ? body : body.slice(0, totalAt);
  return { rows: data.split('<tr>').slice(1), total: totalAt < 0 ? null : body.slice(totalAt) };
}
/** The headline boxes, in order. */
const boxValues = (html: string): string[] => [...html.matchAll(/<b class="n">([^<]*)<\/b>/g)].map((m) => m[1]);
const clean = (html: string) => html.replace(/data:[^"')]+/g, '');

// ================================================================ the page shell

describe('the page shell', () => {
  it('has the plain margins with the logo and company block, and the letterhead margins with the title block only', () => {
    const plain = pageHtml({ title: 'T', kicker: 'K', letterhead: false, body: '<p>x</p>', footer: 'F' });
    expect(plain).toContain(`.spacer-top { height: ${PLAIN_MARGIN_MM.top}mm; }`);
    expect(plain).toContain('<div class="brand">');
    expect(plain).toContain('bluemoonengi@gmail.com');
    const lh = pageHtml({ title: 'T', kicker: 'K', letterhead: true, body: '<p>x</p>', footer: 'F' });
    expect(lh).toContain(`.spacer-top { height: ${LETTERHEAD_MARGIN_MM.top}mm; }`);
    expect(lh).not.toContain('<div class="brand">');
    expect(lh).not.toContain('bluemoonengi@gmail.com');
    expect(lh).toContain('<div class="title">');
  });

  it('escapes the title, subtitle, kicker and footer', () => {
    const html = pageHtml({ title: 'A <b>', subtitle: '"q"', kicker: 'K & K', letterhead: false, body: '', footer: '<f>' });
    expect(html).toContain('<h1>A &lt;b&gt;</h1>');
    expect(html).toContain('&quot;q&quot;');
    expect(html).toContain('K &amp; K');
    expect(html).toContain('<div class="foot">&lt;f&gt;</div>');
  });

  it('names the file after the kind, the names and the day, safe on every file system', () => {
    const long = pdfFileName('Statement', ['Nimal Perera', 'Welimada Primary School Building'], TODAY);
    expect(long.startsWith('Bluemoon-Statement-Nimal-Perera-Welimada-Primary-School-')).toBe(true);
    expect(long.endsWith('-2026-10-22.pdf')).toBe(true);
    expect(long.length).toBeLessThan(80);
    expect(pdfFileName('Tools', [], TODAY)).toBe('Bluemoon-Tools-2026-10-22.pdf');
    expect(pdfFileName('Expenses', [null, 'a/b:c*d?'], TODAY)).toBe('Bluemoon-Expenses-a-b-c-d-2026-10-22.pdf');
    expect(pdfFileName('Statement', ['සුනිල් ප්‍රනාන්දු'], TODAY)).toBe('Bluemoon-Statement-සුනිල්-ප්‍රනාන්දු-2026-10-22.pdf');
  });
});

// ================================================================ the worker statement

describe('the worker statement', () => {
  const statement = (name: string, projectId: string | null = null, lang: 'en' | 'si' | 'ta' = 'en', letterhead = false) => {
    const data = loadWorkerStatement(idOf('workers', name), projectId);
    if (!data) throw new Error('no data');
    return { data, html: buildWorkerStatementHtml({ ...data, lang, letterhead, day: TODAY }) };
  };

  it('prints the figures of v_worker_balance and every live wage entry, newest first', () => {
    const w = idOf('workers', 'Nimal');
    const bal = first<WorkerBalance>('SELECT * FROM v_worker_balance WHERE worker_id = ?', [w]) as WorkerBalance;
    const { data, html } = statement('Nimal');
    expect(bal.earned_cents).toBe(1_750_000);
    expect(boxValues(html)).toEqual([formatLKR(bal.earned_cents), formatLKR(bal.advance_cents), formatLKR(bal.paid_cents), formatLKR(bal.balance_cents)]);
    expect(html).toContain('>To pay</span>');

    const live = first<{ n: number }>('SELECT COUNT(*) AS n FROM wage_entries WHERE worker_id = ? AND deleted_at IS NULL', [w])?.n;
    expect(data.history).toHaveLength(live as number);
    expect(tableRows(section(html, 'History')).rows).toHaveLength(live as number);
    expect(html).toContain(`History <span class="count">${live}</span>`);
    // the history adds up to the balance: work minus what was given
    const signed = data.history.map((e) => (e.kind === 'work' ? e.amount_cents : -e.amount_cents));
    expect(sum(signed)).toBe(bal.balance_cents);
    expect(data.history.map((e) => e.day)).toEqual([...data.history.map((e) => e.day)].sort().reverse());
    expect(html).toContain('Weekly pay'); // the note of the payment
    expect(clean(html)).not.toMatch(/NaN|undefined|null/);
  });

  it('has one line per project from v_project_worker_balance, with that view\'s figures', () => {
    const w = idOf('workers', 'Kamal');
    const lines = all<ProjectWorkerBalance>('SELECT * FROM v_project_worker_balance WHERE worker_id = ?', [w]);
    expect(lines).toHaveLength(2);
    const { data, html } = statement('Kamal');
    expect(data.projects).toHaveLength(2);
    for (const line of lines) {
      const printed = data.projects.find((p) => p.earned_cents === line.earned_cents && p.balance_cents === line.balance_cents);
      expect(printed).toBeDefined();
      expect(printed?.days_total).toBe(line.days_total);
      expect(printed?.paid_cents).toBe(line.paid_cents);
      expect(printed?.advance_cents).toBe(line.advance_cents);
    }
    const perProject = tableRows(section(html, 'Per project'));
    expect(perProject.rows).toHaveLength(2);
    expect(sum(amounts(perProject.rows.join('')))).toBe(sum(lines.map((l) => l.rate_cents + l.earned_cents + l.advance_cents + l.paid_cents + Math.abs(l.balance_cents))));
    expect(html).toContain('Advance for medicine');
  });

  it('for one project prints that project\'s figures only, and no per-project table', () => {
    const w = idOf('workers', 'Kamal');
    const school = idOf('projects', 'Welimada');
    const line = first<ProjectWorkerBalance>('SELECT * FROM v_project_worker_balance WHERE worker_id = ? AND project_id = ?', [w, school]) as ProjectWorkerBalance;
    const { data, html } = statement('Kamal', school);
    expect(data.totals).toEqual({ earned_cents: line.earned_cents, advance_cents: line.advance_cents, paid_cents: line.paid_cents, balance_cents: line.balance_cents });
    expect(data.worker.daily_rate_cents).toBe(line.rate_cents);
    expect(html).not.toContain('<h2>Per project');
    const n = first<{ n: number }>('SELECT COUNT(*) AS n FROM wage_entries WHERE worker_id = ? AND project_id = ? AND deleted_at IS NULL', [w, school])?.n;
    expect(data.history).toHaveLength(n as number);
    expect(html).toContain('Welimada Primary School Building');
    expect(html).not.toContain('Badulla Culvert Repair');
  });

  it('leaves a deleted entry out and the figures still agree with the view', () => {
    const w = idOf('workers', 'Nimal');
    const payment = first<{ id: string }>("SELECT id FROM wage_entries WHERE worker_id = ? AND kind = 'payment'", [w])?.id as string;
    deleteRecord('wage_entries', payment);
    const bal = first<WorkerBalance>('SELECT * FROM v_worker_balance WHERE worker_id = ?', [w]) as WorkerBalance;
    const { data, html } = statement('Nimal');
    expect(bal.paid_cents).toBe(0);
    expect(boxValues(html)[2]).toBe(formatLKR(0));
    expect(data.history.every((e) => e.kind !== 'payment')).toBe(true);
    expect(data.history).toHaveLength(5);
  });

  it('is written in the chosen language, on plain paper or the letterhead', () => {
    for (const lang of ['si', 'ta'] as const) {
      const { html } = statement('Nimal', null, lang, true);
      const L = shareLabels(lang);
      expect(html).toContain(`<html lang="${lang}">`);
      expect(html).toContain(L.statement);
      expect(html).toContain(`<h2>${L.history}`);
      expect(html).toContain(L.earned);
      expect(html).toContain(`.spacer-top { height: ${LETTERHEAD_MARGIN_MM.top}mm; }`);
      expect(html).not.toContain('History');
    }
  });

  it('answers null for a worker who is gone, or a project that is', () => {
    expect(loadWorkerStatement('nope')).toBeNull();
    expect(loadWorkerStatement(idOf('workers', 'Nimal'), 'nope')).toBeNull();
  });
});

// ================================================================ the expenses list

describe('the expenses list', () => {
  const expenses = (filter: ExpenseFilter, sort: 'newest' | 'oldest' | 'highest' | 'lowest' = 'newest') => {
    const data = loadExpenses(filter, sort);
    if (!data) throw new Error('no data');
    const html = buildExpensesHtml({ ...data, filters: [{ label: 'period', value: 'allTime' }], letterhead: false, t, day: TODAY });
    return { data, html };
  };
  const dbTotal = (filter: ExpenseFilter) => {
    const w = expenseWhere(filter);
    return first<{ total: number; count: number }>(`SELECT COALESCE(SUM(e.amount_cents), 0) AS total, COUNT(*) AS count FROM expenses e WHERE ${w.sql}`, w.args) as { total: number; count: number };
  };

  it('prints every row the filter matches (no page cap) and the same total as the Expenses tab', () => {
    const school = idOf('projects', 'Welimada');
    const filter: ExpenseFilter = { projectId: school, range: null, categories: [], methods: [], minCents: null, maxCents: null };
    const expected = dbTotal(filter);
    const { data, html } = expenses(filter);
    expect(expected).toEqual({ total: 49_555_000, count: 9 });
    expect(data.totalCents).toBe(expected.total);
    expect(data.count).toBe(expected.count);
    expect(data.rows).toHaveLength(expected.count);
    const { rows, total } = tableRows(section(html, 'expenses'));
    expect(rows).toHaveLength(9);
    expect(sum(amounts(rows.join('')))).toBe(expected.total);
    expect(amounts(total as string)).toEqual([expected.total]);
    expect(boxValues(html)).toEqual([formatLKR(expected.total), '9']);
    expect(html).toContain('<span class="muted">period:</span> allTime');
    expect(html).toContain('50 bags OPC cement'); // the note under "paid to"
    expect(html).not.toContain('style="width:20%">project</th>'); // one project: no project column
  });

  it('applies the categories, methods, amounts and period of the filter exactly as expenseWhere does', () => {
    const school = idOf('projects', 'Welimada');
    const cases: ExpenseFilter[] = [
      { projectId: school, range: null, categories: ['materials', 'fuel'], methods: [], minCents: null, maxCents: null },
      { projectId: null, range: null, categories: [], methods: ['bank', 'cheque'], minCents: null, maxCents: null },
      { projectId: null, range: null, categories: [], methods: [], minCents: 1_000_000, maxCents: 10_000_000 },
      { projectId: null, range: { from: '2026-10-20', to: '2026-10-23' }, categories: [], methods: [], minCents: null, maxCents: null },
      { projectId: school, range: { from: '2026-10-01', to: '2026-10-02' }, categories: ['food'], methods: ['cash'], minCents: 1, maxCents: 2 },
    ];
    for (const filter of cases) {
      const expected = dbTotal(filter);
      const { data, html } = expenses(filter, 'highest');
      expect({ filter, total: data.totalCents, count: data.count, rows: data.rows.length }).toEqual({ filter, total: expected.total, count: expected.count, rows: expected.count });
      const printed = amounts(tableRows(section(html, 'expenses')).rows.join(''));
      expect(sum(printed)).toBe(expected.total);
      expect(printed).toEqual([...printed].sort((a, b) => b - a)); // highest first
      if (!expected.count) expect(html).toContain('noMatches');
    }
  });

  it('with all projects says which project each expense belongs to, and lists new and odd-cent rows', () => {
    const culvert = idOf('projects', 'Badulla');
    saveExpense({ project_id: culvert, day: TODAY, category: 'other', amount_cents: 1, method: 'cash', paid_to: 'Odd & "quoted" <shop>' });
    const filter: ExpenseFilter = { projectId: null, range: null, categories: [], methods: [], minCents: null, maxCents: null };
    const { data, html } = expenses(filter, 'lowest');
    expect(data.totalCents).toBe(dbTotal(filter).total);
    expect(html).toContain('style="width:20%">project</th>');
    expect(html).toContain('Badulla Culvert Repair');
    expect(html).toContain('Odd &amp; &quot;quoted&quot; &lt;shop&gt;');
    expect(amounts(tableRows(section(html, 'expenses')).rows.join(''))[0]).toBe(1);
    expect(clean(html)).not.toMatch(/NaN|undefined|null/);
  });

  it('answers null for a project that is gone', () => {
    expect(loadExpenses({ projectId: 'nope', range: null, categories: [], methods: [], minCents: null, maxCents: null }, 'newest')).toBeNull();
  });
});

// ================================================================ the workers list

describe('the workers list', () => {
  const list = (projectId: string | null) => {
    const data = loadWorkersList(projectId);
    if (!data) throw new Error('no data');
    return { data, html: buildWorkersListHtml({ ...data, letterhead: false, t, day: TODAY }) };
  };

  it('a project: every worker on the roster with the figures of v_project_worker_balance, and a totals row', () => {
    const school = idOf('projects', 'Welimada');
    const view = all<ProjectWorkerBalance>('SELECT * FROM v_project_worker_balance WHERE project_id = ?', [school]);
    expect(view).toHaveLength(5);
    const { data, html } = list(school);
    expect(data.rows).toHaveLength(5);
    const { rows, total } = tableRows(section(html, 'projectWorkers'));
    expect(rows).toHaveLength(5);
    const sumOf = (f: (r: ProjectWorkerBalance) => number) => sum(view.map(f));
    expect(amounts(total as string)).toEqual([sumOf((r) => r.earned_cents), sumOf((r) => r.advance_cents), sumOf((r) => r.paid_cents), sumOf((r) => r.balance_cents)]);
    expect(boxValues(html)).toEqual(['5', formatLKR(sumOf((r) => Math.max(0, r.balance_cents))), formatLKR(sumOf((r) => Math.max(0, -r.balance_cents)))]);
    for (const r of view) {
      expect(html).toContain(r.name);
      expect(amounts(rows.find((row) => row.includes(r.name)) as string)).toEqual([r.rate_cents, r.earned_cents, r.advance_cents, r.paid_cents, Math.abs(r.balance_cents)].filter((v, i) => i < 4 || v !== 0));
    }
  });

  it('all projects: every worker with the figures of v_worker_balance, those who left marked', () => {
    const view = all<WorkerBalance>('SELECT * FROM v_worker_balance');
    expect(view).toHaveLength(6);
    const { data, html } = list(null);
    expect(data.rows).toHaveLength(6);
    const { rows, total } = tableRows(section(html, 'allWorkers'));
    expect(rows).toHaveLength(6);
    expect(amounts(total as string)).toEqual([sum(view.map((r) => r.earned_cents)), sum(view.map((r) => r.advance_cents)), sum(view.map((r) => r.paid_cents)), sum(view.map((r) => r.balance_cents))]);
    expect(html).not.toContain('workerLeft');
    // the per-worker days are those of their work entries
    const kamal = data.rows.find((r) => r.name === 'Kamal Silva');
    expect(kamal?.days_total).toBe(first<{ d: number }>("SELECT SUM(days) AS d FROM wage_entries WHERE worker_id = ? AND kind = 'work' AND deleted_at IS NULL", [idOf('workers', 'Kamal')])?.d);
  });

  it('a worker who was removed from the project leaves its roster; an inactive one is marked', () => {
    const school = idOf('projects', 'Welimada');
    const anura = idOf('workers', 'Anura');
    unassignWorker(school, anura);
    const ruwan = first<Worker>('SELECT * FROM workers WHERE id = ?', [idOf('workers', 'Ruwan')]) as Worker;
    saveWorker({ id: ruwan.id, name: ruwan.name, phone: ruwan.phone, trade: ruwan.trade, daily_rate_cents: ruwan.daily_rate_cents, active: false });
    const { data, html } = list(school);
    expect(data.rows.map((r) => r.name)).not.toContain('Anura Kumara');
    expect(data.rows.find((r) => r.name === 'Ruwan Jayasinghe')?.active).toBe(0);
    expect(html).toContain('Ruwan Jayasinghe <span class="tag">workerLeft</span>');
    expect(clean(html)).not.toMatch(/NaN|undefined|null/);
  });

  it('answers null for a project that is gone', () => {
    expect(loadWorkersList('nope')).toBeNull();
  });
});

// ================================================================ the day sheet

describe('the day sheet', () => {
  const sheet = (projectId: string, day: string) => {
    const data = loadDaySheet(projectId, day);
    if (!data) throw new Error('no data');
    return { data, html: buildDaySheetHtml({ ...data, letterhead: false, t, day: TODAY }) };
  };
  const dbUnpaid = (projectId: string, day: string) =>
    unpaidForDay(
      all<WageDay>('SELECT * FROM v_wage_day WHERE project_id = ? AND day = ?', [projectId, day]),
      all<ProjectWorkerBalance>('SELECT * FROM v_project_worker_balance WHERE project_id = ?', [projectId]),
    );

  it('one row per worker of v_wage_day, and the unpaid total is unpaidForDay', () => {
    const school = idOf('projects', 'Welimada');
    const view = all<WageDay>('SELECT * FROM v_wage_day WHERE project_id = ? AND day = ?', [school, TODAY]);
    expect(view).toHaveLength(5);
    const { data, html } = sheet(school, TODAY);
    expect(data.rows).toHaveLength(5);
    expect(sum(data.rows.map((r) => r.unpaid_cents))).toBe(dbUnpaid(school, TODAY));
    expect(sum(data.rows.map((r) => r.work_cents))).toBe(sum(view.map((r) => r.work_cents)));
    const { rows, total } = tableRows(section(html, 'todaysWork'));
    expect(rows).toHaveLength(5);
    expect(amounts(total as string)).toEqual([sum(view.map((r) => r.work_cents)), sum(view.map((r) => r.paid_cents)), dbUnpaid(school, TODAY)]);
    expect(boxValues(html)).toEqual(['5', formatLKR(sum(view.map((r) => r.work_cents))), formatLKR(sum(view.map((r) => r.paid_cents))), formatLKR(dbUnpaid(school, TODAY))]);
    expect(html).toContain('<div class="cap">supervisor</div>');
    expect(html).toContain('<div class="cap">checkedBy</div>');
    expect(html).toContain('22 Oct 2026');
  });

  it('an advance caps what is unpaid, a payment today counts, a worker off the roster is listed but owed nothing here', () => {
    const school = idOf('projects', 'Welimada');
    const day = '2026-10-21';
    const kamal = idOf('workers', 'Kamal');
    const anura = idOf('workers', 'Anura');
    // Kamal: Rs 2,200 today, Rs 5,000 advance earlier; Anura worked on this day too, then left the roster
    saveWageEntry({ worker_id: kamal, project_id: school, day, kind: 'advance', amount_cents: 1_000_000 });
    recordWorkDay({ project_id: school, worker_id: anura, day, days: 1 });
    payWages({ project_id: school, worker_id: idOf('workers', 'Sunil'), day, amount_cents: 100 });
    unassignWorker(school, anura);
    const { data, html } = sheet(school, day);
    expect(data.rows.map((r) => r.name)).toContain('Anura Kumara');
    expect(data.rows.find((r) => r.name === 'Anura Kumara')?.unpaid_cents).toBe(0);
    expect(data.rows.find((r) => r.name === 'Kamal Silva')?.unpaid_cents).toBe(0); // the advance covers the wage
    expect(sum(data.rows.map((r) => r.unpaid_cents))).toBe(dbUnpaid(school, day));
    expect(html).toContain('<th class="n" style="width:15%">advances</th>'); // the advances column appears when there is one
    expect(amounts(tableRows(section(html, 'todaysWork')).total as string).at(-1)).toBe(dbUnpaid(school, day));
  });

  it('a day with nothing recorded prints zeros and says so; a bad day or a missing project is null', () => {
    const school = idOf('projects', 'Welimada');
    const { data, html } = sheet(school, '2026-09-01');
    expect(data.rows).toEqual([]);
    expect(boxValues(html)).toEqual(['0', formatLKR(0), formatLKR(0), formatLKR(0)]);
    expect(html).toContain('noWorkRecorded');
    expect(loadDaySheet(school, '22-10-2026')).toBeNull();
    expect(loadDaySheet('nope', TODAY)).toBeNull();
  });
});

// ================================================================ the tools register

describe('the tools register', () => {
  const register = () => {
    const rows = loadToolsRegister();
    return { rows, html: buildToolsRegisterHtml({ rows, letterhead: false, t, day: TODAY }) };
  };

  it('lists every live tool with whether it is out or in store, who has it and since when', () => {
    const tools = all<{ name: string }>('SELECT name FROM tools WHERE deleted_at IS NULL');
    const out = all<{ name: string }>('SELECT name FROM v_tool_status WHERE is_out = 1');
    expect(tools).toHaveLength(5);
    expect(out).toHaveLength(2);
    const { rows, html } = register();
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.is_out)).toHaveLength(2);
    expect(rows.filter((r) => !r.is_out)).toHaveLength(3);
    expect(boxValues(html)).toEqual(['5', '2', '3']);
    expect(tableRows(section(html, 'tools')).rows).toHaveLength(5);
    for (const tool of tools) expect(html).toContain(tool.name);
    const drill = rows.find((r) => r.name === 'Hilti drill');
    expect(drill).toMatchObject({ is_out: 1, with_name: 'Sunil Fernando', project_name: 'Welimada Primary School Building', last_day: '2026-10-20', condition: 'Good' });
    expect(rows.find((r) => r.name === 'Aluminium ladder 12 ft')).toMatchObject({ is_out: 0, last_day: '2026-10-18', condition: 'One rung loose' });
    expect(rows.find((r) => r.name === 'Vibrator poker')).toMatchObject({ is_out: 0, with_name: null, last_day: null });
    expect(rows.map((r) => r.is_out)).toEqual([1, 1, 0, 0, 0]); // out first
    expect(html).toContain('<span class="tag out">out</span>');
    expect(html).toContain('<span class="tag in">inStore</span>');
  });

  it('follows deletions and movements: a deleted tool is gone, a returned tool is in store, someone outside is named', () => {
    const ladder = idOf('tools', 'Aluminium');
    deleteRecord('tools', ladder);
    moveTool({ tool_id: idOf('tools', 'Hilti'), kind: 'return', project_id: idOf('projects', 'Welimada'), day: TODAY });
    moveTool({ tool_id: idOf('tools', 'Vibrator'), kind: 'issue', project_id: idOf('projects', 'Badulla'), taken_by: 'Mr Jayasiri (RDA)', day: TODAY });
    const { rows, html } = register();
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.name === 'Hilti drill')?.is_out).toBe(0);
    expect(rows.find((r) => r.name === 'Vibrator poker')).toMatchObject({ is_out: 1, with_name: 'Mr Jayasiri (RDA)', project_name: 'Badulla Culvert Repair' });
    expect(boxValues(html)).toEqual(['4', '2', '2']);
    expect(clean(html)).not.toMatch(/NaN|undefined|null/);
  });

  it('an empty register says so', () => {
    for (const row of all<{ id: string }>('SELECT id FROM tools')) deleteRecord('tools', row.id);
    const { rows, html } = register();
    expect(rows).toEqual([]);
    expect(html).toContain('noTools');
  });
});

// ================================================================ the notes list

describe('the notes list', () => {
  const notes = (projectId: string | null) => {
    const data = loadNotes(projectId);
    if (!data) throw new Error('no data');
    return { data, html: buildNotesHtml({ ...data, letterhead: false, t, day: TODAY }) };
  };

  it('a project: its live notes, newest first, with the day, the weather and the whole text', () => {
    const school = idOf('projects', 'Welimada');
    const { data, html } = notes(school);
    expect(data.notes).toHaveLength(2);
    expect(data.notes.map((n) => n.day)).toEqual([TODAY, '2026-10-21']);
    expect(html).toContain('<h2>siteNotes <span class="count">2</span></h2>');
    expect(html).toContain('weather_sunny');
    expect(html).toContain('weather_rain');
    expect(html).toContain('First-floor slab shuttering completed on the east side. Waiting for the bar-bending inspection before pouring.');
    expect(html).not.toContain('Old pipes removed');
    expect(html).not.toContain('<th style="width:20%">project</th>');
  });

  it('all projects: every live project\'s notes with the project named; line breaks and markup in a note are kept safe', () => {
    const culvert = idOf('projects', 'Badulla');
    saveNote({ project_id: culvert, day: '2026-10-19', body: 'Line one\r\nLine <two> & "three"', weather: 'hail' });
    deleteRecord('site_notes', first<{ id: string }>("SELECT id FROM site_notes WHERE body LIKE 'Rain after%'")?.id as string);
    const { data, html } = notes(null);
    expect(data.notes).toHaveLength(3);
    expect(html).toContain('<th style="width:20%">project</th>');
    expect(html).toContain('Badulla Culvert Repair');
    expect(html).toContain('<td class="pre">Line one\nLine &lt;two&gt; &amp; &quot;three&quot;</td>');
    expect(html).not.toContain('Rain after 3 pm');
    expect(html).not.toContain('hail'); // an unknown weather word is not printed
    expect(clean(html)).not.toMatch(/NaN|undefined|null/);
  });

  it('a project without notes says so; a project that is gone is null', () => {
    const { data, html } = notes(idOf('projects', 'Bandarawela'));
    expect(data.notes).toEqual([]);
    expect(html).toContain('noNotes');
    expect(loadNotes('nope')).toBeNull();
  });
});

// ================================================================ the messages of the two new share kinds

describe('the workers list message (the Workers tab as text)', () => {
  const FOOTER = 'Developed with Bluemoon Site · 22 Oct 2026';

  it('a project: every worker on the roster with what is owed, and the totals of v_project_worker_balance', () => {
    const school = idOf('projects', 'Welimada');
    // Anura was paid ahead: an advance bigger than his one day of work
    saveWageEntry({ worker_id: idOf('workers', 'Anura'), project_id: school, day: TODAY, kind: 'advance', amount_cents: 500_000 });
    const view = all<ProjectWorkerBalance>('SELECT * FROM v_project_worker_balance WHERE project_id = ?', [school]);
    expect(view).toHaveLength(5);
    const ahead = sum(view.map((r) => Math.max(0, -r.balance_cents)));
    expect(ahead).toBe(280_000); // the case exists

    const text = buildShareMessage('workersList', school, 'en') as string;
    const lines = text.split('\n');
    expect(lines[0]).toBe('*Workers — Welimada Primary School Building*');
    expect(lines.at(-1)).toBe(FOOTER);
    for (const r of view) {
      const phrase = r.balance_cents > 0 ? `to pay ${formatLKR(r.balance_cents)}` : r.balance_cents < 0 ? `advance over ${formatLKR(-r.balance_cents)}` : 'settled';
      expect({ name: r.name, found: lines.some((l) => l.startsWith(r.name) && l.includes(phrase)) }).toEqual({ name: r.name, found: true });
    }
    expect(text).toContain('Workers: 5');
    expect(text).toContain(`To pay: ${formatLKR(sum(view.map((r) => Math.max(0, r.balance_cents))))}`);
    expect(text).toContain(`Paid ahead: ${formatLKR(ahead)}`);
  });

  it('all projects: every worker with the overall balance of v_worker_balance; a worker who left is marked', () => {
    const ruwan = first<Worker>('SELECT * FROM workers WHERE id = ?', [idOf('workers', 'Ruwan')]) as Worker;
    saveWorker({ id: ruwan.id, name: ruwan.name, phone: ruwan.phone, trade: ruwan.trade, daily_rate_cents: ruwan.daily_rate_cents, active: false });
    const view = all<WorkerBalance>('SELECT * FROM v_worker_balance');
    const text = buildShareMessage('workersList', null, 'en') as string;
    expect(text.split('\n')[0]).toBe('*Workers — All projects*');
    expect(text).toContain(`Workers: ${view.length}`);
    expect(text).toContain(`To pay: ${formatLKR(sum(view.map((r) => Math.max(0, r.balance_cents))))}`);
    const own = view.find((r) => r.name === 'Ruwan Jayasinghe') as WorkerBalance;
    expect(text).toContain(`Ruwan Jayasinghe — Bar bender — to pay ${formatLKR(own.balance_cents)} — Left`);
  });

  it.each(['si', 'ta'] as const)('%s: the fixed words are that language\'s own', (lang) => {
    const L = SHARE_LABELS[lang];
    const text = buildShareMessage('workersList', null, lang) as string;
    expect(text.split('\n')[0]).toBe(`*${L.workers} — ${L.allProjects}*`);
    expect(text).toContain(`${L.workers}: 6`);
    expect(text).toContain(`${L.toPay}: `);
    expect(text).not.toMatch(/to pay|Workers/);
  });

  it('a project without workers says so; a project that is gone gives nothing to share', () => {
    expect(buildShareMessage('workersList', idOf('projects', 'Bandarawela'), 'en')).toBe(['*Workers — Bandarawela Drain Renovation*', 'No workers yet', '', FOOTER].join('\n'));
    expect(buildShareMessage('workersList', 'nope', 'en')).toBeNull();
  });
});

describe('the notes list message (the Site notes screen as text)', () => {
  it('a project: its notes, newest first, one line each with the day, the weather and the text', () => {
    const text = buildShareMessage('notesList', idOf('projects', 'Welimada'), 'en') as string;
    const lines = text.split('\n');
    expect(lines[0]).toBe('*Site notes — Welimada Primary School Building*');
    expect(text).toContain('Site notes: 2');
    const newest = lines.findIndex((l) => l.startsWith('22 Oct 2026 — Sunny — First-floor slab shuttering completed'));
    const older = lines.findIndex((l) => l.startsWith('21 Oct 2026 — Rain — Rain after 3 pm'));
    expect(newest).toBeGreaterThan(0);
    expect(older).toBeGreaterThan(newest);
    expect(text).not.toContain('Old pipes removed'); // another project's
  });

  it('all projects: each line names its project, markup is taken out of the text, and a long list is capped with "… and N more"', () => {
    const culvert = idOf('projects', 'Badulla');
    for (let i = 0; i < 20; i++) saveNote({ project_id: culvert, day: addDays(TODAY, -(2 + i)), body: `Pour ${i} *bold* \`code\`` });
    const text = buildShareMessage('notesList', null, 'en') as string;
    expect(text.split('\n')[0]).toBe('*Site notes — All projects*');
    // 2 on the school, 1 on the culvert and the 20 above: 15 are listed
    expect(text).toContain('Site notes: 23');
    expect(text).toContain('… and 8 more');
    expect(text).toContain('22 Oct 2026 — Badulla Culvert Repair — Cloudy — Old pipes removed');
    expect(text).toContain('Pour 0 bold code');
    expect(text).not.toContain('*bold*');
    expect(text).not.toContain('`');
    expect(text.length).toBeLessThanOrEqual(3500);
  });

  it.each(['si', 'ta'] as const)('%s: the fixed words are that language\'s own', (lang) => {
    const L = SHARE_LABELS[lang];
    const text = buildShareMessage('notesList', idOf('projects', 'Welimada'), lang) as string;
    expect(text.split('\n')[0]).toBe(`*${L.siteNotes} — Welimada Primary School Building*`);
    expect(text).toContain(`${L.siteNotes}: 2`);
    expect(text).toContain(L.weather_sunny);
    expect(text).toContain(L.weather_rain);
  });

  it('a project without notes says so; a project that is gone gives nothing to share', () => {
    expect(buildShareMessage('notesList', idOf('projects', 'Bandarawela'), 'en')).toContain('No site notes yet');
    expect(buildShareMessage('notesList', 'nope', 'en')).toBeNull();
  });
});
