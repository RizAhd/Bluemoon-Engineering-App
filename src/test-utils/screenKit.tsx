/**
 * Helpers for screen render-smoke tests. Import this FIRST in a screen test (it loads the
 * UI mocks from rnMocks.ts before any screen is required):
 *
 *   import { smokeScreen, renderScreen, expectClean, ... } from '@/test-utils/screenKit';
 *
 * The tests render the real screen against the real data layer (SQLite shim, see '@/test-utils'),
 * so a runtime exception, a wrong query, a missing translation key or a bad colour token
 * shows up here without a device.
 *
 * Every test file that imports this module also gets:
 *  - jest.clearAllMocks() before each test (router.push calls etc. start empty),
 *  - the route (params / pathname) reset and the window set to a 360 wide phone,
 *  - console.error / console.warn captured: a React warning (missing key, state update outside
 *    act, bad prop) FAILS the test. A test that provokes an error on purpose reads
 *    takeConsole() to assert on it and clear it.
 */
// rnMocks first: its jest.mock() calls must run before any app module is loaded.
import { resetRoute, setPathname, setRouteParams, setWindow } from './rnMocks';

import { act, fireEvent, render, screen, within, type RenderResult } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { setSetting } from '@/db';
import { en, type TKey } from '@/i18n/en';
import { si } from '@/i18n/si';
import { ta } from '@/i18n/ta';
import { fabEdgeDark, FONT_MAP, palette, photoChrome } from '@/theme';

import { resetDb, seedDemo } from './index';

jest.setTimeout(60_000);

export { act, fireEvent, screen, within };
export { resetRoute, setPathname, setRouteParams, setWindow };

/** Screens are checked on a typical phone unless a variant says otherwise. */
export const PHONE_WIDTH = 360;
export type { TKey };

type Json = { type: string; props: Record<string, unknown>; children: (Json | string)[] };

export type Lang = 'en' | 'si' | 'ta';
export type Scheme = 'light' | 'dark';
export const LANGS: Lang[] = ['en', 'si', 'ta'];
export const SCHEMES: Scheme[] = ['light', 'dark'];

// ---------------------------------------------------------------- translations

const dicts: Record<Lang, Record<string, string>> = { en, si, ta };

/** Translate like the app does: `tr('en')('save')`. Falls back to English, then to the key. */
export function makeTr(lang: Lang) {
  return (key: TKey, vars?: Record<string, string | number>): string => {
    let s = dicts[lang][key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
}
export type Tr = ReturnType<typeof makeTr>;

/** A RegExp that matches any one of these literal strings (for "one of three greetings"). */
export function anyOf(...strings: string[]): RegExp {
  return new RegExp(strings.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
}

// ---------------------------------------------------------------- console watch

const consoleLines: string[] = [];
let errorSpy: jest.SpyInstance | null = null;
let warnSpy: jest.SpyInstance | null = null;

// Library noise that is not about the app (add here only with a reason).
const IGNORED_CONSOLE: RegExp[] = [];

function record(kind: string, args: unknown[]) {
  const show = (a: unknown): string => {
    if (a instanceof Error) return a.stack ?? a.message;
    if (typeof a === 'string') return a;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a); // circular structure
    }
  };
  const line = args.map(show).join(' ');
  if (IGNORED_CONSOLE.some((re) => re.test(line))) return;
  consoleLines.push(`console.${kind}: ${line}`);
}

/** Everything logged with console.error / console.warn since the last call; clears the list. */
export function takeConsole(): string[] {
  return consoleLines.splice(0, consoleLines.length);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRoute();
  setWindow(PHONE_WIDTH);
  consoleLines.length = 0;
  errorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => record('error', args));
  warnSpy = jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => record('warn', args));
});

afterEach(() => {
  errorSpy?.mockRestore();
  warnSpy?.mockRestore();
  errorSpy = null;
  warnSpy = null;
  jest.restoreAllMocks(); // spies a test made (Alert.alert ...) do not leak into the next test
  const lines = consoleLines.splice(0, consoleLines.length);
  if (lines.length) throw new Error(`Unexpected console output during the test:\n${lines.slice(0, 5).join('\n---\n')}`);
});

