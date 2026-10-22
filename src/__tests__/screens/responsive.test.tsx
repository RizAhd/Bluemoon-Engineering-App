/**
 * Every screen on every kind of Android window the site staff carry (skill: bluemoon-mobile-ui/responsive.md):
 *
 *   320 x 640    small phone, or a phone with the display size set to "large"
 *   360 x 800    the base design frame
 *   412 x 915    a large phone
 *   600 x 960    tablet portrait (medium width class: gutter 24, content column 640, centred)
 *   960 x 600    tablet landscape (medium, wide and not tall)
 *   800 x 360    phone landscape / split screen (under 480 tall: footers scroll with the content)
 *   320 x 640 at text size 2.0, 412 x 915 at text size 1.3
 *
 * in English and Sinhala, light then dark (smokeScreen switches the scheme on the mounted screen), with data
 * chosen to be long: a 90-character project name, a 60-character worker name, an expense of Rs 98,765,432.10
 * to a supplier with an 80-character name.
 *
 * Beyond "renders, no undefined / NaN, the key text is there", each screen is checked for what can be seen
 * without a device:
 *   - no row (flexDirection row, no wrap) has a long text as a direct child that cannot shrink: such a text
 *     is as wide as its words and runs off the screen on a small phone or at a large text size;
 *   - the content column is centred and capped at 640 from 600 wide, and never capped on a phone;
 *   - on a window under 480 tall the screen's Save / primary footer button is inside the scrolling content,
 *     and on taller windows it is not (it stays sticky).
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import type { ReactElement } from 'react';

import TodayScreen from '@/app/(tabs)/index';
import ExpensesScreen from '@/app/(tabs)/expenses';
import ProjectsScreen from '@/app/(tabs)/projects';
import ToolsScreen from '@/app/(tabs)/tools';
import WorkersScreen from '@/app/(tabs)/workers';
import AddSheet from '@/app/add';
import BackupScreen from '@/app/backup';
import CompanyScreen from '@/app/company';
import EstimateHub from '@/app/estimate/[id]';
import EstimateForm from '@/app/estimate/form';
import EstimatesScreen from '@/app/estimate/index';
import EstimateItemScreen from '@/app/estimate/item';
import EstimatePaymentScreen from '@/app/estimate/payment';
import ExpenseForm from '@/app/expense/form';
import MoreScreen from '@/app/more';
import NoteForm from '@/app/note/form';
import NotesScreen from '@/app/notes';
import ProblemScreen from '@/app/problem';
import ProjectDetail from '@/app/project/[id]';
import ProjectForm from '@/app/project/form';
import ToolDetail from '@/app/tool/[id]';
import ToolForm from '@/app/tool/form';
import ToolMove from '@/app/tool/move';
import WageForm from '@/app/wage/form';
import TodaysWorkScreen from '@/app/wage/today';
import WorkerDetail from '@/app/worker/[id]';
import WorkerAssign from '@/app/worker/assign';
import WorkerForm from '@/app/worker/form';
import { first } from '@/db';
import { assignWorker, recordWorkDay, saveExpense, saveNote, saveProject, saveWorker } from '@/db/repo';
import { today } from '@/lib/dates';
import { projectId, setCurrent, toolId, workerId } from '@/test-utils/screenData';
import { screen, setRouteParams, smokeScreen, type Lang, type Tr, type Variant } from '@/test-utils/screenKit';

// ---------------------------------------------------------------- long data

const LONG_PROJECT = 'Uva Provincial Council Rural Hospital Extension and Staff Quarters, Phase Two, Welimada';
const LONG_CLIENT = 'Provincial Director of Health Services, Uva Province, Badulla';
const LONG_WORKER = 'Wijesinghe Mudiyanselage Chandana Kumara Bandara';
const LONG_SUPPLIER = 'Sri Lanka Hardware and Building Material Suppliers (Private) Limited, Welimada Branch';
const BIG_AMOUNT = 'Rs 98,765,432.10';

function addLongData() {
  const project = saveProject({ name: LONG_PROJECT, client: LONG_CLIENT, location: 'Welimada', contract_cents: 9_999_999_999_00, status: 'active' });
  const worker = saveWorker({ name: LONG_WORKER, trade: 'Carpenter and shuttering foreman', daily_rate_cents: 12_345_00 });
  assignWorker({ project_id: project, worker_id: worker, rate_cents: 12_345_00 });
  recordWorkDay({ project_id: project, worker_id: worker, day: today(), days: 1.5 });
  saveExpense({ project_id: project, day: today(), category: 'materials', amount_cents: 98_765_432_10, paid_to: LONG_SUPPLIER, method: 'bank', note: 'Cement, steel and roofing for the whole of phase two' });
  saveNote({ project_id: project, day: today(), body: 'Long day on site. '.repeat(20), weather: 'rain' });
}

const longProject = () => projectId(LONG_PROJECT);
const draftEstimate = () => first<{ id: string }>("SELECT id FROM estimates WHERE status = 'draft' AND deleted_at IS NULL")?.id ?? '';

// ---------------------------------------------------------------- what can be checked without a device

type Json = { type: string; props: Record<string, unknown>; children: (Json | string)[] | null };

function tree(): Json | null {
  return screen.toJSON() as Json | null;
}

function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return style.reduce<Record<string, unknown>>((a, s) => ({ ...a, ...flat(s) }), {});
  return style && typeof style === 'object' ? (style as Record<string, unknown>) : {};
}

function textOf(node: Json | string): string {
  if (typeof node === 'string') return node;
  return (node.children ?? []).map(textOf).join('');
}

function walk(node: Json | string | null, visit: (n: Json, parents: Json[]) => void, parents: Json[] = []) {
  if (!node || typeof node === 'string') return;
  visit(node, parents);
  for (const c of node.children ?? []) walk(c, visit, [...parents, node]);
}

/** From this many characters a text is wider than what a 320 dp row leaves beside an icon and a value at text size 2. */
const LONG_TEXT = 20;

