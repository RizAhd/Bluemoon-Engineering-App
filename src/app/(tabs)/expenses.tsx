import { router } from 'expo-router';
import { Calendar, Camera, ChevronDown, ChevronUp, Plus, Receipt, Search, Settings, Share2 } from 'lucide-react-native';
import { memo, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { CATEGORY_ICON } from '@/components/categoryIcons';
import { Hero, HeroAction, HeroAmount, HeroChip, HeroChips } from '@/components/Hero';
import {
  amountRangeLabel,
  centsOf,
  listOf,
  ListControls,
  MultiChips,
  oneOf,
  periodLabel,
  periodRange,
  toPeriod,
  useListPrefs,
  useToday,
} from '@/components/ListControls';
import { useShareSheet } from '@/components/ShareSheet';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { CardList, type CardSection } from '@/components/ui/CardList';
import { AmountField, HelperText, Label } from '@/components/ui/form';
import { Card, ListRow, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst, useQuery, useSetting } from '@/db';
import { EXPENSE_CATEGORIES, PAY_METHODS, type Expense, type ExpenseCategory } from '@/db/types';
import { EXPENSE_SORTS, expenseWhere, useAttachmentCounts, useCurrentProjectId, useExpenseList, useProject, type ExpenseFilter, type ExpenseSort } from '@/hooks/data';
import { usePdfShare } from '@/hooks/pdfShare';
import { useSearchBox } from '@/hooks/search';
import { useT, type TKey } from '@/i18n';
import { addDays, formatDay } from '@/lib/dates';
import { centsToInput, formatLKR, parseCents } from '@/lib/money';
import { exportExpensesPdf } from '@/lib/reports/export';
import { radius, space, useColors } from '@/theme';

type Row = Expense & { project_name: string };
type Group = { day: string; total: number; rows: Row[] };

/** How many expenses the list loads at first; "Show all" lifts the cap. */
const PAGE = 500;

/** What the Expenses tab remembers (settings `list_expenses_<field>`); these are the defaults. */
const DEFAULTS = { period: 'all', sort: 'newest', cats: '', methods: '', min: '', max: '' };

/** The shade of each slice of the "By category" bar, largest share first (one blue, lighter and lighter). */
const SHARE_OPACITY = [1, 0.62, 0.38, 0.22];

/** Category tiles shown before "See all" opens the rest. */
const TILES = 4;

/** Minimum and maximum amount, typed in the sheet. A number is stored as soon as it reads as one. */
function AmountRange({ min, max, onMin, onMax }: { min: number | null; max: number | null; onMin: (c: number | null) => void; onMax: (c: number | null) => void }) {
  const t = useT();
  // the sheet mounts its content when it opens, so the boxes start from what is stored
  const [minText, setMinText] = useState(min != null ? centsToInput(min) : '');
  const [maxText, setMaxText] = useState(max != null ? centsToInput(max) : '');
  const typed = (s: string, set: (s: string) => void, store: (c: number | null) => void) => {
    set(s);
    if (!s.trim()) store(null);
    else {
      const cents = parseCents(s);
      if (cents !== null) store(cents);
    }
  };
  return (
    <View style={{ gap: space.sm }}>
      <Label text={t('amount')} />
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 1, gap: space.xs }}>
          <Label text={t('minAmount')} />
          <AmountField compact label={t('minAmount')} value={minText} onChangeText={(s) => typed(s, setMinText, onMin)} />
        </View>
        <View style={{ flex: 1, gap: space.xs }}>
          <Label text={t('maxAmount')} />
          <AmountField compact label={t('maxAmount')} value={maxText} onChangeText={(s) => typed(s, setMaxText, onMax)} />
        </View>
      </View>
      <HelperText error={min != null && max != null && min > max ? t('errRange') : null} />
    </View>
  );
}

/**
 * Expenses tab (Blueprint): the blue hero with the total of what is shown and the "By category" card over its
 * edge, then the search box with Filter & sort, the period track, and one card per day with the day total beside
 * its date; sorted by amount it is one flat list instead. Filtering, totals and order all happen in the database.
 */