// ---------------------------------------------------------------- rendering

// ---------------------------------------------------------------- list timers

/** The parts of a mounted VirtualizedList (FlatList / SectionList) that flushLists needs. */
interface MountedList {
  _updateCellsToRenderTimeoutID: ReturnType<typeof setTimeout> | null;
  _updateCellsToRender: () => void;
}

interface FiberLike {
  stateNode: unknown;
  child: FiberLike | null;
  sibling: FiberLike | null;
  return: FiberLike | null;
}

function isList(node: unknown): node is MountedList {
  return !!node && typeof node === 'object' && typeof (node as MountedList)._updateCellsToRender === 'function' && '_updateCellsToRenderTimeoutID' in node;
}

/** Every mounted list that has a cell update waiting on its timer. */
function listsWithPendingUpdate(): MountedList[] {
  let first: FiberLike | null = null;
  try {
    for (const child of screen.container.children) {
      if (typeof child !== 'string') {
        first = child.unstable_fiber as FiberLike | null;
        break;
      }
    }
  } catch {
    return []; // nothing rendered
  }
  let root = first;
  while (root?.return) root = root.return;
  const out: MountedList[] = [];
  const stack: (FiberLike | null)[] = [root];
  while (stack.length) {
    const f = stack.pop();
    if (!f) continue;
    if (isList(f.stateNode) && f.stateNode._updateCellsToRenderTimeoutID != null) out.push(f.stateNode);
    stack.push(f.child, f.sibling);
  }
  return out;
}

/**
 * A VirtualizedList answers every update of its own (mount, new data, a theme switch) by scheduling a cell
 * update on a 50 ms timer, and that update calls setState. When the test happened to take longer than 50 ms
 * after the render, the timer fired outside act() and React warned "An update to VirtualizedList ... was not
 * wrapped in act(...)" (the wage/today flake: 2 runs in 10). The pending update is run now, inside act(),
 * until no list has one waiting, so nothing is left for a timer to do. No waiting, no fake timers.
 */
export async function flushLists(): Promise<void> {
  for (let round = 0; round < 10; round++) {
    const lists = listsWithPendingUpdate();
    if (!lists.length) return;
    await act(async () => {
      for (const list of lists) {
        if (list._updateCellsToRenderTimeoutID == null) continue;
        clearTimeout(list._updateCellsToRenderTimeoutID);
        list._updateCellsToRenderTimeoutID = null;
        list._updateCellsToRender();
      }
    });
  }
}

/** Let queued microtasks / effects settle inside act(), then run the lists' pending cell updates. */
export async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
  await flushLists();
}

/** Render a screen and wait for its first effects. Throws if the screen throws. */
export async function renderScreen(ui: ReactElement): Promise<RenderResult> {
  const result = await render(ui);
  await settle();
  return result;
}

/** Change a setting the way the More screen does, inside act() so mounted screens re-render. */
export async function changeSetting(key: string, value: string | null): Promise<void> {
  await act(async () => {
    setSetting(key, value);
  });
  // a theme or language switch re-renders every list, which schedules their cell updates
  await flushLists();
}

export function setLanguage(lang: Lang) {
  return changeSetting('lang', lang);
}
export function setTheme(scheme: Scheme) {
  return changeSetting('theme', scheme);
}

// ---------------------------------------------------------------- reading the output

function walk(node: Json | string | null, visit: (n: Json) => void) {
  if (!node || typeof node === 'string') return;
  visit(node);
  node.children.forEach((c) => walk(c, visit));
}

function tree(): Json | null {
  return screen.toJSON() as Json | null;
}

/** The text a person reads from a Text node: its strings and the strings of nested Text nodes, joined as drawn. */
function textContent(node: Json | string): string {
  if (typeof node === 'string') return node;
  return node.children.map(textContent).join('');
}

