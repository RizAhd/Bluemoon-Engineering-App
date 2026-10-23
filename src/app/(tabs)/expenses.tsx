import { router } from 'expo-router';
import { Camera, Plus, Receipt, Search } from 'lucide-react-native';
import { memo, useMemo, useState } from 'react';
import { View } from 'react-native';

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
import { TabHeader } from '@/components/ProjectSwitcher';
import { ShareHeaderButton, useShareSheet } from '@/components/ShareSheet';
import { Stat, Tiles } from '@/components/Stats';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { CardList, type CardSection } from '@/components/ui/CardList';
import { AmountField, HelperText, Label } from '@/components/ui/form';
import { ListRow, Screen } from '@/components/ui/layout';
import { useFirst } from '@/db';
import { EXPENSE_CATEGORIES, PAY_METHODS, type Expense } from '@/db/types';
import { EXPENSE_SORTS, useAttachmentCounts, useCurrentProjectId, useExpenseList, type ExpenseSort } from '@/hooks/data';
import { useT, type TKey } from '@/i18n';
import { addDays, formatDay } from '@/lib/dates';
import { centsToInput, formatLKR, parseCents } from '@/lib/money';
import { space, useColors } from '@/theme';

type Row = Expense & { project_name: string };
type Group = { day: string; total: number; rows: Row[] };

/** How many expenses the list loads at first; "Show all" lifts the cap. */
const PAGE = 500;

/** What the Expenses tab remembers (settings `list_expenses_<field>`); these are the defaults. */
const DEFAULTS = { period: 'all', sort: 'newest', cats: '', methods: '', min: '', max: '' };

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
 * Expenses tab: the control bar (period chips, Filter & sort), tiles with the totals of what is shown, then one
 * card per day with the day total beside its label; sorted by amount it is one flat list instead.
 * Filtering, totals and order all happen in the database.
 */
export default function ExpensesScreen() {
  const t = useT();
  const c = useColors();
  const pid = useCurrentProjectId();
  const td = useToday();
  const month = td.slice(0, 7);
  const [limit, setLimit] = useState(PAGE); // -1 = no cap
  // The newest expenses and the total cost of the current project (or of all projects), as a message.
  const share = useShareSheet({ kind: 'expenses', id: pid });

  const { prefs, set, reset } = useListPrefs('expenses', DEFAULTS);
  const period = toPeriod(prefs.period);
  const sort = oneOf<ExpenseSort>(prefs.sort, EXPENSE_SORTS, 'newest');
  const cats = listOf(prefs.cats, EXPENSE_CATEGORIES);
  const methods = listOf(prefs.methods, PAY_METHODS);
  const min = centsOf(prefs.min);
  const max = centsOf(prefs.max);
  const range = periodRange(period, td);

  const list = useExpenseList({ projectId: pid, range, categories: cats, methods, minCents: min, maxCents: max }, sort, limit);
  const rows = list.rows;
  const where = pid ? 'AND e.project_id = ?' : '';
  const args = pid ? [pid] : [];
  const unfiltered =
    useFirst<{ n: number; everything: number; month: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS everything,
              COALESCE(SUM(CASE WHEN substr(day, 1, 7) = ? THEN amount_cents END), 0) AS month
       FROM expenses e WHERE deleted_at IS NULL ${where}`,
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

  const filtered = period !== 'all' || cats.length > 0 || methods.length > 0 || min != null || max != null;
  const amountLabel = amountRangeLabel(min, max, t);
  const applied = [
    period !== 'all' ? periodLabel(period, td, t) : null,
    cats.length ? (cats.length <= 2 ? cats.map((k) => t(`cat_${k}`)).join(', ') : t('categoriesCount', { n: cats.length })) : null,
    methods.length ? methods.map((m) => t(`method_${m}`)).join(', ') : null,
    amountLabel,
    sort !== 'newest' ? t(`sort_${sort}`) : null,
  ].filter((s): s is string => !!s);
  const sheetCount = [cats.length > 0, methods.length > 0, min != null || max != null, sort !== 'newest'].filter(Boolean).length;
  const clear = () => {
    reset();
    setLimit(PAGE);
  };

  // Sorted by date the rows sit in one card per day under the day's total; sorted by amount they are one card and say their day.
  // (React Compiler memoises this, so the list only rebuilds when the rows or the labels change.)
  const sections: CardSection<Row>[] = byDate
    ? groups.map((g) => ({ key: g.day, label: dayLabel(g.day), value: formatLKR(g.total), rows: g.rows }))
    : [{ key: 'all', rows }];

  const renderRow = (item: Row) => <ExpenseRow item={item} photos={photos.get(item.id) ?? 0} withDay={!byDate} showProject={!pid} />;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TabHeader title={t('expenses')} right={<ShareHeaderButton onPress={share.open} />} />
      <Screen hairlineTop={false} scroll={false}>
        {unfiltered.n === 0 ? (
          <CardList
            sections={[]}
            keyOf={rowKey}
            renderRow={renderRow}
            empty={<EmptyState icon={Receipt} title={t('noExpenses')} hint={t('noExpensesHint')} action={<Button icon={Plus} label={t('newExpense')} onPress={goNew} full />} />}
          />
        ) : (
          <CardList
            sections={rows.length ? sections : []}
            keyOf={rowKey}
            renderRow={renderRow}
            inset
            empty={<EmptyState icon={Search} title={t('noMatches')} hint={t('noMatchesHint')} action={<Button kind="secondary" compact label={t('clearFilters')} onPress={clear} />} compact />}
            footer={capped ? <Button kind="secondary" label={t('showAll')} onPress={() => setLimit(-1)} full /> : null}
            header={
              <View style={{ gap: space.md }}>
                <ListControls
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
                {filtered ? (
                  <Tiles>
                    <Stat label={`${t('total')} · ${periodLabel(period, td, t)}`} value={formatLKR(list.total)} caption={pid ? undefined : t('allProjects')} style={{ flex: 1 }} />
                    <Stat label={t('entries')} value={String(list.count)} style={{ flex: 1 }} />
                  </Tiles>
                ) : (
                  <Tiles>
                    <Stat label={t('thisMonth')} value={formatLKR(unfiltered.month)} style={{ flex: 1 }} />
                    <Stat label={t('allExpenses')} value={formatLKR(unfiltered.everything)} caption={pid ? undefined : t('allProjects')} style={{ flex: 1 }} />
                  </Tiles>
                )}
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

/** One expense: paid to (or the category), the details, the amount, and a photo count badge. */
const ExpenseRow = memo(function ExpenseRow({ item, photos, withDay, showProject }: { item: Row; photos: number; withDay: boolean; showProject: boolean }) {
  const t = useT();
  const cat = t(`cat_${item.category}` as TKey);
  return (
    <ListRow
      icon={Receipt}
      title={item.paid_to || cat}
      subtitle={[withDay ? formatDay(item.day) : null, cat, showProject ? item.project_name : null, t(`method_${item.method}` as TKey)].filter(Boolean).join(' · ')}
      value={formatLKR(item.amount_cents)}
      badge={photos ? <Badge icon={Camera} label={String(photos)} /> : undefined}
      noChevron
      onPress={() => router.push(`/expense/form?id=${item.id}`)}
    />
  );
});
