import { router } from 'expo-router';
import { FileText, Plus, Search } from 'lucide-react-native';
import { memo, useMemo, useState } from 'react';
import { View } from 'react-native';

import { EstimateStatusBadge } from '@/components/EstimateBits';
import { ListControls, oneOf, periodLabel, periodRange, toPeriod, useListPrefs, useToday } from '@/components/ListControls';
import { Button } from '@/components/ui/Button';
import { CardList } from '@/components/ui/CardList';
import { EmptyState } from '@/components/ui/feedback';
import { SearchField } from '@/components/ui/form';
import { ListRow, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { ESTIMATE_STATUSES, type EstimateListRow, type EstimateStatus } from '@/db/types';
import { ESTIMATE_SORTS, useEstimateList, type EstimateSort } from '@/hooks/data';
import { useT } from '@/i18n';
import { formatDay } from '@/lib/dates';
import { formatLKR } from '@/lib/money';
import { space } from '@/theme';

type Filter = 'all' | EstimateStatus;

/** Status chips appear above this many estimates, the search box above the second number (docs/ESTIMATES.md section 6). */
const FILTER_FROM = 5;
const SEARCH_FROM = 8;

/** What the estimate list remembers (settings `list_estimates_<field>`); these are the defaults. */
const DEFAULTS = { status: 'all', period: 'all', sort: 'newest' };

/**
 * The estimates (quotations), newest first. A stack screen opened from More; New estimate is the one primary action.
 * The control bar holds the status chips (from 6 estimates); the period (by issue date, with a month picker) and the
 * order (newest, oldest, highest or lowest total) are in its sheet, because quotations are few a month and the
 * status is what the owner sorts them by.
 */
export default function EstimatesScreen() {
  const t = useT();
  const td = useToday();
  const { prefs, set, reset } = useListPrefs('estimates', DEFAULTS);
  const period = toPeriod(prefs.period);
  const sort = oneOf<EstimateSort>(prefs.sort, ESTIMATE_SORTS, 'newest');
  const filter = oneOf<Filter>(prefs.status, ['all', ...ESTIMATE_STATUSES], 'all');
  const { rows, months, total } = useEstimateList(periodRange(period, td), sort);
  const [q, setQ] = useState('');

  const goNew = () => router.push('/estimate/form');
  // Chips and search only count while they are on screen, so a filter can never hide rows invisibly.
  const showFilter = total > FILTER_FROM;
  const query = total > SEARCH_FROM ? q.trim().toLowerCase() : '';

  const { counts, visible, activeFilter } = useMemo(() => {
    const counts: Record<EstimateStatus, number> = { draft: 0, sent: 0, accepted: 0, declined: 0 };
    rows.forEach((r) => {
      counts[r.status] += 1;
    });
    // a chip whose count dropped to 0 is disabled: fall back to All instead of an empty list behind a dead chip
    const chosen: Filter = showFilter ? filter : 'all';
    const activeFilter: Filter = chosen !== 'all' && counts[chosen] === 0 ? 'all' : chosen;
    const matches = (r: EstimateListRow) => !query || [r.client_name, r.title, r.number].some((s) => s.toLowerCase().includes(query));
    return { counts, activeFilter, visible: rows.filter((r) => matches(r) && (activeFilter === 'all' || r.status === activeFilter)) };
  }, [rows, query, filter, showFilter]);

  const applied = [
    period !== 'all' ? periodLabel(period, td, t) : null,
    activeFilter !== 'all' ? t(`estStatus_${activeFilter}`) : null,
    sort !== 'newest' ? t(`sort_${sort}`) : null,
  ].filter((s): s is string => !!s);
  const sheetCount = [period !== 'all', sort !== 'newest'].filter(Boolean).length;

  const renderRow = (e: EstimateListRow) => <EstimateRow e={e} />;

  // The empty state carries the primary button itself, so the footer button is only for a list that has rows.
  if (total === 0) {
    return (
      <Screen>
        <EmptyState icon={FileText} title={t('noEstimates')} hint={t('noEstimatesHint')} action={<Button icon={Plus} label={t('newEstimate')} onPress={goNew} full />} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <CardList
        sections={[{ key: 'all', rows: visible }]}
        keyOf={estimateKey}
        renderRow={renderRow}
        inset
        stickyFooter={<Button icon={Plus} label={t('newEstimate')} onPress={goNew} full />}
        empty={<EmptyState icon={Search} title={`0 ${t('estimates')}`} hint={query ? `"${q.trim()}"` : undefined} />}
        header={
          <View style={{ gap: space.md }}>
            {total > SEARCH_FROM ? <SearchField value={q} onChangeText={setQ} placeholder={t('search')} /> : null}
            <ListControls
              quick={
                showFilter
                  ? {
                      value: activeFilter,
                      onChange: (v) => set('status', v),
                      options: [
                        { value: 'all', label: t('all') },
                        ...ESTIMATE_STATUSES.map((s) => ({ value: s, label: t(`estStatus_${s}`), count: counts[s], disabled: counts[s] === 0 })),
                      ],
                    }
                  : undefined
              }
              period={{ value: period, onChange: (p) => set('period', p), months, today: td, inSheet: true }}
              sort={{ value: sort, onChange: (v) => set('sort', v), options: ESTIMATE_SORTS.map((s) => ({ value: s, label: t(`sort_${s}`) })) }}
              sheetCount={sheetCount}
              applied={applied}
              onClear={reset}
            />
          </View>
        }
      />
    </Screen>
  );
}

const estimateKey = (e: EstimateListRow) => e.id;

/** One estimate: client, title, status badge, number and date, total. */
const EstimateRow = memo(function EstimateRow({ e }: { e: EstimateListRow }) {
  const t = useT();
  return (
    <ListRow
      icon={FileText}
      title={e.client_name}
      subtitle={e.title}
      value={formatLKR(e.total_cents)}
      accessibilityLabel={`${e.client_name}, ${e.title}, ${e.number}, ${t(`estStatus_${e.status}`)}, ${formatLKR(e.total_cents)}`}
      badge={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          <EstimateStatusBadge status={e.status} />
          <Txt variant="caption" color="textMuted" numeric>
            {`${e.number} · ${formatDay(e.issue_day)}`}
          </Txt>
        </View>
      }
      onPress={() => router.push(`/estimate/${e.id}`)}
    />
  );
});