/** Every piece of visible text: one entry per Text node, plus input values and placeholders. */
export function visibleTexts(): string[] {
  const out: string[] = [];
  const collect = (n: Json | string) => {
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (n.type === 'Text') {
      out.push(textContent(n));
      return;
    }
    if (n.type === 'TextInput') {
      for (const key of ['value', 'defaultValue', 'placeholder']) {
        const v = n.props[key];
        if (typeof v === 'string' && v) out.push(v);
      }
    }
    n.children.forEach(collect);
  };
  const root = tree();
  if (root) collect(root);
  return out;
}

/** All visible text as one string (for toContain checks). */
export function visibleText(): string {
  return visibleTexts().join('\n');
}

/** Every accessibilityLabel in the tree (what a screen reader would say). */
export function a11yLabels(): string[] {
  const out: string[] = [];
  walk(tree(), (n) => {
    const l = n.props.accessibilityLabel;
    if (typeof l === 'string') out.push(l);
  });
  return out;
}

const BAD_TEXT: [string, RegExp][] = [
  ['undefined', /undefined/],
  ['NaN', /\bNaN\b/],
  ['[object Object]', /\[object Object\]/],
  ['null', /\bnull\b/],
  ['Infinity', /\bInfinity\b/],
];

/** Style values that should never reach a device: NaN / Infinity sizes, or an undefined colour. */
function badStyleEntries(): string[] {
  const bad: string[] = [];
  const flat = (style: unknown): Record<string, unknown> => {
    if (Array.isArray(style)) return style.reduce<Record<string, unknown>>((a, s) => ({ ...a, ...flat(s) }), {});
    return style && typeof style === 'object' ? (style as Record<string, unknown>) : {};
  };
  walk(tree(), (n) => {
    if (n.type === 'Icon') {
      const color = n.props.color;
      if (typeof color !== 'string') bad.push(`Icon ${String(n.props.name)} has color ${String(color)}`);
      const size = n.props.size;
      if (typeof size !== 'number' || !Number.isFinite(size)) bad.push(`Icon ${String(n.props.name)} has size ${String(size)}`);
    }
    const style = flat(n.props.style);
    for (const [key, value] of Object.entries(style)) {
      if (typeof value === 'number' && !Number.isFinite(value)) bad.push(`${n.type} style.${key} = ${value}`);
      else if (typeof value === 'string' && /undefined|NaN/.test(value)) bad.push(`${n.type} style.${key} = "${value}"`);
      else if (key.toLowerCase().endsWith('color') && (value === undefined || value === null)) bad.push(`${n.type} style.${key} is ${String(value)}`);
    }
  });
  return bad;
}

/**
 * The cleanliness checks every screen must pass: no "undefined" / "NaN" / "[object Object]" / "null"
 * in the text, the input values or the screen-reader labels, and no NaN size or missing colour in a
 * style or icon.
 */
export function expectClean(context = 'screen'): void {
  const sources: [string, string[]][] = [
    ['text', visibleTexts()],
    ['accessibility label', a11yLabels()],
  ];
  for (const [kind, strings] of sources) {
    for (const s of strings) {
      for (const [name, re] of BAD_TEXT) {
        if (re.test(s)) throw new Error(`${context}: ${kind} contains "${name}": ${JSON.stringify(s)}`);
      }
    }
  }
  const style = badStyleEntries();
  if (style.length) throw new Error(`${context}: bad style values:\n  ${[...new Set(style)].slice(0, 12).join('\n  ')}`);
}

/** The title drawn by the Stack.Screen mock, or null when the screen set none. */
export function headerTitle(): string | null {
  const header = screen.queryByTestId('stack-header');
  if (!header) return null;
  const strings: string[] = [];
  const collect = (n: Json | string) => {
    if (typeof n === 'string') strings.push(n);
    else n.children.forEach(collect);
  };
  const json = header.toJSON() as Json | null;
  if (json) collect(json);
  return strings[0] ?? null;
}

// ---------------------------------------------------------------- acting

/** Press whatever has this exact accessibility label (buttons, chips, icon buttons). */
export async function pressLabel(label: string, index = 0): Promise<void> {
  const all = screen.getAllByLabelText(label, { exact: true });
  if (!all[index]) throw new Error(`No element labelled "${label}" (index ${index}); found ${all.length}`);
  await fireEvent.press(all[index]);
  await flushLists();
}

