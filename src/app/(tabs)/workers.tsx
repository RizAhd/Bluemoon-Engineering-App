import { router } from 'expo-router';
import { Building2, ChevronRight, ClipboardCheck, HardHat, Plus, Search, UserPlus } from 'lucide-react-native';
import { memo, useState } from 'react';
import { View } from 'react-native';

import { ListControls, oneOf, useListPrefs } from '@/components/ListControls';
import { HeaderAction, TabHeader } from '@/components/ProjectSwitcher';
import { Stat, Tiles } from '@/components/Stats';
import { Button } from '@/components/ui/Button';
import { CardList } from '@/components/ui/CardList';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Chips, PickerSheet } from '@/components/ui/form';
import { Card, ListRow, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import {
  BALANCE_FILTERS,
  setCurrentProject,
  useCurrentProjectId,
  useProjects,
  useProjectWorkers,
  useWageDay,
  useWorkerList,
  WORKER_SORTS,
  WORKER_STATUS_FILTERS,
  type BalanceFilter,
  type WorkerListRow,
  type WorkerSort,
  type WorkerStatusFilter,
} from '@/hooks/data';
import { useT, type TKey } from '@/i18n';
import { today } from '@/lib/dates';
import { formatLKR } from '@/lib/money';
import { space, useColors } from '@/theme';

/** What the Workers tab remembers (settings `list_workers_<field>`), the same with a project or "All projects". */
const DEFAULTS = { balance: 'all', status: 'all', sort: 'name' };

const BALANCE_LABEL: Record<Exclude<BalanceFilter, 'all'>, TKey> = { pay: 'weOwe', advance: 'workerOwes', settled: 'settled' };
const STATUS_LABEL: Record<Exclude<WorkerStatusFilter, 'all'>, TKey> = { active: 'workerActive', left: 'workerLeft' };

function BalanceBadge({ balance }: { balance: number }) {
  const t = useT();
  if (balance > 0) return <Badge tone="danger" label={t('weOwe')} />;
  if (balance < 0) return <Badge tone="warning" label={t('workerOwes')} />;
  return <Badge tone="success" label={t('settled')} />;
}

const workerKey = (r: WorkerListRow) => r.id;

/** One worker: initials, trade and rate (and days when sorted by days), balance with its badge. */
const WorkerRow = memo(function WorkerRow({ r, showDays }: { r: WorkerListRow; showDays: boolean }) {
  const t = useT();
  return (
    <ListRow
      avatar={r.name}
      muted={!r.active}
      title={r.name}
      subtitle={[r.trade, r.rate ? `${formatLKR(r.rate)} / ${t('day')}` : null, showDays ? t('daysCount', { n: r.days }) : null].filter(Boolean).join(' · ')}
      value={r.balance ? formatLKR(Math.abs(r.balance)) : undefined}
      badge={
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs }}>
          {!r.active ? <Badge label={t('inactive')} /> : null}
          {r.active || r.balance ? <BalanceBadge balance={r.balance} /> : null}
        </View>
      }
      onPress={() => router.push(`/worker/${r.id}`)}
    />
  );
});

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
 * With "All projects": every worker with their overall balance. Both can be narrowed to "to pay", "advance over"
 * or "settled" and to working / left, and sorted by name, most to pay, most days worked or highest rate.
 * With no project at all there is only one thing to do first, so the screen says just that.
 */
