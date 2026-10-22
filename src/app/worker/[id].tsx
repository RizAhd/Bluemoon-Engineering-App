import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Banknote, Building2, CalendarCheck, HandCoins, Pencil, Phone, Trash2, UserX } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, View } from 'react-native';

import { Stat, Tiles } from '@/components/Stats';
import { Button, HeaderButton } from '@/components/ui/Button';
import { Badge, EmptyState, toast } from '@/components/ui/feedback';
import { Chips, PickerSheet } from '@/components/ui/form';
import { Card, ListCard, ListRow, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst, useQuery } from '@/db';
import { deleteRecord, saveWorker, unassignWorker } from '@/db/repo';
import type { WageEntry, WageKind, Worker, WorkerBalance } from '@/db/types';
import { useCurrentProjectId, useProjects, useWorkerProjects } from '@/hooks/data';
import { useT } from '@/i18n';
import { formatDay } from '@/lib/dates';
import { showError } from '@/lib/errors';
import { formatLKR } from '@/lib/money';
import { space, useColors } from '@/theme';

const ICON = { work: CalendarCheck, advance: HandCoins, payment: Banknote } as const;
const ALL = '__all';

function BalanceBadge({ balance }: { balance: number }) {
  const t = useT();
  if (balance > 0) return <Badge tone="danger" label={t('weOwe')} />;
  if (balance < 0) return <Badge tone="warning" label={t('workerOwes')} />;
  return <Badge tone="success" label={t('settled')} />;
}