/** Press the element showing this exact text (list rows, cards). */
export async function pressText(text: string, index = 0): Promise<void> {
  const all = screen.getAllByText(text, { exact: true });
  if (!all[index]) throw new Error(`No text "${text}" (index ${index}); found ${all.length}`);
  await fireEvent.press(all[index]);
  await flushLists();
}

/** Type into the input that has this accessibility label. */
export async function typeInto(label: string, value: string, index = 0): Promise<void> {
  const all = screen.getAllByLabelText(label, { exact: true });
  if (!all[index]) throw new Error(`No input labelled "${label}" (index ${index}); found ${all.length}`);
  await fireEvent.changeText(all[index], value);
  await flushLists();
}

/** Value currently shown in the input with this label. */
export function inputValue(label: string, index = 0): string {
  const all = screen.getAllByLabelText(label, { exact: true });
  const v = all[index]?.props.value;
  return typeof v === 'string' ? v : '';
}

/** Alert.alert(title, message, buttons): the buttons of the most recent call. */
export function lastAlert(spy: jest.SpyInstance): { title: string; message?: string; buttons: { text?: string; style?: string; onPress?: () => void }[] } {
  const call = spy.mock.calls.at(-1);
  if (!call) throw new Error('Alert.alert was not called');
  return { title: call[0] as string, message: call[1] as string | undefined, buttons: (call[2] ?? []) as { text?: string; style?: string; onPress?: () => void }[] };
}

/** Press a button of the most recent Alert.alert call, by its text, inside act(). */
export async function pressAlertButton(spy: jest.SpyInstance, text: string): Promise<void> {
  const button = lastAlert(spy).buttons.find((b) => b.text === text);
  if (!button?.onPress) throw new Error(`The alert has no "${text}" button`);
  await act(async () => {
    button.onPress?.();
  });
  await flushLists();
}

export function has(text: string): boolean {
  return screen.queryAllByText(text, { exact: true }).length > 0;
}

export function hasLabel(label: string): boolean {
  return screen.queryAllByLabelText(label, { exact: true }).length > 0;
}

// ---------------------------------------------------------------- the smoke matrix

export interface Variant {
  name: string;
  /** Runs before mounting: set route params, the current project, settings. The language and theme are set after. */
  prepare?: () => void | Promise<void>;
  /** Text, input values or screen-reader labels that must be on screen (string = contains, RegExp = matches). */
  expect?: (tr: Tr, lang: Lang) => (string | RegExp)[];
  /** Texts that must NOT be on screen (a whole text node or screen-reader label equal to the string). */
  absent?: (tr: Tr, lang: Lang) => string[];
  /** The screen renders nothing at all (for example an edit form whose record is gone). */
  blank?: boolean;
  /** Window width in dp (default 360): 320 stacks the stat tiles, 768 is a tablet. */
  width?: number;
  /** Window height in dp (default 800): under 480 the sticky footers scroll with the content. */
  height?: number;
  /** The phone's text size setting (default 1). */
  fontScale?: number;
  /** Run this variant in these languages only (default: all three). */
  langs?: Lang[];
  /** Extra assertions on the mounted screen, once per language (light theme). */
  check?: (tr: Tr, lang: Lang) => void | Promise<void>;
}

export interface SmokeOptions {
  /** The data every variant starts with: the demo set, or a brand-new empty phone. */
  db: 'demo' | 'empty';
  variants: Variant[];
  langs?: Lang[];
  /** Extra data written once, after the base set is in place (for example an inactive worker). */
  setup?: () => void;
}

/** Settings a variant may change; they are cleared before every test so variants do not leak into each other. */
const VOLATILE_SETTINGS = [
  'current_project',
  'auto_backup_at',
  'auto_backup_error',
  'auto_backup',
  'last_backup_at',
  'export_photos',
  'export_letterhead',
  'recovered_from_corruption',
];

