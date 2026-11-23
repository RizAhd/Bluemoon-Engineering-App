/**
 * The shared control bar (src/components/ListControls.tsx) in English, Sinhala and Tamil, light and dark, on a
 * 360 dp phone: the chips scroll sideways in one row instead of pushing the list down, every target is 48 dp, the
 * caption says what is applied in the screen's language, the sheet uses only the colours of the scheme it is in.
 * Also the month and period helpers the four screens share.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { StyleSheet } from 'react-native';

import ExpensesScreen from '@/app/(tabs)/expenses';
import WorkersScreen from '@/app/(tabs)/workers';
import {
  amountRangeLabel,
  centsOf,
  listOf,
  monthLabel,
  monthRange,
  oneOf,
  periodLabel,
  periodMonth,
  periodRange,
  shiftMonth,
  toPeriod,
} from '@/components/ListControls';
import { setSetting } from '@/db';
import { EXPENSE_CATEGORIES } from '@/db/types';
import { today } from '@/lib/dates';
import { palette } from '@/theme';
import { resetDb, seedDemo } from '@/test-utils';
import {
  expectClean,
  LANGS,
  makeTr,
  pressLabel,
  renderScreen,
  screen,
  SCHEMES,
  setTheme,
  smokeScreen,
  visibleText,
  type Lang,
  within,
  type Scheme,
} from '@/test-utils/screenKit';

const E = makeTr('en');

// ---------------------------------------------------------------- helpers

describe('month and period helpers', () => {
  it('shiftMonth crosses years both ways', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2026-03', -14)).toBe('2025-01');
  });

  it('a period is this month, last month, a fixed month or all time; anything else is all time', () => {
    expect(['this', 'last', 'all', '2025-03'].map(toPeriod)).toEqual(['this', 'last', 'all', '2025-03']);
    expect(['2025-13', '2025-3', 'month', '', "1' OR 1"].map(toPeriod)).toEqual(['all', 'all', 'all', 'all', 'all']);
    expect(periodMonth('this', '2026-01-05')).toBe('2026-01');
    expect(periodMonth('last', '2026-01-05')).toBe('2025-12');
    expect(periodMonth('2025-03', '2026-01-05')).toBe('2025-03');
    expect(periodMonth('all', '2026-01-05')).toBeNull();
    expect(periodRange('last', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-03-01' });
    expect(periodRange('all', '2026-03-31')).toBeNull();
    expect(monthRange('2025-12')).toEqual({ from: '2025-12-01', to: '2026-01-01' });
  });

  it('month names in every language', () => {
    expect(monthLabel('2026-03', makeTr('en'))).toBe('March 2026');
    expect(monthLabel('2026-03', makeTr('si'))).toBe('මාර්තු 2026');
    expect(monthLabel('2026-03', makeTr('ta'))).toBe('மார்ச் 2026');
    for (const lang of LANGS) for (let m = 1; m <= 12; m++) expect(monthLabel(`2026-${String(m).padStart(2, '0')}`, makeTr(lang))).not.toMatch(/month_/);
    expect(periodLabel('all', '2026-03-31', E)).toBe(E('allTime'));
    expect(periodLabel('this', '2026-03-31', E)).toBe('March 2026');
  });

  it('stored lists, choices and amounts are read defensively', () => {
    expect(oneOf('highest', ['newest', 'highest'] as const, 'newest')).toBe('highest');
    expect(oneOf('DROP TABLE', ['newest', 'highest'] as const, 'newest')).toBe('newest');
    expect(listOf('fuel,,gold,materials', EXPENSE_CATEGORIES)).toEqual(['fuel', 'materials']);
    expect(listOf('', EXPENSE_CATEGORIES)).toEqual([]);
    expect([centsOf('5000000'), centsOf(''), centsOf('-5'), centsOf('1e9'), centsOf('99999999999999999999')]).toEqual([5_000_000, null, null, null, null]);
    expect(amountRangeLabel(100_000, 900_000, E)).toBe('Rs 1,000 – Rs 9,000');
    expect(amountRangeLabel(100_000, null, E)).toBe('From Rs 1,000');
    expect(amountRangeLabel(null, 900_000, E)).toBe('Up to Rs 9,000');
    expect(amountRangeLabel(null, null, E)).toBeNull();
  });
});

// ---------------------------------------------------------------- the bar in every language and scheme

const lastMonth = () => shiftMonth(today().slice(0, 7), -1);

function applyExpenseChoices() {
  setSetting('list_expenses_period', 'last');
  setSetting('list_expenses_cats', 'materials');
  setSetting('list_expenses_sort', 'highest');
}

function clearExpenseChoices() {
  for (const f of ['period', 'sort', 'cats', 'methods', 'min', 'max']) setSetting(`list_expenses_${f}`, null);
}

smokeScreen('Expenses control bar', () => <ExpensesScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'nothing chosen: the button and the period chips, no caption',
      prepare: clearExpenseChoices,
      expect: (tr) => [tr('filterSort'), tr('thisMonth'), tr('lastMonth'), tr('allTime'), tr('chooseMonth')],
      absent: (tr) => [tr('clear'), tr('filterSortActive', { n: 1 })],
    },
    {
      name: 'last month, materials, highest first: the caption in the language, the badge, the filtered tile',
      prepare: applyExpenseChoices,
      expect: (tr) => [
        `${monthLabel(lastMonth(), tr)} · ${tr('cat_materials')} · ${tr('sort_highest')}`,
        tr('clear'),
        tr('filterSortActive', { n: 2 }),
        `${tr('total')} · ${monthLabel(lastMonth(), tr)}`,
        tr('entries'),
      ],
      absent: (tr) => [tr('totalCost')],
    },
    {
      name: 'a narrow phone (320 wide) with choices applied',
      width: 320,
      prepare: applyExpenseChoices,
      expect: (tr) => [tr('clear'), `${monthLabel(lastMonth(), tr)} · ${tr('cat_materials')} · ${tr('sort_highest')}`],
    },
  ],
});

smokeScreen('Workers control bar', () => <WorkersScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'the balance chips with counts, and a caption for the chosen status and sort',
      prepare: () => {
        setSetting('list_workers_status', 'active');
        setSetting('list_workers_sort', 'toPay');
      },
      expect: (tr) => [tr('weOwe'), tr('workerOwes'), tr('settled'), `${tr('workerActive')} · ${tr('sort_toPay')}`, tr('filterSortActive', { n: 2 })],
    },
  ],
});

/** Every colour used in the mounted tree (styles and icons), including the open sheet. */
function usedColours(): string[] {
  const out: string[] = [];
  const visit = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    const node = n as { type: string; props: Record<string, unknown>; children: unknown[] | null };
    const style = StyleSheet.flatten(node.props.style as never) as Record<string, unknown> | undefined;
    for (const [k, v] of Object.entries(style ?? {})) if (k.toLowerCase().endsWith('color') && typeof v === 'string') out.push(v);
    if (node.type === 'Icon' && typeof node.props.color === 'string') out.push(node.props.color);
    node.children?.forEach(visit);
  };
  visit(screen.toJSON());
  return out;
}

