import { router } from 'expo-router';
import { Camera, Receipt } from 'lucide-react-native';
import { SectionList, View } from 'react-native';

import { TabHeader } from '@/components/ProjectSwitcher';
import { Stat } from '@/components/Stats';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { ListRow } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst, useQuery } from '@/db';
import type { Expense } from '@/db/types';
import { useAttachmentCounts, useCurrentProjectId } from '@/hooks/data';
import { useT, type TKey } from '@/i18n';
import { formatDay, today } from '@/lib/dates';
import { formatLKR } from '@/lib/money';
import { radius, space, useColors } from '@/theme';

type Row = Expense & { project_name: string };

export default function ExpensesScreen() {
  const t = useT();
  const c = useColors();
  const pid = useCurrentProjectId();
  const month = today().slice(0, 7);
  const where = pid ? 'AND e.project_id = ?' : '';
  const args = pid ? [pid] : [];

  const rows = useQuery<Row>(
    `SELECT e.*, p.name AS project_name FROM expenses e JOIN projects p ON p.id = e.project_id
     WHERE e.deleted_at IS NULL ${where} ORDER BY e.day DESC, e.created_at DESC LIMIT 500`,
    args,
  );
  const monthTotal =
    useFirst<{ s: number }>(
      `SELECT COALESCE(SUM(amount_cents),0) AS s FROM expenses e WHERE deleted_at IS NULL AND substr(day,1,7) = ? ${where}`,
      [month, ...args],
    )?.s ?? 0;
  const allTotal =
    useFirst<{ s: number }>(`SELECT COALESCE(SUM(amount_cents),0) AS s FROM expenses e WHERE deleted_at IS NULL ${where}`, args)?.s ?? 0;
  const photos = useAttachmentCounts('expenses');

  const sections: { title: string; total: number; data: Row[] }[] = [];
  for (const r of rows) {
    const last = sections[sections.length - 1];
    if (last && last.title === r.day) {
      last.data.push(r);
      last.total += r.amount_cents;
    } else sections.push({ title: r.day, total: r.amount_cents, data: [r] });
  }

  return (
    <View style={{ flex: 1 }}>
      <TabHeader title={t('expenses')} />
      <SectionList
        sections={sections}
        keyExtractor={(r) => r.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 140 }}
        ListHeaderComponent={
          rows.length ? (
            <View style={{ flexDirection: 'row', gap: space.md, marginBottom: space.md }}>
              <Stat label={t('thisMonth')} value={formatLKR(monthTotal)} />
              <Stat label={t('totalCost')} value={formatLKR(allTotal)} />
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          <EmptyState
            icon={Receipt}
            title={t('noExpenses')}
            hint={t('noExpensesHint')}
            action={<Button icon={Camera} label={t('newExpense')} onPress={() => router.push('/expense/form')} full />}
          />
        }
        renderSectionHeader={({ section }) => (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: space.lg, paddingBottom: space.sm }}>
            <Txt weight="bold" color="textMuted">
              {section.title === today() ? t('today') : formatDay(section.title)}
            </Txt>
            <Txt weight="bold" color="textMuted" numeric>
              {formatLKR(section.total)}
            </Txt>
          </View>
        )}
        renderItem={({ item, index, section }) => {
          const first = index === 0;
          const last = index === section.data.length - 1;
          const n = photos.get(item.id) ?? 0;
          return (
            <View
              style={{
                borderWidth: 1,
                borderTopWidth: first ? 1 : 0,
                borderColor: c.border,
                borderTopLeftRadius: first ? radius.lg : 0,
                borderTopRightRadius: first ? radius.lg : 0,
                borderBottomLeftRadius: last ? radius.lg : 0,
                borderBottomRightRadius: last ? radius.lg : 0,
                overflow: 'hidden',
              }}>
              <ListRow
                icon={Receipt}
                iconTone="primary"
                title={item.paid_to || t(`cat_${item.category}` as TKey)}
                subtitle={[t(`cat_${item.category}` as TKey), pid ? null : item.project_name, t(`method_${item.method}` as TKey)]
                  .filter(Boolean)
                  .join(' · ')}
                value={formatLKR(item.amount_cents)}
                badge={n ? <Badge icon={Camera} label={String(n)} /> : undefined}
                onPress={() => router.push(`/expense/form?id=${item.id}`)}
              />
            </View>
          );
        }}
      />
    </View>
  );
}
