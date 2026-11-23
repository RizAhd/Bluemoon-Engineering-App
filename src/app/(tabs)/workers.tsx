import { router } from 'expo-router';
import { Banknote, Building2, Check, ChevronRight, ClipboardCheck, HardHat, Plus, Search, Settings, Share2, UserPlus, Users } from 'lucide-react-native';
import { memo, useState } from 'react';
import { View } from 'react-native';

import { Hero, HeroAction, HeroAmount, HeroButtons, HeroChip, HeroChips } from '@/components/Hero';
import { ListControls, oneOf, useListPrefs } from '@/components/ListControls';
import { useShareSheet } from '@/components/ShareSheet';
import { Stat, Tiles } from '@/components/Stats';
import { Button } from '@/components/ui/Button';
import { CardList } from '@/components/ui/CardList';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Chips, PickerSheet } from '@/components/ui/form';
import { Initials } from '@/components/ui/kit';
import { Card, ListRow, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useSetting } from '@/db';
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
import { usePdfShare } from '@/hooks/pdfShare';
import { useSearchBox } from '@/hooks/search';
import { useToday } from '@/hooks/today';
import { useT, type TKey } from '@/i18n';
import { formatLKR } from '@/lib/money';
import { exportWorkersListPdf } from '@/lib/reports/export';
import { unpaidForDay } from '@/lib/wages';
import { radius, space, useColors } from '@/theme';

/** What the Workers tab remembers (settings `list_workers_<field>`), the same with a project or "All projects". */
const DEFAULTS = { balance: 'all', status: 'all', sort: 'name' };

const BALANCE_LABEL: Record<Exclude<BalanceFilter, 'all'>, TKey> = { pay: 'weOwe', advance: 'workerOwes', settled: 'settled' };
const STATUS_LABEL: Record<Exclude<WorkerStatusFilter, 'all'>, TKey> = { active: 'workerActive', left: 'workerLeft' };

/** The worker's balance on the right of the row: the amount in its colour with the words under it, never colour alone. */
function BalanceTrailing({ balance, showSettled }: { balance: number; showSettled: boolean }) {
  const t = useT();
  const c = useColors();
  const tone = balance > 0 ? 'danger' : balance < 0 ? 'warning' : 'success';
  const words = balance > 0 ? t('weOwe') : balance < 0 ? t('workerOwes') : t('settled');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 0, maxWidth: '50%' }}>
      {balance || showSettled ? (
        <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
          {balance ? (
            <Txt variant="bodyLg" weight="bold" numeric color={tone} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {formatLKR(Math.abs(balance))}
            </Txt>
          ) : null}
          <Txt variant="caption" weight="semibold" color={tone} numberOfLines={1}>
            {words}
          </Txt>
        </View>
      ) : null}
      <ChevronRight size={18} color={c.textMuted} strokeWidth={2} />
    </View>
  );
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
      badge={!r.active ? <Badge label={t('inactive')} /> : undefined}
      // "Settled" only says something once there was work to settle.
      trailing={<BalanceTrailing balance={r.balance} showSettled={!!r.active && r.days > 0} />}
      onPress={() => router.push(`/worker/${r.id}`)}
    />
  );
});

/** How many faces the work & pay card shows before "+n". */
const FACES = 5;

/**
 * Entry card to "Today's work & pay" (Blueprint: it sits half over the blue hero): title, one-line status, "Open",
 * and the roster's faces with a tick on everyone who worked today. Without a roster it is a plain row.
 */