function onlyColoursOf(scheme: Scheme) {
  const other: Scheme = scheme === 'light' ? 'dark' : 'light';
  const mine = new Set<string>(Object.values(palette[scheme]));
  const theirs = new Set<string>(Object.values(palette[other]).filter((v: string) => !mine.has(v)));
  const used = usedColours();
  expect(used.filter((v) => theirs.has(v))).toEqual([]);
  expect(used.some((v) => mine.has(v))).toBe(true);
}

describe('the Filter & sort sheet in every language and scheme', () => {
  beforeAll(() => {
    resetDb();
    seedDemo();
  });

  for (const lang of LANGS as Lang[]) {
    for (const scheme of SCHEMES) {
      it(`${lang} / ${scheme}: every section, Reset and Done, in the scheme's colours`, async () => {
        const tr = makeTr(lang);
        setSetting('lang', lang);
        setSetting('theme', 'light');
        clearExpenseChoices();
        setSetting('list_expenses_methods', 'cash');
        await renderScreen(<ExpensesScreen />);
        if (scheme === 'dark') await setTheme('dark');
        await pressLabel(tr('filterSortActive', { n: 1 }));
        const text = visibleText();
        for (const want of [tr('filterSort'), tr('sortBy'), tr('sort_newest'), tr('sort_lowest'), tr('category'), tr('cat_utilities'), tr('method'), tr('method_cheque'), tr('amount'), tr('minAmount'), tr('maxAmount'), tr('reset'), tr('done')]) {
          expect([want, text.includes(want)]).toEqual([want, true]);
        }
        expect(screen.getByLabelText(tr('method_cash')).props.accessibilityState.checked).toBe(true);
        expectClean(`sheet ${lang} ${scheme}`);
        onlyColoursOf(scheme);
      });
    }
  }
});

describe('the bar on a 360 dp phone', () => {
  beforeAll(() => {
    resetDb();
    seedDemo();
  });

  it('Filter & sort sits beside the search box; the period chips are one sideways-scrolling row at the screen edges', async () => {
    setSetting('lang', 'si');
    clearExpenseChoices();
    await renderScreen(<ExpensesScreen />);
    const si = makeTr('si');
    // Blueprint: the square Filter & sort button is on the search box's row, not in the scrolling row
    expect(screen.getByLabelText(si('filterSort'))).toBeTruthy();
    expect(screen.getByLabelText(si('search'))).toBeTruthy();
    let row = screen.getByLabelText(si('allTime')).parent;
    while (row && !(row.props.horizontal === true)) row = row.parent;
    expect(row).toBeTruthy();
    expect(row!.props.showsHorizontalScrollIndicator).toBe(false);
    // the row bleeds to the screen edges (16 dp gutter) so the chips scroll under it, not into a clipped box
    expect(StyleSheet.flatten(row!.props.style).marginHorizontal).toBe(-16);
    expect(StyleSheet.flatten(row!.props.contentContainerStyle).paddingHorizontal).toBe(16);
    const labels = [si('thisMonth'), si('lastMonth'), si('allTime'), si('chooseMonth')];
    for (const l of labels) expect(within(row!).queryAllByLabelText(l, { exact: true }).length).toBeGreaterThan(0);
  });

  it('every control is at least 48 dp tall', async () => {
    setSetting('lang', 'en');
    applyExpenseChoices();
    await renderScreen(<ExpensesScreen />);
    const height = (label: string) => StyleSheet.flatten(screen.getByLabelText(label).props.style).minHeight as number;
    for (const label of [E('filterSortActive', { n: 2 }), E('thisMonth'), E('lastMonth'), E('allTime'), E('chooseMonth'), E('clear')]) {
      expect([label, height(label) >= 48]).toEqual([label, true]);
    }
    await pressLabel(E('filterSortActive', { n: 2 }));
    for (const label of [E('cat_materials'), E('method_bank')]) expect([label, height(label) >= 48]).toEqual([label, true]);
  });
});