export default function ExpensesScreen() {
  const t = useT();
  const c = useColors();
  const pid = useCurrentProjectId();
  const td = useToday();
  const month = td.slice(0, 7);
  const [limit, setLimit] = useState(PAGE); // -1 = no cap

  const { prefs, set, reset } = useListPrefs('expenses', DEFAULTS);
  const period = toPeriod(prefs.period);
  const sort = oneOf<ExpenseSort>(prefs.sort, EXPENSE_SORTS, 'newest');
  const cats = listOf(prefs.cats, EXPENSE_CATEGORIES);
  const methods = listOf(prefs.methods, PAY_METHODS);
  const min = centsOf(prefs.min);
  const max = centsOf(prefs.max);
  const range = periodRange(period, td);

  // The database searches payee, note, project, category (by its name in the UI language) and the exact amount, so an
  // old row past the first page is found too. The box is drawn with the list only (an empty tab has no rows to hide).
  const search = useSearchBox();
  const categoryNames = Object.fromEntries(EXPENSE_CATEGORIES.map((k) => [k, t(`cat_${k}`)]));
  const filter: ExpenseFilter = { projectId: pid, range, categories: cats, methods, minCents: min, maxCents: max, q: search.query, categoryNames };
  const list = useExpenseList(filter, sort, limit);
  const projectName = useProject(pid)?.name ?? null;

  // What the shown expenses add up to per category (the same filters as the list), largest first.
  const w = expenseWhere(filter);
  const byCategory = useQuery<{ category: ExpenseCategory; total: number }>(
    `SELECT e.category AS category, COALESCE(SUM(e.amount_cents), 0) AS total FROM expenses e WHERE ${w.sql}
     GROUP BY e.category HAVING total > 0 ORDER BY total DESC, e.category`,
    w.args,
  );

  // The PDF: every expense the filters and the search match (not only the page shown), with them named at the top.
  const letterhead = useSetting('export_letterhead') === '1';
  const pdf = usePdfShare({
    tag: 'expenses.pdf',
    title: t('expenses'),
    make: (notice) =>
      exportExpensesPdf(filter, sort, {
        letterhead,
        onNotice: notice,
        filters: [
          { label: t('period'), value: periodLabel(period, td, t) },
          ...(search.query ? [{ label: t('search'), value: search.query }] : []),
          ...(cats.length ? [{ label: t('category'), value: cats.map((k) => t(`cat_${k}`)).join(', ') }] : []),
          ...(methods.length ? [{ label: t('method'), value: methods.map((m) => t(`method_${m}`)).join(', ') }] : []),
          ...(amountRangeLabel(min, max, t) ? [{ label: t('amount'), value: amountRangeLabel(min, max, t) ?? '' }] : []),
          { label: t('sortBy'), value: t(`sort_${sort}`) },
        ],
      }),
    details: { projectId: pid, period, sort, letterhead },
  });
  // The newest expenses and the total cost of the current project (or of all projects), as a message; the PDF has them all.
  const share = useShareSheet({
    kind: 'expenses',
    id: pid,
    pdf: { hint: `${t('pdfExpenses')} · ${projectName ?? t('allProjects')} · ${t(letterhead ? 'letterheadOption' : 'pdfPlainPaper')}`, run: pdf.run },
  });
  const rows = list.rows;
  const where = pid ? 'AND e.project_id = ?' : '';
  const args = pid ? [pid] : [];
  const unfiltered =
    useFirst<{ n: number; everything: number; month: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS everything,
              COALESCE(SUM(CASE WHEN substr(day, 1, 7) = ? THEN amount_cents END), 0) AS month
       FROM expenses e WHERE deleted_at IS NULL AND EXISTS (SELECT 1 FROM projects px WHERE px.id = e.project_id AND px.deleted_at IS NULL) ${where}`,
      [month, ...args],
    ) ?? { n: 0, everything: 0, month: 0 };
  const photos = useAttachmentCounts('expenses');
  const capped = limit > 0 && rows.length >= limit;
  const byDate = sort === 'newest' || sort === 'oldest';

  const groups = useMemo(() => {
    // Day totals come from the database, so a day cut off by the cap still shows its full total.
    const totalByDay = new Map(list.dayTotals.map((r) => [r.day, r.total]));
    const out: Group[] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.day === r.day) {
        last.rows.push(r);
        last.total += r.amount_cents;
      } else out.push({ day: r.day, total: r.amount_cents, rows: [r] });
    }
    return out.map((g) => ({ ...g, total: totalByDay.get(g.day) ?? g.total }));
  }, [rows, list.dayTotals]);

  const yesterday = addDays(td, -1);
  const dayLabel = (day: string) => (day === td ? t('today') : day === yesterday ? t('yesterday') : formatDay(day));
  const goNew = () => router.push('/expense/form');

  const filtered = period !== 'all' || cats.length > 0 || methods.length > 0 || min != null || max != null || !!search.query;
  const amountLabel = amountRangeLabel(min, max, t);
  const applied = [
    search.query ? t('nOfM', { n: list.count, m: list.unsearched }) : null,
    period !== 'all' ? periodLabel(period, td, t) : null,
    cats.length ? (cats.length <= 2 ? cats.map((k) => t(`cat_${k}`)).join(', ') : t('categoriesCount', { n: cats.length })) : null,
    methods.length ? methods.map((m) => t(`method_${m}`)).join(', ') : null,
    amountLabel,
    sort !== 'newest' ? t(`sort_${sort}`) : null,
  ].filter((s): s is string => !!s);
  const sheetCount = [cats.length > 0, methods.length > 0, min != null || max != null, sort !== 'newest'].filter(Boolean).length;
  const clear = () => {
    reset();
    search.setQuery('');
    setLimit(PAGE);
  };

  // Sorted by date the rows sit in one card per day under the day and its total; sorted by amount they are one card and say their day.
  // (React Compiler memoises this, so the list only rebuilds when the rows or the labels change.)
  const sections: CardSection<Row>[] = byDate
    ? groups.map((g) => ({ key: g.day, title: <DayHeader label={dayLabel(g.day)} total={formatLKR(g.total)} />, rows: g.rows }))
    : [{ key: 'all', rows }];

  const renderRow = (item: Row) => <ExpenseRow item={item} photos={photos.get(item.id) ?? 0} withDay={!byDate} showProject={!pid} />;

  const actions = (
    <>
      <HeroAction icon={Share2} label={t('share')} onPress={share.open} />
      <HeroAction icon={Settings} label={t('settingsAndMore')} onPress={() => router.push('/more')} />
    </>
  );

  // The hero's figure: everything on record, or (with a filter or a search) the total of what is shown. Each says the
  // same to a screen reader as the tiles it replaces: "All expenses Rs 571,450 All projects".
  const scope = pid ? '' : ` ${t('allProjects')}`;
  const figure = filtered
    ? { label: `${t('total')} · ${periodLabel(period, td, t)}`, value: formatLKR(list.total) }
    : { label: t('allExpenses'), value: formatLKR(unfiltered.everything) };
  const hero = (
    <Hero
      title={t('expenses')}
      actions={actions}
      project
      card={unfiltered.n > 0 && list.total > 0 ? <CategoryCard rows={byCategory} total={list.total} /> : undefined}>
      {unfiltered.n > 0 ? (
        <>
          <View accessible accessibilityLabel={`${figure.label} ${figure.value}${scope}`}>
            <HeroAmount label={figure.label} value={figure.value} />
          </View>
          <HeroChips>
            {filtered ? (
              <View accessible accessibilityLabel={`${t('entries')} ${list.count}`}>
                <HeroChip icon={Receipt} label={`${t('entries')} · ${list.count}`} />
              </View>
            ) : (
              <>
                <HeroChip icon={Receipt} label={t('recordsCount', { n: unfiltered.n })} />
                <View accessible accessibilityLabel={`${t('thisMonth')} ${formatLKR(unfiltered.month)}`}>
                  <HeroChip icon={Calendar} label={`${t('thisMonth')} ${formatLKR(unfiltered.month)}`} />
                </View>
              </>
            )}
          </HeroChips>
        </>
      ) : null}
    </Hero>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Screen hairlineTop={false} scroll={false} skeleton="hero">
        {unfiltered.n === 0 ? (
          <CardList
            sections={[]}
            keyOf={rowKey}
            renderRow={renderRow}
            header={hero}
            empty={<EmptyState icon={Receipt} title={t('noExpenses')} hint={t('noExpensesHint')} action={<Button icon={Plus} label={t('newExpense')} onPress={goNew} full />} />}
          />
        ) : (
          <CardList
            sections={rows.length ? sections : []}
            keyOf={rowKey}
            renderRow={renderRow}
            inset
            empty={search.noResults ?? <EmptyState icon={Search} title={t('noMatches')} hint={t('noMatchesHint')} action={<Button kind="secondary" compact label={t('clearFilters')} onPress={clear} />} compact />}
            footer={capped ? <Button kind="secondary" label={t('showAll')} onPress={() => setLimit(-1)} full /> : null}
            header={
              <View style={{ gap: space.lg }}>
                {hero}
                <ListControls
                  search={search.node}
                  period={{ value: period, onChange: (p) => set('period', p), months: list.months, today: td }}
                  sort={{ value: sort, onChange: (v) => set('sort', v), options: EXPENSE_SORTS.map((s) => ({ value: s, label: t(`sort_${s}`) })) }}
                  sheetCount={sheetCount}
                  applied={applied}
                  onClear={clear}>
                  <MultiChips
                    label={t('category')}
                    options={EXPENSE_CATEGORIES.map((k) => ({ value: k, label: t(`cat_${k}`) }))}
                    values={cats}
                    onChange={(next) => set('cats', next.join(','))}
                  />
                  <MultiChips
                    label={t('method')}
                    options={PAY_METHODS.map((m) => ({ value: m, label: t(`method_${m}`) }))}
                    values={methods}
                    onChange={(next) => set('methods', next.join(','))}
                  />
                  <AmountRange min={min} max={max} onMin={(v) => set('min', v == null ? '' : String(v))} onMax={(v) => set('max', v == null ? '' : String(v))} />
                </ListControls>
              </View>
            }
          />
        )}
      </Screen>
      {share.sheet}
    </View>
  );
}

const rowKey = (r: Row) => r.id;

/** The date over a day's card, with the day's total on the right. */
function DayHeader({ label, total }: { label: string; total: string }) {
  return (
    <View accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, paddingHorizontal: space.xs, paddingTop: space.xs }}>
      <Txt weight="semibold" color="textMuted" numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </Txt>
      <Txt weight="semibold" color="textMuted" numeric numberOfLines={1}>
        {total}
      </Txt>
    </View>
  );
}

/**
 * "By category": one bar split by each category's share of what is shown, and a tile per category (the largest four,
 * "See all" opens the rest). Shares are shades of the one blue; every tile names its category and amount in words.
 */
function CategoryCard({ rows, total }: { rows: { category: ExpenseCategory; total: number }[]; total: number }) {
  const t = useT();
  const c = useColors();
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, TILES);
  const shade = (i: number) => SHARE_OPACITY[Math.min(i, SHARE_OPACITY.length - 1)];
  return (
    <Card gap={space.md}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, minHeight: 32 }}>
        <Txt variant="bodyLg" weight="bold" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {t('byCategory')}
        </Txt>
        {rows.length > TILES ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: all }}
            accessibilityLabel={t('seeAll')}
            hitSlop={8}
            onPress={() => setAll((v) => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 }}>
            <Txt weight="bold" color="primary">
              {t('seeAll')}
            </Txt>
            {all ? <ChevronUp size={18} color={c.primary} strokeWidth={2.2} /> : <ChevronDown size={18} color={c.primary} strokeWidth={2.2} />}
          </Pressable>
        ) : null}
      </View>
      {/* the share bar: decoration, the tiles below say the same in words */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', height: 10, gap: 3 }}>
        {rows.map((r, i) => (
          <View key={r.category} style={{ flex: Math.max(r.total / Math.max(total, 1), 0.02), borderRadius: 3, backgroundColor: c.primary, opacity: shade(i) }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {shown.map((r, i) => {
          const name = t(`cat_${r.category}` as TKey);
          return (
            <View
              key={r.category}
              accessible
              accessibilityLabel={`${name} ${formatLKR(r.total)}`}
              style={{ flexGrow: 1, flexBasis: '45%', minWidth: 132, gap: 2, paddingVertical: space.md, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: c.bg }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary, opacity: shade(i) }} />
                <Txt variant="caption" weight="semibold" color="textMuted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {name}
                </Txt>
              </View>
              <Txt variant="bodyLg" weight="bold" numeric numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {formatLKR(r.total)}
              </Txt>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

/** One expense: its category icon, paid to (or the category), the details, the amount out, and a photo count badge. */
const ExpenseRow = memo(function ExpenseRow({ item, photos, withDay, showProject }: { item: Row; photos: number; withDay: boolean; showProject: boolean }) {
  const t = useT();
  const cat = t(`cat_${item.category}` as TKey);
  return (
    <ListRow
      icon={CATEGORY_ICON[item.category] ?? Receipt}
      title={item.paid_to || cat}
      subtitle={[withDay ? formatDay(item.day) : null, cat, showProject ? item.project_name : null, t(`method_${item.method}` as TKey)].filter(Boolean).join(' · ')}
      // money out: "−Rs 4,200", as in the design (U+2212, the real minus sign)
      value={`−${formatLKR(item.amount_cents)}`}
      badge={photos ? <Badge icon={Camera} label={String(photos)} /> : undefined}
      noChevron
      onPress={() => router.push(`/expense/form?id=${item.id}`)}
    />
  );
});