/** A long text that sits directly in a row and can neither shrink nor is capped: it overflows on a small window. */
function rowOverflows(): string[] {
  const out: string[] = [];
  walk(tree(), (n, parents) => {
    // a chip bar that scrolls sideways has all the width it wants
    if (parents.some((p) => p.type === 'RCTScrollView' && p.props.horizontal)) return;
    const s = flat(n.props.style);
    if (s.flexDirection !== 'row' || s.flexWrap === 'wrap') return;
    for (const child of n.children ?? []) {
      if (typeof child === 'string' || child.type !== 'Text') continue;
      const text = textOf(child);
      if (text.length < LONG_TEXT) continue;
      const cs = flat(child.props.style);
      const canShrink = (typeof cs.flex === 'number' && cs.flex > 0) || (typeof cs.flexShrink === 'number' && cs.flexShrink > 0) || cs.maxWidth != null || cs.width != null;
      if (!canShrink) out.push(text.slice(0, 60));
    }
  });
  return out;
}

/** Every maxWidth used in the tree. */
function maxWidths(): unknown[] {
  const out: unknown[] = [];
  walk(tree(), (n) => {
    const s = flat(n.props.contentContainerStyle ?? null);
    if (s.maxWidth != null) out.push(s.maxWidth);
    const v = flat(n.props.style);
    if (v.maxWidth != null) out.push(v.maxWidth);
  });
  return out;
}

/** Is the element with this exact accessibility label inside a scroll view (as opposed to a sticky footer)? */
function labelInsideScroll(label: string): boolean | null {
  let found: boolean | null = null;
  walk(tree(), (n, parents) => {
    if (found !== null || n.props.accessibilityLabel !== label) return;
    found = parents.some((p) => p.type === 'RCTScrollView');
  });
  return found;
}

// ---------------------------------------------------------------- the matrix