export default function WorkerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const c = useColors();
  const pid = useCurrentProjectId();
  const worker = useFirst<Worker>('SELECT * FROM workers WHERE id = ? AND deleted_at IS NULL', [id ?? '']);
  const bal = useFirst<WorkerBalance>('SELECT * FROM v_worker_balance WHERE worker_id = ?', [id ?? '']);
  const wp = useWorkerProjects(id ?? '');
  const allProjects = useProjects();
  const entries = useQuery<WageEntry & { project_name: string | null }>(
    `SELECT w.*, p.name AS project_name FROM wage_entries w LEFT JOIN projects p ON p.id = w.project_id
     WHERE w.worker_id = ? AND w.deleted_at IS NULL ORDER BY w.day DESC, w.created_at DESC`,
    [id ?? ''],
  );
  const [filter, setFilter] = useState<string | null>(null);
  const [picking, setPicking] = useState<WageKind | null>(null);

  // Projects that appear in the history, for the filter chips.
  const historyProjects = useMemo(() => {
    const seen = new Map<string, string>();
    entries.forEach((e) => {
      if (e.project_id && e.project_name && !seen.has(e.project_id)) seen.set(e.project_id, e.project_name);
    });
    return [...seen.entries()].map(([pId, name]) => ({ id: pId, name }));
  }, [entries]);

  // The worker was deleted (from the edit form on top of this screen): leave instead of showing an empty shell.
  const gone = !!id && (!worker || !bal);
  useFocusEffect(
    useCallback(() => {
      if (gone && router.canGoBack()) router.back();
    }, [gone]),
  );

  if (!worker || !bal) {
    return (
      <>
        <Stack.Screen options={{ title: t('worker') }} />
        <Screen>
          <EmptyState icon={Building2} title={t('worker')} action={<Button kind="secondary" label={t('close')} onPress={() => router.back()} full />} />
        </Screen>
      </>
    );
  }

  const b = bal.balance_cents;
  const tone = b > 0 ? 'dangerSoft' : b < 0 ? 'warningSoft' : 'successSoft';
  const toneText = b > 0 ? 'danger' : b < 0 ? 'warning' : 'success';
  // The chosen filter only counts while that project is still in the history; otherwise fall back to the default.
  const filterValid = filter === ALL || (filter != null && historyProjects.some((p) => p.id === filter));
  const activeFilter = filterValid && filter ? filter : pid && historyProjects.some((p) => p.id === pid) ? pid : ALL;
  const hasUnassigned = entries.some((e) => !e.project_id || !e.project_name);
  const showChips = historyProjects.length > 1 || (historyProjects.length >= 1 && hasUnassigned);
  const shown = activeFilter === ALL ? entries : entries.filter((e) => e.project_id === activeFilter);
  const onCurrent = !!pid && wp.some((p) => p.project_id === pid);

  /** Which project an action belongs to: current project if the worker is on it, the only one, else ask. */
  function actionProject(): string | null {
    if (pid && wp.some((p) => p.project_id === pid)) return pid;
    if (wp.length === 1) return wp[0].project_id;
    if (wp.length === 0 && pid) return pid;
    return null;
  }

  function go(kind: WageKind, projectId: string) {
    const owed = wp.find((p) => p.project_id === projectId)?.balance_cents ?? 0;
    const amount = kind === 'payment' && owed > 0 ? `&amount=${owed}` : '';
    router.push(`/wage/form?workerId=${worker!.id}&kind=${kind}&projectId=${projectId}${amount}`);
  }

  function act(kind: WageKind) {
    const projectId = actionProject();
    if (projectId) go(kind, projectId);
    else setPicking(kind);
  }

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
            {
              text: t('delete'),
              style: 'destructive',
              onPress: () => {
                try {
                  deleteRecord('wage_entries', e.id);
                  toast(t('deleted'));
                } catch (err) {
                  showError(err, 'worker.deleteEntry', t, { id: e.id });
                }
              },
            },
          ]),
      },
    ]);
  }

  function toggleActive() {
    try {
      saveWorker({
        id: worker!.id,
        name: worker!.name,
        phone: worker!.phone,
        trade: worker!.trade,
        daily_rate_cents: worker!.daily_rate_cents,
        active: !worker!.active,
      });
    } catch (e) {
      showError(e, 'worker.toggleActive', t, { id: worker!.id });
    }
  }

  function removeFromCurrent() {
    if (!pid) return;
    // Off the project, the balance leaves every project total: say so, and offer to settle it first.
    const owed = wp.find((p) => p.project_id === pid)?.balance_cents ?? 0;
    const body = owed ? `${t(owed > 0 ? 'weOwe' : 'workerOwes')}: ${formatLKR(Math.abs(owed))}\n${t('removeFromProjectBody')}` : t('removeFromProjectBody');
    Alert.alert(t('removeFromProject'), body, [
      { text: t('cancel'), style: 'cancel' },
      ...(owed > 0 ? [{ text: t('payNow'), onPress: () => go('payment', pid) }] : []),
      {
        text: t('removeFromProject'),
        style: 'destructive',
        onPress: () => {
          try {
            unassignWorker(pid, worker!.id);
            toast(t('deleted'));
          } catch (e) {
            showError(e, 'worker.unassign', t, { projectId: pid, workerId: worker!.id });
          }
        },
      },
    ]);
  }

  const pickerItems = (wp.length ? wp.map((p) => ({ id: p.project_id, title: p.project_name })) : allProjects.map((p) => ({ id: p.id, title: p.name }))).map((p) => ({
    ...p,
    icon: Building2,
  }));

  return (
    <>
      <Stack.Screen
        options={{
          title: worker.name,
          headerRight: () => <HeaderButton icon={Pencil} label={t('editWorker')} onPress={() => router.push(`/worker/form?id=${worker.id}`)} />,
        }}
      />
      <Screen>
        <Card tone={tone}>
          <Txt eyebrow style={{ color: c[toneText] }}>
            {t('balanceAllProjects')}
          </Txt>
          <Txt variant="amount" weight="bold" numeric color={toneText} adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1}>
            {formatLKR(Math.abs(b))}
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
            <BalanceBadge balance={b} />
            {!worker.active ? <Badge label={t('inactive')} /> : null}
          </View>
          {worker.trade || worker.daily_rate_cents ? (
            <Txt variant="caption" color="textMuted">
              {[worker.trade, worker.daily_rate_cents ? `${t('dailyRate')} ${formatLKR(worker.daily_rate_cents)}` : null].filter(Boolean).join(' · ')}
            </Txt>
          ) : null}
          {worker.phone ? <Button kind="ghost" compact icon={Phone} label={worker.phone} onPress={() => Linking.openURL(`tel:${worker.phone}`).catch((e) => showError(e, 'worker.call', t))} style={{ alignSelf: 'flex-start' }} /> : null}
        </Card>

        <Tiles>
          <Stat label={t('earned')} value={formatLKR(bal.earned_cents)} />
          <Stat label={t('advances')} value={formatLKR(bal.advance_cents)} />
          <Stat label={t('paid')} value={formatLKR(bal.paid_cents)} />
        </Tiles>

        <View style={{ gap: space.sm }}>
          <Button icon={CalendarCheck} label={t('recordWork')} onPress={() => act('work')} full />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button kind="secondary" icon={HandCoins} label={t('giveAdvance')} onPress={() => act('advance')} style={{ flex: 1 }} />
            <Button kind="secondary" icon={Banknote} label={t('payWages')} onPress={() => act('payment')} style={{ flex: 1 }} />
          </View>
        </View>

        {wp.length ? (
          <>
            <SectionTitle title={t('perProject')} count={wp.length} />
            <ListCard inset>
              {wp.map((p) => (
                <ListRow
                  key={p.project_id}
                  icon={Building2}
                  title={p.project_name}
                  subtitle={`${formatLKR(p.rate_cents)} / ${t('day')} · ${t('daysCount', { n: p.days_total })}`}
                  value={p.balance_cents ? formatLKR(Math.abs(p.balance_cents)) : undefined}
                  badge={<BalanceBadge balance={p.balance_cents} />}
                  onPress={() => router.push(`/worker/assign?projectId=${p.project_id}&workerId=${worker.id}`)}
                />
              ))}
            </ListCard>
          </>
        ) : null}

        <SectionTitle title={t('history')} count={entries.length || undefined} />
        {showChips ? (
          <Chips
            value={activeFilter}
            onChange={setFilter}
            options={[{ value: ALL, label: t('all') }, ...historyProjects.map((p) => ({ value: p.id, label: p.name }))]}
          />
        ) : null}
        {shown.length ? (
          <ListCard inset>
            {shown.map((e) => (
              <ListRow
                key={e.id}
                icon={ICON[e.kind]}
                title={`${t(`wage_${e.kind}`)}${e.kind === 'work' && e.days ? ` · ${t('daysCount', { n: e.days })}` : ''}`}
                subtitle={[formatDay(e.day), activeFilter === ALL ? e.project_name : null, e.note].filter(Boolean).join(' · ')}
                value={`${e.kind === 'work' ? '+' : '−'}${formatLKR(e.amount_cents)}`}
                valueTone={e.kind === 'work' ? 'text' : 'textMuted'}
                onPress={() => onEntry(e)}
              />
            ))}
          </ListCard>
        ) : (
          <Txt variant="caption" color="textMuted">
            {`${t('recordWork')} · ${t('giveAdvance')} · ${t('payWages')}`}
          </Txt>
        )}

        <View style={{ gap: space.sm, marginTop: space.md }}>
          <Button kind="ghost" icon={UserX} label={worker.active ? t('markInactive') : t('markActive')} onPress={toggleActive} full />
          {onCurrent ? <Button kind="danger" icon={Trash2} label={t('removeFromProject')} onPress={removeFromCurrent} full /> : null}
        </View>
      </Screen>

      <PickerSheet
        visible={picking != null}
        title={t('chooseProject')}
        value={null}
        items={pickerItems}
        onClose={() => setPicking(null)}
        onPick={(projectId) => {
          const kind = picking;
          setPicking(null);
          if (kind && projectId) go(kind, projectId);
        }}
      />
    </>
  );
}
