import { router } from 'expo-router';
import { Building2, ChevronRight, ClipboardCheck, HardHat, UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { HeaderAction, TabHeader } from '@/components/ProjectSwitcher';
import { Stat, Tiles } from '@/components/Stats';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { PickerSheet } from '@/components/ui/form';
import { Card, GroupLabel, ListCard, ListRow, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useQuery } from '@/db';
import type { ProjectWorkerBalance, WorkerBalance } from '@/db/types';
import { setCurrentProject, useCurrentProjectId, useProjects, useProjectWorkers, useWageDay } from '@/hooks/data';
import { useT } from '@/i18n';
import { today } from '@/lib/dates';
import { formatLKR } from '@/lib/money';
import { space, useColors } from '@/theme';

function BalanceBadge({ balance }: { balance: number }) {
  const t = useT();
  if (balance > 0) return <Badge tone="danger" label={t('weOwe')} />;
  if (balance < 0) return <Badge tone="warning" label={t('workerOwes')} />;
  return <Badge tone="success" label={t('settled')} />;
}

/** Entry card to "Today's work & pay": icon slot, title, one-line status, chevron. */
function WorkPayCard({ subtitle, onPress }: { subtitle: string; onPress: () => void }) {
  const t = useT();
  const c = useColors();
  return (
    <Card onPress={onPress} accessibilityLabel={`${t('todaysWork')}. ${subtitle}`} padding={space.md}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <ClipboardCheck size={22} color={c.primary} strokeWidth={2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt weight="semibold" numberOfLines={2}>
            {t('todaysWork')}
          </Txt>
          <Txt variant="caption" color="textMuted" numberOfLines={2}>
            {subtitle}
          </Txt>
        </View>
        <ChevronRight size={20} color={c.textMuted} strokeWidth={2} />
      </View>
    </Card>
  );
}

/**
 * Workers tab. With a current project: that project's roster with per-project balances.
 * With "All projects": every worker with their overall balance.
 */
export default function WorkersScreen() {
  const t = useT();
  const c = useColors();
  const pid = useCurrentProjectId();
  const td = today();
  const projects = useProjects();
  const roster = useProjectWorkers(pid);
  const dayRows = useWageDay(pid, td);
  const all = useQuery<WorkerBalance>('SELECT * FROM v_worker_balance ORDER BY active DESC, name COLLATE NOCASE');
  const [picking, setPicking] = useState(false);

  const rows: { id: string; name: string; trade: string | null; rate: number; balance: number; active: boolean }[] = pid
    ? roster.map((r: ProjectWorkerBalance) => ({ id: r.worker_id, name: r.name, trade: r.trade, rate: r.rate_cents, balance: r.balance_cents, active: !!r.active }))
    : all.map((r) => ({ id: r.worker_id, name: r.name, trade: r.trade, rate: r.daily_rate_cents, balance: r.balance_cents, active: !!r.active }));
  const active = rows.filter((r) => r.active);
  const inactive = rows.filter((r) => !r.active);
  const weOwe = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
  const workerOwes = rows.reduce((s, r) => s + Math.max(0, -r.balance), 0);

  const worked = dayRows.filter((r) => r.days != null).length;
  const toPayToday = dayRows.reduce((s, r) => s + Math.max(0, (r.work_cents ?? 0) - (r.paid_cents ?? 0)), 0);
  const workPaySubtitle = pid
    ? roster.length === 0
      ? t('noWorkersOnProject')
      : `${worked} ${t('worked')} · ${t('toPayToday')} ${formatLKR(toPayToday)}`
    : t('noProjectSelected');

  const addToProject = () => router.push(`/worker/assign?projectId=${pid}`);
  const newWorker = () => router.push('/worker/form');
  const openWorkPay = () => {
    if (!pid) setPicking(true);
    else if (roster.length === 0) addToProject();
    else router.push('/wage/today');
  };

  const renderRow = (r: (typeof rows)[number]) => (
    <ListRow
      key={r.id}
      avatar={r.name}
      muted={!r.active}
      title={r.name}
      subtitle={[r.trade, r.rate ? `${formatLKR(r.rate)} / ${t('day')}` : null].filter(Boolean).join(' · ')}
      value={r.balance ? formatLKR(Math.abs(r.balance)) : undefined}
      badge={r.active ? <BalanceBadge balance={r.balance} /> : <Badge label={t('inactive')} />}
      onPress={() => router.push(`/worker/${r.id}`)}
    />
  );

  const empty = rows.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TabHeader
        title={t('workers')}
        right={
          pid ? (
            <HeaderAction icon={UserPlus} label={t('addWorkerToProject')} onPress={addToProject} />
          ) : (
            <HeaderAction icon={UserPlus} label={t('newWorker')} onPress={newWorker} />
          )
        }
      />
      <Screen hairlineTop={false} gap={space.md}>
        {!pid ? (
          <Card tone="warningSoft">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Building2 size={24} color={c.warning} strokeWidth={2} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt weight="semibold" color="warning">
                  {t('noProjectSelected')}
                </Txt>
                <Txt variant="caption" color="textMuted">
                  {t('chooseProjectFirstHint')}
                </Txt>
              </View>
            </View>
            {projects.length ? <Button kind="secondary" compact icon={Building2} label={t('chooseProject')} onPress={() => setPicking(true)} /> : null}
          </Card>
        ) : null}

        {!pid || !empty ? <WorkPayCard subtitle={workPaySubtitle} onPress={openWorkPay} /> : null}

        {empty ? (
          pid ? (
            <EmptyState
              icon={HardHat}
              title={t('noWorkersOnProject')}
              hint={t('noWorkersOnProjectHint')}
              action={<Button icon={UserPlus} label={t('addWorkerToProject')} onPress={addToProject} full />}
            />
          ) : (
            <EmptyState
              icon={HardHat}
              title={t('noWorkers')}
              hint={t('noWorkersHint')}
              action={<Button icon={UserPlus} label={t('newWorker')} onPress={newWorker} full />}
            />
          )
        ) : (
          <>
            <Tiles>
              <Stat label={t('weOwe')} value={formatLKR(weOwe)} tone={weOwe > 0 ? 'danger' : 'text'} />
              <Stat label={t('workerOwes')} value={formatLKR(workerOwes)} caption={`${active.length} ${t('workers')}`} />
            </Tiles>

            {!pid ? (
              <Txt variant="caption" color="textMuted">
                {t('balanceAllProjects')}
              </Txt>
            ) : null}

            {active.length ? (
              <View style={{ gap: space.sm }}>
                <GroupLabel label={`${pid ? t('projectWorkers') : t('allWorkers')} (${active.length})`} />
                <ListCard inset>{active.map(renderRow)}</ListCard>
              </View>
            ) : null}

            {inactive.length ? (
              <View style={{ gap: space.sm }}>
                <GroupLabel label={`${t('inactive')} (${inactive.length})`} />
                <ListCard inset>{inactive.map(renderRow)}</ListCard>
              </View>
            ) : null}
          </>
        )}
      </Screen>

      <PickerSheet
        visible={picking}
        title={t('chooseProject')}
        value={null}
        items={projects.map((p) => ({
          id: p.id,
          title: p.name,
          icon: Building2,
          subtitle: [p.location, t(`status_${p.status}`)].filter(Boolean).join(' · '),
        }))}
        onClose={() => setPicking(false)}
        onPick={(id) => {
          setPicking(false);
          if (!id) return;
          setCurrentProject(id);
          router.push('/wage/today');
        }}
      />
    </View>
  );
}