function assertShown(context: string, expected: (string | RegExp)[]) {
  const text = visibleText();
  const labels = a11yLabels().join('\n');
  for (const want of expected) {
    const found = typeof want === 'string' ? text.includes(want) || labels.includes(want) : want.test(text) || want.test(labels);
    if (!found) throw new Error(`${context}: expected ${String(want)} on screen.\n--- screen text ---\n${text.slice(0, 1800)}`);
  }
}

/** Every value of every style object in the tree (arrays flattened), plus the colour of every icon. */
function styleValues(): unknown[] {
  const out: unknown[] = [];
  const flat = (style: unknown) => {
    if (Array.isArray(style)) style.forEach(flat);
    else if (style && typeof style === 'object') out.push(...Object.values(style));
  };
  walk(tree(), (n) => {
    flat(n.props.style);
    if (n.type === 'Icon') out.push(n.props.color);
  });
  return out;
}

/**
 * The screen is drawn in the chosen scheme: at least one colour of that palette is used, and no colour that
 * belongs only to the other palette (a hard-coded light colour in dark mode). The photo viewer's black / white
 * chrome and the FAB's dark edge are the same in both schemes on purpose.
 */
function assertScheme(context: string, scheme: Scheme) {
  const other: Scheme = scheme === 'light' ? 'dark' : 'light';
  const mine = new Set<string>(Object.values(palette[scheme]));
  const sameBothWays = new Set<string>([...Object.values(photoChrome), fabEdgeDark]);
  const theirs = Object.values(palette[other]).filter((v) => !mine.has(v) && !sameBothWays.has(v));
  const used = styleValues();
  if (!used.some((v) => typeof v === 'string' && mine.has(v))) throw new Error(`${context}: no ${scheme} colour is used anywhere`);
  const leaked = theirs.filter((v) => used.includes(v));
  if (leaked.length) throw new Error(`${context}: ${other} colours in the ${scheme} scheme: ${leaked.join(', ')}`);
}

function assertFont(context: string, lang: Lang) {
  const f = FONT_MAP[lang];
  const used = styleValues();
  if (![f.regular, f.semibold, f.bold].some((name) => used.includes(name))) throw new Error(`${context}: no text uses the ${lang} font family`);
}

/**
 * Registers, for a screen, one test per variant and language that mounts the real screen and checks:
 * (a) it renders without throwing, (b) no "undefined" / "NaN" / "[object Object]" anywhere,
 * (c) the expected text is there, (d) the same in light and dark (the theme is switched on the
 * mounted screen, as the More screen does) and (e) the language's font and strings are used.
 */
export function smokeScreen(title: string, ui: () => ReactElement, options: SmokeOptions) {
  const langs = options.langs ?? LANGS;
  describe(title, () => {
    beforeAll(() => {
      resetDb();
      if (options.db === 'demo') seedDemo();
      options.setup?.();
    });

    for (const variant of options.variants) {
      for (const lang of variant.langs ?? langs) {
        it(`${variant.name} [${lang}]`, async () => {
          const tr = makeTr(lang);
          setWindow(variant.width ?? PHONE_WIDTH, variant.height, variant.fontScale);
          for (const key of VOLATILE_SETTINGS) setSetting(key, null);
          setSetting('lang', lang);
          setSetting('theme', 'light');
          await variant.prepare?.();
          await renderScreen(ui());

          for (const scheme of SCHEMES) {
            if (scheme === 'dark') await setTheme('dark');
            const ctx = `${title} / ${variant.name} / ${lang} / ${scheme}`;
            if (variant.blank) {
              if (tree() !== null) throw new Error(`${ctx}: expected the screen to render nothing, got:
${visibleText().slice(0, 600)}`);
              continue;
            }
            expectClean(ctx);
            assertShown(ctx, variant.expect?.(tr, lang) ?? []);
            const shown = new Set([...visibleTexts(), ...a11yLabels()]);
            for (const gone of variant.absent?.(tr, lang) ?? []) {
              if (shown.has(gone)) throw new Error(`${ctx}: "${gone}" should not be on screen`);
            }
            assertScheme(ctx, scheme);
            assertFont(ctx, lang);
          }
          await variant.check?.(tr, lang);
        });
      }
    }
  });
}
