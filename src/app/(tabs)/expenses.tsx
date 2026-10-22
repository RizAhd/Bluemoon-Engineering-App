import { router } from 'expo-router';
import { Camera, Plus, Receipt } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { AppState, View } from 'react-native';

import { TabHeader } from '@/components/ProjectSwitcher';
import { Stat, Tiles } from '@/components/Stats';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { GroupLabel, ListCard, ListRow, Screen } from '@/components/ui/layout';
import { useFirst, useQuery } from '@/db';
import type { Expense } from '@/db/types';
import { useAttachmentCounts, useCurrentProjectId } from '@/hooks/data';
import { useT, type TKey } from '@/i18n';
import { formatDay, toDay, today } from '@/lib/dates';
import { formatLKR } from '@/lib/money';
import { space, useColors } from '@/theme';

type Row = Expense & { project_name: string };
type Group = { day: string; total: number; rows: Row[] };

/** How many expenses the list loads at first; "Show all" lifts the cap. */
const PAGE = 500;

/** Today's date, kept current: it changes at local midnight and when the app comes back to the front. */
function useToday(): string {
  const [day, setDay] = useState(today);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      setDay(today());
      clearTimeout(timer);
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
      timer = setTimeout(refresh, Math.max(1000, midnight.getTime() - now.getTime()));
    };
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);
  return day;
}

/** Expenses tab: month and total tiles, then one card per day with the day total beside its label. */
export default function ExpensesScreen() {
  const t = useT();
  const c = useColors();
  const pid = useCurrentProjectId();
  const td = useToday();
  const month = td.slice(0, 7);
  const [limit, setLimit] = useState(PAGE); // -1 = no cap
  const where = pid ? 'AND e.project_id = ?' : '';
  const args = pid ? [pid] : [];

  const rows = useQuery<Row>(
    `SELECT e.*, p.name AS project_name FROM expenses e JOIN projects p ON p.id = e.project_id
     WHERE e.deleted_at IS NULL ${where} ORDER BY e.day DESC, e.created_at DESC LIMIT ?`,
    [...args, limit],
  );
  const monthTotal =
    useFirst<{ s: number }>(
      `SELECT COALESCE(SUM(amount_cents),0) AS s FROM expenses e WHERE deleted_at IS NULL AND substr(day,1,7) = ? ${where}`,
      [month, ...args],
    )?.s ?? 0;
  const allTotal =
    useFirst<{ s: number }>(`SELECT COALESCE(SUM(amount_cents),0) AS s FROM expenses e WHERE deleted_at IS NULL ${where}`, args)?.s ?? 0;
  // Day totals come from the database, so a day cut off by the cap still shows its full total.
  const dayTotals = useQuery<{ day: string; s: number }>(
    `SELECT day, COALESCE(SUM(amount_cents),0) AS s FROM expenses e WHERE deleted_at IS NULL ${where} GROUP BY day`,
    args,
  );
  const photos = useAttachmentCounts('expenses');
  const capped = limit > 0 && rows.length >= limit;

  const groups = useMemo(() => {
    const totalByDay = new Map(dayTotals.map((r) => [r.day, r.s]));
    const out: Group[] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.day === r.day) {
        last.rows.push(r);
        last.total += r.amount_cents;
      } else out.push({ day: r.day, total: r.amount_cents, rows: [r] });
    }
    return out.map((g) => ({ ...g, total: totalByDay.get(g.day) ?? g.total }));
  }, [rows, dayTotals]);

  const yesterday = useMemo(() => {
    const [y, m, d] = td.split('-').map(Number);
    return toDay(new Date(y, m - 1, d - 1));
  }, [td]);

  const dayLabel = (day: string) => (day === td ? t('today') : day === yesterday ? t('yesterday') : formatDay(day));
  const goNew = () => router.push('/expense/form');

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TabHeader title={t('expenses')} />
      <Screen hairlineTop={false} gap={space.md}>
        {rows.length === 0 ? (
          <EmptyState icon={Receipt} title={t('noExpenses')} hint={t('noExpensesHint')} action={<Button icon={Plus} label={t('newExpense')} onPress={goNew} full />} />
        ) : (
          <>
            <Tiles>
              <Stat label={t('thisMonth')} value={formatLKR(monthTotal)} style={{ flex: 1 }} />
              <Stat label={t('totalCost')} value={formatLKR(allTotal)} caption={pid ? undefined : t('allProjects')} style={{ flex: 1 }} />
            </Tiles>
            {groups.map((g) => (
              <View key={g.day} style={{ gap: space.sm }}>
                <GroupLabel label={dayLabel(g.day)} value={formatLKR(g.total)} />
                <ListCard inset>
                  {g.rows.map((item) => {
                    const n = photos.get(item.id) ?? 0;
                    const cat = t(`cat_${item.category}` as TKey);
                    return (
                      <ListRow
                        key={item.id}
                        icon={Receipt}
                        title={item.paid_to || cat}
                        subtitle={[cat, pid ? null : item.project_name, t(`method_${item.method}` as TKey)].filter(Boolean).join(' · ')}
                        value={formatLKR(item.amount_cents)}
                        badge={n ? <Badge icon={Camera} label={String(n)} /> : undefined}
                        noChevron
                        onPress={() => router.push(`/expense/form?id=${item.id}`)}
                      />
                    );
                  })}
                </ListCard>
              </View>
            ))}
            {capped ? <Button kind="secondary" label={t('showAll')} onPress={() => setLimit(-1)} full /> : null}
          </>
        )}
      </Screen>
    </View>
  );
}