interface Size {
  name: string;
  width: number;
  height: number;
  fontScale?: number;
}

const SIZES: Size[] = [
  { name: '320x640', width: 320, height: 640 },
  { name: '360x800', width: 360, height: 800 },
  { name: '412x915', width: 412, height: 915 },
  { name: '600x960 tablet portrait', width: 600, height: 960 },
  { name: '960x600 tablet landscape', width: 960, height: 600 },
  { name: '800x360 phone landscape', width: 800, height: 360 },
  { name: '320x640 text 2.0', width: 320, height: 640, fontScale: 2 },
  { name: '412x915 text 1.3', width: 412, height: 915, fontScale: 1.3 },
];

const LANGS: Lang[] = ['en', 'si'];

interface ScreenCase {
  title: string;
  ui: () => ReactElement;
  prepare?: () => void;
  expect: (tr: Tr) => (string | RegExp)[];
  /** Label of the screen's sticky footer button, when it has one (checked on short and tall windows). */
  footer?: (tr: Tr) => string;
}

const CASES: ScreenCase[] = [
  // tabs
  { title: 'Today tab', ui: () => <TodayScreen />, prepare: () => setCurrent(longProject()), expect: (tr) => [tr('spentToday'), tr('wagesToPay'), LONG_PROJECT] },
  { title: 'Projects tab', ui: () => <ProjectsScreen />, expect: () => [LONG_PROJECT, 'Welimada Primary School Building'] },
  { title: 'Expenses tab', ui: () => <ExpensesScreen />, prepare: () => setCurrent(longProject()), expect: () => [LONG_SUPPLIER, BIG_AMOUNT] },
  { title: 'Workers tab', ui: () => <WorkersScreen />, prepare: () => setCurrent(longProject()), expect: (tr) => [LONG_WORKER, tr('todaysWork')] },
  { title: 'Tools tab', ui: () => <ToolsScreen />, expect: () => ['Hilti drill · BM-T-001'] },
  // details and lists
  { title: 'Project detail', ui: () => <ProjectDetail />, prepare: () => setRouteParams({ id: longProject() }), expect: (tr) => [tr('overview'), LONG_WORKER] },
  { title: 'Worker detail', ui: () => <WorkerDetail />, prepare: () => setRouteParams({ id: workerId(LONG_WORKER) }), expect: (tr) => [tr('history'), LONG_PROJECT] },
  { title: 'Tool detail', ui: () => <ToolDetail />, prepare: () => setRouteParams({ id: toolId('Hilti drill') }), expect: (tr) => [tr('history'), tr('returnTool')] },
  {
    title: "Today's work & pay",
    ui: () => <TodaysWorkScreen />,
    prepare: () => setCurrent(longProject()),
    expect: (tr) => [LONG_WORKER, tr('wages')],
    footer: (tr) => tr('saveSheet'),
  },
  { title: 'Site notes', ui: () => <NotesScreen />, prepare: () => setRouteParams({ projectId: longProject() }), expect: () => [LONG_PROJECT], footer: (tr) => tr('newNote') },
  { title: 'Estimates', ui: () => <EstimatesScreen />, expect: () => ['Mr. K. Wijesekara', 'Nuwara View Hotel'], footer: (tr) => tr('newEstimate') },
  { title: 'Estimate hub', ui: () => <EstimateHub />, prepare: () => setRouteParams({ id: draftEstimate() }), expect: (tr) => [tr('items'), 'Hollow block wall, 150 mm'] },
  { title: 'Error log', ui: () => <ProblemScreen />, expect: (tr) => [tr('noErrors')] },
  { title: 'More', ui: () => <MoreScreen />, expect: (tr) => [tr('estimates'), tr('backup')] },
  { title: 'Backup', ui: () => <BackupScreen />, expect: (tr) => [tr('autoBackup')], footer: (tr) => tr('backupNow') },
  { title: 'Quick add sheet', ui: () => <AddSheet />, prepare: () => setCurrent(longProject()), expect: (tr) => [tr('whatToAdd'), tr('newExpense')] },
  // forms
  { title: 'New expense', ui: () => <ExpenseForm />, prepare: () => setCurrent(longProject()), expect: (tr) => [tr('amount')], footer: (tr) => tr('save') },
  { title: 'Edit project', ui: () => <ProjectForm />, prepare: () => setRouteParams({ id: longProject() }), expect: () => [LONG_PROJECT], footer: (tr) => tr('save') },
  { title: 'Edit worker', ui: () => <WorkerForm />, prepare: () => setRouteParams({ id: workerId(LONG_WORKER) }), expect: () => [LONG_WORKER], footer: (tr) => tr('save') },
  {
    title: 'Give advance',
    ui: () => <WageForm />,
    prepare: () => setRouteParams({ workerId: workerId(LONG_WORKER), projectId: longProject(), kind: 'advance' }),
    expect: (tr) => [tr('amount')],
    footer: (tr) => tr('save'),
  },
  { title: 'Add worker to project', ui: () => <WorkerAssign />, prepare: () => setRouteParams({ projectId: longProject() }), expect: () => [LONG_PROJECT], footer: (tr) => tr('save') },
  { title: 'Issue tool', ui: () => <ToolMove />, prepare: () => setRouteParams({ toolId: toolId('Vibrator poker'), kind: 'issue' }), expect: () => ['Vibrator poker'], footer: (tr) => tr('save') },
  { title: 'New tool', ui: () => <ToolForm />, expect: (tr) => [tr('save')], footer: (tr) => tr('save') },
  { title: 'New note', ui: () => <NoteForm />, prepare: () => setCurrent(longProject()), expect: () => [LONG_PROJECT], footer: (tr) => tr('save') },
  { title: 'Company and bank', ui: () => <CompanyScreen />, expect: (tr) => [tr('save')], footer: (tr) => tr('save') },
  { title: 'New estimate', ui: () => <EstimateForm />, expect: (tr) => [tr('save')], footer: (tr) => tr('save') },
  { title: 'Estimate line', ui: () => <EstimateItemScreen />, prepare: () => setRouteParams({ estimateId: draftEstimate() }), expect: (tr) => [tr('save')], footer: (tr) => tr('save') },
  { title: 'Payment stage', ui: () => <EstimatePaymentScreen />, prepare: () => setRouteParams({ estimateId: draftEstimate() }), expect: (tr) => [tr('save')], footer: (tr) => tr('save') },
];