function WorkPayCard({ subtitle, onPress, people }: { subtitle: string; onPress: () => void; people: { id: string; name: string; worked: boolean }[] }) {
  const t = useT();
  const c = useColors();
  const shown = people.slice(0, FACES);
  const more = people.length - shown.length;
  return (
    <Card onPress={onPress} accessibilityLabel={`${t('todaysWork')}. ${subtitle}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        {people.length ? null : (
          <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <ClipboardCheck size={22} color={c.primary} strokeWidth={1.9} />
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bodyLg" weight="bold" numberOfLines={2}>
            {t('todaysWork')}
          </Txt>
          <Txt variant="caption" color="textMuted" numberOfLines={2}>
            {subtitle}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Txt weight="bold" color="primary">
            {t('open')}
          </Txt>
          <ChevronRight size={18} color={c.primary} strokeWidth={2.2} />
        </View>
      </View>
      {shown.length ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {shown.map((p) => (
            <View key={p.id} style={{ flex: 1, maxWidth: 64, alignItems: 'center', gap: space.xs }}>
              <View>
                <Initials name={p.name} size={52} />
                <View
                  style={{
                    position: 'absolute',
                    right: -2,
                    bottom: -2,
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: c.card,
                    backgroundColor: p.worked ? c.success : c.surface2,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  {p.worked ? <Check size={11} color={c.card} strokeWidth={3.5} /> : null}
                </View>
              </View>
              <Txt variant="caption" weight="semibold" numberOfLines={1}>
                {p.name.split(' ')[0]}
              </Txt>
            </View>
          ))}
          {more > 0 ? (
            <View style={{ flex: 1, maxWidth: 64, alignItems: 'center', gap: space.xs }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Txt weight="bold" color="textMuted" numeric>{`+${more}`}</Txt>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
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
  const td = useToday();
  const projects = useProjects();
  const roster = useProjectWorkers(pid);
  const dayRows = useWageDay(pid, td);
  const [picking, setPicking] = useState(false);

  const { prefs, set, reset } = useListPrefs('workers', DEFAULTS);
  const balance = oneOf<BalanceFilter>(prefs.balance, BALANCE_FILTERS, 'all');
  const status = oneOf<WorkerStatusFilter>(prefs.status, WORKER_STATUS_FILTERS, 'all');
  const sort = oneOf<WorkerSort>(prefs.sort, WORKER_SORTS, 'name');
  // The database searches name, trade and phone; the box is drawn with the list only (an empty roster has no rows to hide).
  const search = useSearchBox();
  const list = useWorkerList(pid, { sort, balance, status, q: search.query });
  const rows = list.rows;

  // The whole roster (or every worker) with the balances, as a message or as a PDF with every figure.
  const projectName = projects.find((p) => p.id === pid)?.name ?? null;
  const letterhead = useSetting('export_letterhead') === '1';
  const pdf = usePdfShare({
    tag: 'workers.pdf',
    title: t('workers'),
    make: (notice) => exportWorkersListPdf(pid, { letterhead, onNotice: notice }),
    details: { projectId: pid, letterhead },
  });
  const share = useShareSheet({
    kind: 'workersList',
    id: pid,
    pdf: { hint: `${t('pdfWorkersList')} · ${projectName ?? t('allProjects')} · ${t(letterhead ? 'letterheadOption' : 'pdfPlainPaper')}`, run: pdf.run },
  });

  const active = rows.filter((r) => !!r.active);
  const inactive = rows.filter((r) => !r.active);
  // The two tiles total the whole roster, whatever the chips below are filtered to (and so match Today's "Wages to pay").
  const everyone = useWorkerList(pid, { sort: 'name', balance: 'all', status: 'all' });
  const weOwe = everyone.rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
  const workerOwes = everyone.rows.reduce((s, r) => s + Math.max(0, -r.balance), 0);
  // the project's labour so far: what the roster earned and what has been handed over (pay and advances)
  const earned = roster.reduce((s, r) => s + r.earned_cents, 0);
  const handed = roster.reduce((s, r) => s + r.paid_cents + r.advance_cents, 0);

  // Same population as the wage sheet: only workers on the roster (a removed worker's day rows stay in v_wage_day).
  const onRoster = new Set(roster.map((r) => r.worker_id));
  const dayOnRoster = dayRows.filter((r) => onRoster.has(r.worker_id));
  const worked = dayOnRoster.filter((r) => r.days != null).length;
  const workedIds = new Set(dayOnRoster.filter((r) => r.days != null).map((r) => r.worker_id));
  const faces = roster.filter((r) => !!r.active).map((r) => ({ id: r.worker_id, name: r.name, worked: workedIds.has(r.worker_id) }));
  const toPayToday = unpaidForDay(dayOnRoster, roster);
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
  const recordWork = () => router.push(pid ? `/wage/form?kind=work&projectId=${pid}` : '/wage/form?kind=work');

  const noProjects = projects.length === 0;
  const empty = list.total === 0;
  const applied = [
    search.query ? t('nOfM', { n: rows.length, m: list.unsearched }) : null,
    balance !== 'all' ? t(BALANCE_LABEL[balance]) : null,
    status !== 'all' ? t(STATUS_LABEL[status]) : null,
    sort !== 'name' ? t(`sort_${sort}`) : null,
  ].filter((s): s is string => !!s);
  const sheetCount = [status !== 'all', sort !== 'name'].filter(Boolean).length;
  const clear = () => {
    reset();
    search.setQuery('');
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Screen hairlineTop={false} scroll={false} skeleton="hero">
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
            <View style={{ gap: space.md }}>
              <Hero
                title={t('workers')}
                project={noProjects ? false : { allowAll: true }}
                actions={
                  <>
                    {/* With no worker anywhere there is nothing to share yet. */}
                    {list.total ? <HeroAction icon={Share2} label={t('share')} onPress={share.open} /> : null}
                    {pid ? (
                      <HeroAction icon={UserPlus} label={t('addWorkerToProject')} onPress={addToProject} />
                    ) : (
                      <HeroAction icon={UserPlus} label={t('newWorker')} onPress={newWorker} />
                    )}
                    <HeroAction icon={Settings} label={t('settingsAndMore')} onPress={() => router.push('/more')} />
                  </>
                }
                card={!noProjects && (!pid || !empty) ? <WorkPayCard subtitle={workPaySubtitle} onPress={openWorkPay} people={faces} /> : undefined}>
                {empty ? null : (
                  <>
                    {/* The amount totals the whole roster, whatever the list below is filtered to (and so matches Today's "Wages to pay"). */}
                    <View accessible accessibilityLabel={`${t('weOwe')} ${formatLKR(weOwe)}`}>
                      <HeroAmount label={t('wagesToPay')} value={formatLKR(weOwe)} />
                    </View>
                    <HeroChips>
                      <HeroChip icon={Users} label={t('workersCount', { n: everyone.rows.length })} />
                      <HeroChip label={`${t('workerOwes')} ${formatLKR(workerOwes)}`} />
                    </HeroChips>
                    {pid && roster.length ? (
                      <HeroButtons>
                        <Button kind="hero" icon={Banknote} label={t('payWages')} onPress={openWorkPay} full />
                        <Button kind="heroSoft" icon={ClipboardCheck} label={t('recordWork')} onPress={recordWork} full />
                      </HeroButtons>
                    ) : null}
                  </>
                )}
              </Hero>
            {noProjects && empty ? (
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

                {pid && !empty ? (
                  <Tiles>
                    <Stat label={t('labour')} value={formatLKR(earned)} />
                    <Stat label={t('labourPaid')} value={formatLKR(handed)} caption={earned > 0 ? `${Math.min(100, Math.floor((handed * 100) / earned))}% · ${t('earned')}` : undefined} />
                  </Tiles>
                ) : null}

                {/* with nobody on the roster there is nothing to search */}
                {empty ? null : search.node}

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
                      onClear={clear}>
                      <Chips<WorkerStatusFilter>
                        label={t('status')}
                        value={status}
                        onChange={(v) => set('status', v)}
                        options={WORKER_STATUS_FILTERS.map((s) => ({ value: s, label: s === 'all' ? t('all') : t(STATUS_LABEL[s]) }))}
                      />
                    </ListControls>

                    {!pid ? (
                      <Txt variant="caption" color="textMuted">
                        {t('balanceAllProjects')}
                      </Txt>
                    ) : null}

                    {rows.length === 0
                      ? (search.noResults ?? <EmptyState icon={Search} title={t('noMatches')} hint={t('noMatchesHint')} action={<Button kind="secondary" compact label={t('clearFilters')} onPress={reset} />} compact />)
                      : null}
                  </>
                )}
              </View>
            )}
            </View>
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
      {share.sheet}
    </View>
  );
}