export default function WorkersScreen() {
  const t = useT();
  const c = useColors();
  const pid = useCurrentProjectId();
  const td = today();
  const projects = useProjects();
  const roster = useProjectWorkers(pid);
  const dayRows = useWageDay(pid, td);
  const [picking, setPicking] = useState(false);

  const { prefs, set, reset } = useListPrefs('workers', DEFAULTS);
  const balance = oneOf<BalanceFilter>(prefs.balance, BALANCE_FILTERS, 'all');
  const status = oneOf<WorkerStatusFilter>(prefs.status, WORKER_STATUS_FILTERS, 'all');
  const sort = oneOf<WorkerSort>(prefs.sort, WORKER_SORTS, 'name');
  const list = useWorkerList(pid, { sort, balance, status });
  const rows = list.rows;

  const active = rows.filter((r) => !!r.active);
  const inactive = rows.filter((r) => !r.active);
  const weOwe = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
  const workerOwes = rows.reduce((s, r) => s + Math.max(0, -r.balance), 0);

  // Same population as the wage sheet: only workers on the roster (a removed worker's day rows stay in v_wage_day).
  const onRoster = new Set(roster.map((r) => r.worker_id));
  const dayOnRoster = dayRows.filter((r) => onRoster.has(r.worker_id));
  const worked = dayOnRoster.filter((r) => r.days != null).length;
  const toPayToday = dayOnRoster.reduce((s, r) => s + Math.max(0, (r.work_cents ?? 0) - (r.paid_cents ?? 0)), 0);
  const workPaySubtitle = pid
    ? roster.length === 0
      ? t('noWorkersOnProject')
      : `${worked} ${t('worked')} · ${t('toPayToday')} ${formatLKR(toPayToday)}`
    : t('noProjectSelected');

  const addToProject = () => router.push(`/worker/assign?projectId=${pid}`);
  const newWorker = () => router.push('/worker/form');
  const newProject = () => router.push('/project/form');
  const openWorkPay = () => {
    if (!pid) setPicking(true);
    else if (roster.length === 0) addToProject();
    else router.push('/wage/today');
  };

  const renderRow = (r: WorkerListRow) => <WorkerRow r={r} showDays={sort === 'days'} />;

  const noProjects = projects.length === 0;
  const empty = list.total === 0;
  const applied = [
    balance !== 'all' ? t(BALANCE_LABEL[balance]) : null,
    status !== 'all' ? t(STATUS_LABEL[status]) : null,
    sort !== 'name' ? t(`sort_${sort}`) : null,
  ].filter((s): s is string => !!s);
  const sheetCount = [status !== 'all', sort !== 'name'].filter(Boolean).length;

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
      <Screen hairlineTop={false} scroll={false}>
        <CardList
          keyOf={workerKey}
          renderRow={renderRow}
          inset
          sections={
            noProjects && empty
              ? []
              : [
                  { key: 'active', label: `${pid ? t('projectWorkers') : t('allWorkers')} (${active.length})`, rows: active },
                  { key: 'inactive', label: `${t('inactive')} (${inactive.length})`, rows: inactive },
                ]
          }
          header={
            noProjects && empty ? (
              // Nothing can be recorded for a worker before there is a project: one empty state, one action.
              <EmptyState icon={Building2} title={t('addProjectFirst')} hint={t('addProjectFirstHint')} action={<Button icon={Plus} label={t('newProject')} onPress={newProject} full />} />
            ) : (
              <View style={{ gap: space.md }}>
                {!pid && !noProjects ? (
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
                    <Button kind="secondary" compact icon={Building2} label={t('chooseProject')} onPress={() => setPicking(true)} />
                  </Card>
                ) : null}

                {!noProjects && (!pid || !empty) ? <WorkPayCard subtitle={workPaySubtitle} onPress={openWorkPay} /> : null}

                {empty ? (
                  pid ? (
                    <EmptyState
                      icon={HardHat}
                      title={t('noWorkersOnProject')}
                      hint={t('noWorkersOnProjectHint')}
                      action={<Button icon={UserPlus} label={t('addWorkerToProject')} onPress={addToProject} full />}
                    />
                  ) : (
                    <EmptyState icon={HardHat} title={t('noWorkers')} hint={t('noWorkersHint')} action={<Button icon={UserPlus} label={t('newWorker')} onPress={newWorker} full />} />
                  )
                ) : (
                  <>
                    <ListControls
                      quick={{
                        value: balance,
                        onChange: (v) => set('balance', v),
                        options: [
                          { value: 'all', label: t('all') },
                          { value: 'pay', label: t('weOwe'), count: list.counts.pay, disabled: !list.counts.pay && balance !== 'pay' },
                          { value: 'advance', label: t('workerOwes'), count: list.counts.advance, disabled: !list.counts.advance && balance !== 'advance' },
                          { value: 'settled', label: t('settled'), count: list.counts.settled, disabled: !list.counts.settled && balance !== 'settled' },
                        ],
                      }}
                      sort={{ value: sort, onChange: (v) => set('sort', v), options: WORKER_SORTS.map((s) => ({ value: s, label: t(`sort_${s}`) })) }}
                      sheetCount={sheetCount}
                      applied={applied}
                      onClear={reset}>
                      <Chips<WorkerStatusFilter>
                        label={t('status')}
                        value={status}
                        onChange={(v) => set('status', v)}
                        options={WORKER_STATUS_FILTERS.map((s) => ({ value: s, label: s === 'all' ? t('all') : t(STATUS_LABEL[s]) }))}
                      />
                    </ListControls>

                    <Tiles>
                      <Stat label={t('weOwe')} value={formatLKR(weOwe)} tone={weOwe > 0 ? 'danger' : 'text'} />
                      <Stat label={t('workerOwes')} value={formatLKR(workerOwes)} caption={`${active.length} ${t('workers')}`} />
                    </Tiles>

                    {!pid ? (
                      <Txt variant="caption" color="textMuted">
                        {t('balanceAllProjects')}
                      </Txt>
                    ) : null}

                    {rows.length === 0 ? (
                      <EmptyState icon={Search} title={t('noMatches')} hint={t('noMatchesHint')} action={<Button kind="secondary" compact label={t('clearFilters')} onPress={reset} />} compact />
                    ) : null}
                  </>
                )}
              </View>
            )
          }
        />
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
        footer={
          <Button
            kind="secondary"
            icon={Plus}
            label={t('newProject')}
            onPress={() => {
              setPicking(false);
              newProject();
            }}
          />
        }
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
