/**
 * The printed project report must say the same as the screens: its headline figures come from
 * v_project_cost, its tables from the rows, and the two have to agree to the cent.
 */
import { all, first } from '@/db';
import { deleteRecord, moveTool, payWages, recordWorkDay, saveExpense, saveWageEntry } from '@/db/repo';
import type { Project, ProjectCost } from '@/db/types';
import { collectProject } from '@/lib/bundle';
import { buildReportHtml } from '@/lib/reportHtml';
import { formatLKR, parseCents } from '@/lib/money';
import { resetDb, seedDemo } from '@/test-utils';
import { useClock } from '@/test-utils/dataKit';

jest.setTimeout(60_000);

let clock: ReturnType<typeof useClock>;
beforeEach(() => {
  resetDb();
  clock = useClock(new Date(2026, 9, 22, 12, 0, 0));
  seedDemo();
});
afterEach(() => clock.restore());

const projectId = (like: string) => first<{ id: string }>('SELECT id FROM projects WHERE name LIKE ?', [`${like}%`])?.id as string;

function report(id: string, letterhead = false): string {
  return buildReportHtml({
    project: first<Project>('SELECT * FROM projects WHERE id = ?', [id]) as Project,
    tables: collectProject(id), // as the PDF export does: deleted rows are in the tables, the report must leave them out
    cost: first<ProjectCost>('SELECT * FROM v_project_cost WHERE project_id = ?', [id]),
    photoCount: 0,
    skippedPhotos: 0,
    letterhead,
    t: (key) => key, // the keys themselves, so sections can be found without a language
    day: '2026-10-22',
  });
}

/** The html between a section heading and the next one. */
function section(html: string, key: string): string {
  const start = html.indexOf(`<h2>${key}`);
  if (start < 0) return '';
  const next = html.indexOf('<h2>', start + 4);
  return html.slice(start, next < 0 ? html.indexOf('<div class="foot">') : next);
}

/** The row of boxes with the headline figures (the grid before the first section). */
function headline(html: string): string {
  return html.slice(html.indexOf('<div class="grid">'), html.indexOf('<h2>'));
}