function variantsFor(c: ScreenCase): Variant[] {
  return SIZES.map((size) => ({
    name: size.name,
    width: size.width,
    height: size.height,
    fontScale: size.fontScale,
    langs: LANGS,
    prepare: c.prepare,
    expect: (tr) => c.expect(tr),
    check: (tr) => {
      const ctx = `${c.title} / ${size.name}`;
      const overflow = rowOverflows();
      if (overflow.length) throw new Error(`${ctx}: text that cannot shrink in a row:\n  ${overflow.join('\n  ')}`);

      const caps = maxWidths();
      if (size.width >= 600 && !caps.includes(640)) throw new Error(`${ctx}: no 640 content column on a ${size.width} wide window`);
      if (size.width < 600 && caps.includes(640)) throw new Error(`${ctx}: a phone window got the tablet column`);

      if (c.footer) {
        const inside = labelInsideScroll(c.footer(tr));
        if (inside === null) throw new Error(`${ctx}: no "${c.footer(tr)}" button`);
        const short = size.height < 480;
        if (short && !inside) throw new Error(`${ctx}: on a ${size.height} tall window the footer should scroll with the content`);
        if (!short && inside) throw new Error(`${ctx}: the footer should stay sticky on a ${size.height} tall window`);
      }
    },
  }));
}

for (const c of CASES) {
  smokeScreen(`responsive: ${c.title}`, c.ui, { db: 'demo', setup: addLongData, variants: variantsFor(c) });
}
