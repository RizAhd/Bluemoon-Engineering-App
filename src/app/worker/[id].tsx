import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Banknote, CalendarCheck, HandCoins, Pencil, Phone } from 'lucide-react-native';
import { Alert, Linking, View } from 'react-native';

import { Stat } from '@/components/Stats';
import { Button, HeaderButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/feedback';
import { Card, ListCard, ListRow, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst, useQuery } from '@/db';
import { deleteRecord, saveWorker } from '@/db/repo';
import type { WageEntry, Worker, WorkerBalance } from '@/db/types';
import { useT } from '@/i18n';
import { formatDay } from '@/lib/dates';
import { formatLKR } from '@/lib/money';
import { space } from '@/theme';

const ICON = { work: CalendarCheck, advance: HandCoins, payment: Banknote } as const;

export default function WorkerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const worker = useFirst<Worker>('SELECT * FROM workers WHERE id = ? AND deleted_at IS NULL', [id]);
  const bal = useFirst<WorkerBalance>('SELECT * FROM v_worker_balance WHERE worker_id = ?', [id]);
  const entries = useQuery<WageEntry & { project_name: string | null }>(
    `SELECT w.*, p.name AS project_name FROM wage_entries w LEFT JOIN projects p ON p.id = w.project_id
     WHERE w.worker_id = ? AND w.deleted_at IS NULL ORDER BY w.day DESC, w.created_at DESC`,
    [id],
  );

  if (!worker || !bal) return null;
  const b = bal.balance_cents;

  function onEntry(e: WageEntry) {
    Alert.alert(t(`wage_${e.kind}`), `${formatDay(e.day)} · ${formatLKR(e.amount_cents)}`, [
      { text: t('close'), style: 'cancel' },
      { text: t('edit'), onPress: () => router.push(`/wage/form?id=${e.id}`) },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () =>
          Alert.alert(t('confirmDelete'), t('confirmDeleteBody'), [
            { text: t('cancel'), style: 'cancel' },
            { text: t('delete'), style: 'destructive', onPress: () => deleteRecord('wage_entries', e.id) },
          ]),
      },
    ]);
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: worker.name,
          headerRight: () => <HeaderButton icon={Pencil} label={t('editWorker')} onPress={() => router.push(`/worker/form?id=${worker.id}`)} />,
        }}
      />
      <Screen>
        <Card tone={b > 0 ? 'dangerSoft' : b < 0 ? 'warningSoft' : 'successSoft'} style={{ borderColor: 'transparent' }}>
          <Txt weight="semibold" color={b > 0 ? 'danger' : b < 0 ? 'warning' : 'success'}>
            {b > 0 ? t('weOwe') : b < 0 ? t('workerOwes') : t('settled')}
          </Txt>
          <Txt variant="amountXl" weight="bold" numeric color={b > 0 ? 'danger' : b < 0 ? 'warning' : 'success'}>
            {formatLKR(Math.abs(b))}
          </Txt>
          <Txt color="textMuted">
            {[worker.trade, worker.daily_rate_cents ? `${t('dailyRate')} ${formatLKR(worker.daily_rate_cents)}` : null].filter(Boolean).join(' · ')}
          </Txt>
        </Card>

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Stat label={t('earned')} value={formatLKR(bal.earned_cents)} />
          <Stat label={t('advances')} value={formatLKR(bal.advance_cents)} />
          <Stat label={t('paid')} value={formatLKR(bal.paid_cents)} />
        </View>

        <View style={{ gap: space.sm }}>
          <Button icon={CalendarCheck} label={t('recordWork')} onPress={() => router.push(`/wage/form?workerId=${worker.id}&kind=work`)} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button kind="secondary" icon={HandCoins} label={t('giveAdvance')} onPress={() => router.push(`/wage/form?workerId=${worker.id}&kind=advance`)} style={{ flex: 1 }} />
            <Button kind="secondary" icon={Banknote} label={t('payWages')} onPress={() => router.push(`/wage/form?workerId=${worker.id}&kind=payment${b > 0 ? `&amount=${b}` : ''}`)} style={{ flex: 1 }} />
          </View>
          {worker.phone ? <Button kind="ghost" icon={Phone} label={worker.phone} onPress={() => Linking.openURL(`tel:${worker.phone}`)} /> : null}
        </View>

        <SectionTitle title={t('history')} />
        {entries.length ? (
          <ListCard>
            {entries.map((e) => (
              <ListRow
                key={e.id}
                icon={ICON[e.kind]}
                iconTone={e.kind === 'work' ? 'slate' : 'primary'}
                title={`${t(`wage_${e.kind}`)}${e.kind === 'work' && e.days ? ` · ${e.days} ${t('days')}` : ''}`}
                subtitle={[formatDay(e.day), e.project_name, e.note].filter(Boolean).join(' · ')}
                value={`${e.kind === 'work' ? '+' : '−'}${formatLKR(e.amount_cents)}`}
                valueTone={e.kind === 'work' ? 'text' : 'primary'}
                onPress={() => onEntry(e)}
              />
            ))}
          </ListCard>
        ) : (
          <Txt color="textMuted">{t('recordWork')} · {t('giveAdvance')} · {t('payWages')}</Txt>
        )}

        <Button
          kind="ghost"
          label={worker.active ? t('markInactive') : t('markActive')}
          onPress={() => saveWorker({ ...worker, active: !worker.active })}
        />
        {!worker.active ? <Badge label={t('inactive')} /> : null}
      </Screen>
    </>
  );
}
