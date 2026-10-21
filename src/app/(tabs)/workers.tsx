import { router } from 'expo-router';
import { HardHat, UserPlus } from 'lucide-react-native';
import { FlatList, View } from 'react-native';

import { TabHeader } from '@/components/ProjectSwitcher';
import { Stat } from '@/components/Stats';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { ListRow } from '@/components/ui/layout';
import { useQuery } from '@/db';
import type { WorkerBalance } from '@/db/types';
import { useT } from '@/i18n';
import { formatLKR } from '@/lib/money';
import { radius, space, useColors } from '@/theme';

export default function WorkersScreen() {
  const t = useT();
  const c = useColors();
  const rows = useQuery<WorkerBalance>('SELECT * FROM v_worker_balance ORDER BY active DESC, name COLLATE NOCASE');
  const toPay = rows.reduce((s, r) => s + Math.max(0, r.balance_cents), 0);
  const advanceOver = rows.reduce((s, r) => s + Math.max(0, -r.balance_cents), 0);

  return (
    <View style={{ flex: 1 }}>
      <TabHeader title={t('workers')} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.worker_id}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 140, gap: space.sm }}
        ListHeaderComponent={
          rows.length ? (
            <View style={{ gap: space.md, marginBottom: space.sm }}>
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <Stat label={t('wagesToPay')} value={formatLKR(toPay)} tone={toPay ? 'danger' : 'text'} />
                <Stat label={t('workerOwes')} value={formatLKR(advanceOver)} />
              </View>
              <Button kind="secondary" icon={UserPlus} label={t('newWorker')} onPress={() => router.push('/worker/form')} />
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          <EmptyState
            icon={HardHat}
            title={t('noWorkers')}
            hint={t('noWorkersHint')}
            action={<Button icon={UserPlus} label={t('newWorker')} onPress={() => router.push('/worker/form')} full />}
          />
        }
        renderItem={({ item }) => {
          const bal = item.balance_cents;
          return (
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: 'hidden', opacity: item.active ? 1 : 0.6 }}>
              <ListRow
                icon={HardHat}
                title={item.name}
                subtitle={[item.trade, item.daily_rate_cents ? `${formatLKR(item.daily_rate_cents)} / ${t('days')}` : null].filter(Boolean).join(' · ')}
                value={bal ? formatLKR(Math.abs(bal)) : undefined}
                valueTone={bal > 0 ? 'danger' : bal < 0 ? 'warning' : 'text'}
                badge={
                  !item.active ? (
                    <Badge label={t('inactive')} />
                  ) : bal > 0 ? (
                    <Badge tone="danger" label={t('weOwe')} />
                  ) : bal < 0 ? (
                    <Badge tone="warning" label={t('workerOwes')} />
                  ) : (
                    <Badge tone="success" label={t('settled')} />
                  )
                }
                onPress={() => router.push(`/worker/${item.worker_id}`)}
              />
            </View>
          );
        }}
      />
    </View>
  );
}