/** Every "Rs 1,234.50" in the html, in cents. */
function amounts(html: string): number[] {
  return [...html.matchAll(/Rs ([\d,]+(?:\.\d\d)?)/g)].map((m) => parseCents(m[1]) as number);
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe.each([false, true])('the report (letterhead: %p)', (letterhead) => {
  it('headline figures are the cost view: total = materials & other + labour', () => {
    const id = projectId('Welimada');
    const html = report(id, letterhead);
    expect(amounts(headline(html)).slice(0, 3)).toEqual([49_555_000 + 6_180_000, 49_555_000, 6_180_000]);
    expect(html).toContain(formatLKR(55_735_000)); // Rs 557,350
  });

  it('the by-category table adds up to the total cost: the expense categories plus a wages row', () => {
    const id = projectId('Welimada');
    const cats = amounts(section(report(id, letterhead), 'byCategory'));
    expect(cats).toHaveLength(9);
    expect(cats).toContain(6_180_000); // wages, as on the project screen
    expect(sum(cats)).toBe(49_555_000 + 6_180_000);
  });

  it('the expense list adds up to the same figure, and has one line per live expense', () => {
    const id = projectId('Welimada');
    const html = section(report(id, letterhead), 'expenses');
    expect(sum(amounts(html))).toBe(49_555_000);
    expect(html.match(/<tr><td/g)).toHaveLength(9);
  });

  it('the workers table adds up to labour earned and money given', () => {
    const id = projectId('Welimada');
    const html = section(report(id, letterhead), 'workers');
    const cells = amounts(html); // earned, paid, earned, paid, ...
    expect(cells).toHaveLength(10);
    expect(sum(cells.filter((_, i) => i % 2 === 0))).toBe(6_180_000);
    expect(sum(cells.filter((_, i) => i % 2 === 1))).toBe(2_900_000);
  });
});

describe('the tools section', () => {
  /** A few words in English, so the stock lines can be read as the owner reads them. */
  const words: Record<string, string> = { inStoreOf: '{n} of {total} in store', leftCount: '{n} left', issue: 'Issue', return: 'Return' };
  const english = (id: string) =>
    buildReportHtml({
      project: first<Project>('SELECT * FROM projects WHERE id = ?', [id]) as Project,
      tables: collectProject(id),
      cost: first<ProjectCost>('SELECT * FROM v_project_cost WHERE project_id = ?', [id]),
      photoCount: 0,
      skippedPhotos: 0,
      letterhead: false,
      t: (key) => words[key] ?? key,
      day: '2026-10-22',
    });

  it('every movement line carries its quantity: 1 for a single piece, the count for several, the amount and unit for a material', () => {
    const html = section(report(projectId('Welimada')), 'tools');
    expect(html.match(/<tr><td/g)).toHaveLength(7); // drill, mixer, the ladder out and back, the wheelbarrows out and back, the cement
    const qty = [...html.matchAll(/<td class="n">([^<]*)<\/td>/g)].map((m) => m[1]);
    expect(qty).toHaveLength(7);
    expect(qty.filter((q) => q === '1')).toHaveLength(5); // drill, mixer, ladder twice, one wheelbarrow back
    expect(qty).toContain('3'); // three wheelbarrows out
    expect(qty).toContain('20 bags');
    expect(html).not.toMatch(/NaN|undefined|null/);
  });

  it('above the table, one line per tool with several pieces and per material says what is left; a single piece has no line', () => {
    const html = section(english(projectId('Welimada')), 'tools');
    expect(html).toContain('<div class="stock"><div>Cement: 80 bags left</div><div>Wheelbarrow: 2 of 4 in store</div></div>');
    expect(html).not.toContain('Aluminium ladder 12 ft:');
    expect(html).not.toContain('Hilti drill:');
    expect(html.indexOf('class="stock"')).toBeLessThan(html.indexOf('<table'));
  });

  it('the stock lines follow the movements: a return raises what is in store; a deleted movement is left out of the table and the line', () => {
    const id = projectId('Welimada');
    const barrow = first<{ id: string }>("SELECT id FROM tools WHERE name = 'Wheelbarrow'")?.id as string;
    const ruwan = first<{ id: string }>("SELECT id FROM workers WHERE name LIKE 'Ruwan%'")?.id as string;
    moveTool({ tool_id: barrow, kind: 'return', project_id: id, worker_id: ruwan, day: '2026-10-22', qty_milli: 1000 });
    expect(section(english(id), 'tools')).toContain('<div>Wheelbarrow: 3 of 4 in store</div>');
    const cementIssue = first<{ id: string }>("SELECT m.id FROM tool_movements m JOIN tools t ON t.id = m.tool_id WHERE t.name = 'Cement'")?.id as string;
    deleteRecord('tool_movements', cementIssue);
    const html = section(english(id), 'tools');
    // the cement has no live movement left, so it is neither a row nor a stock line (the deleted row travels in the bundle but is not printed)
    expect(html).not.toContain('Cement');
    expect(html).toContain('<div>Wheelbarrow: 3 of 4 in store</div>');
    expect(html.match(/<tr><td/g)).toHaveLength(7 - 1 + 1); // the deleted issue is gone, the new return is in
  });

  it('a project whose tools were never counted (every one a single piece) prints no stock lines', () => {
    const id = projectId('Badulla');
    const saman = first<{ id: string }>("SELECT id FROM workers WHERE name LIKE 'Saman%'")?.id as string;
    const station = first<{ id: string }>("SELECT id FROM tools WHERE name = 'Total station'")?.id as string;
    moveTool({ tool_id: station, kind: 'issue', project_id: id, worker_id: saman, day: '2026-10-22' });
    const html = section(english(id), 'tools');
    expect(html).not.toContain('class="stock"');
    // and the table is the one it always was: no Quantity column until something is counted
    expect(html).not.toContain('quantity');
    expect([...html.matchAll(/<td class="n">([^<]*)<\/td>/g)].map((m) => m[1])).toEqual([]);
    expect(html.match(/<th[ >]/g)).toHaveLength(4); // four column headings (not <thead>)
  });
});

describe('after corrections', () => {
  it('deleted expenses and wage entries are left out of every table and the headline matches', () => {
    const id = projectId('Welimada');
    const biggest = first<{ id: string; amount_cents: number }>('SELECT id, amount_cents FROM expenses WHERE project_id = ? ORDER BY amount_cents DESC', [id]);
    deleteRecord('expenses', biggest?.id as string);
    const entry = first<{ id: string }>("SELECT id FROM wage_entries WHERE project_id = ? AND kind = 'payment' LIMIT 1", [id])?.id as string;
    deleteRecord('wage_entries', entry);

    const html = report(id);
    const cost = first<ProjectCost>('SELECT * FROM v_project_cost WHERE project_id = ?', [id]) as ProjectCost;
    expect(cost.expense_cents).toBe(49_555_000 - (biggest?.amount_cents as number));
    expect(sum(amounts(section(html, 'byCategory')))).toBe(cost.expense_cents + cost.labour_cents); // the categories plus the wages row
    expect(sum(amounts(section(html, 'expenses')))).toBe(cost.expense_cents);
    const cells = amounts(section(html, 'workers'));
    expect(sum(cells.filter((_, i) => i % 2 === 0))).toBe(cost.labour_cents);
    expect(sum(cells.filter((_, i) => i % 2 === 1))).toBe(cost.labour_paid_cents);
  });

  it('odd cents are printed exactly', () => {
    const id = projectId('Badulla');
    saveExpense({ project_id: id, day: '2026-10-22', category: 'other', amount_cents: 1, method: 'cash' });
    saveExpense({ project_id: id, day: '2026-10-22', category: 'other', amount_cents: 9_999_999_999, method: 'cash' }); // the largest odd amount below the Rs 100,000,000 limit
    const w = first<{ id: string }>("SELECT id FROM workers WHERE name LIKE 'Saman%'")?.id as string;
    recordWorkDay({ project_id: id, worker_id: w, day: '2026-10-10', days: 0.5, amount_cents: 175_025 });
    saveWageEntry({ worker_id: w, project_id: id, day: '2026-10-10', kind: 'advance', amount_cents: 12_345 });
    payWages({ project_id: id, worker_id: w, day: '2026-10-11', amount_cents: 7 });

    const html = report(id);
    const cost = first<ProjectCost>('SELECT * FROM v_project_cost WHERE project_id = ?', [id]) as ProjectCost;
    expect(html).toContain('Rs 99,999,999.99');
    expect(sum(amounts(section(html, 'expenses')))).toBe(cost.expense_cents);
    const cells = amounts(section(html, 'workers'));
    expect(sum(cells.filter((_, i) => i % 2 === 0))).toBe(cost.labour_cents);
    expect(sum(cells.filter((_, i) => i % 2 === 1))).toBe(cost.labour_paid_cents);
    expect(cost.labour_paid_cents).toBe(350_000 + 12_345 + 7);
    expect(all('SELECT 1 FROM v_project_cost')).toHaveLength(3);
  });

  it('a project with nothing recorded prints zeros, not blanks or NaN', () => {
    const id = projectId('Bandarawela');
    const html = report(id);
    expect(html.replace(/data:[^"')]+/g, '')).not.toMatch(/NaN|undefined|null/); // (the logo picture is base64 text, which can contain anything)
    expect(amounts(headline(html)).slice(0, 3)).toEqual([0, 0, 0]);
  });
});
