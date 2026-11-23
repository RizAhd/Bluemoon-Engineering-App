import { router } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import {
  AlertTriangle,
  ArrowUpFromLine,
  Banknote,
  Building2,
  ClipboardCheck,
  CloudOff,
  Hammer,
  HandCoins,
  HardHat,
  NotebookPen,
  Plus,
  Receipt,
  Settings,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { BrandLogo } from '@/components/Brand';
import { Hero, HeroAction, HeroAmount, HeroButtons, HeroChip, HeroChips } from '@/components/Hero';
import { PeriodSummary } from '@/components/PeriodSummary';
import { ContractBar } from '@/components/Stats';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/feedback';
import { PickerSheet } from '@/components/ui/form';
import { Card, Divider, InfoLine, ListCard, ListRow, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst, useQuery, useSetting } from '@/db';
import type { ProjectCost } from '@/db/types';
import { setCurrentProject, useCurrentProjectId, useProjects, useProjectWorkers, useWageDay } from '@/hooks/data';
import { useToday } from '@/hooks/today';
import { useT, type TKey } from '@/i18n';
import { daysSince, formatDay, toDay } from '@/lib/dates';
import { formatLKR } from '@/lib/money';
import { qtyText } from '@/lib/toolStock';
import { unpaidForDay } from '@/lib/wages';
import { radius, space, useColors, useElevation } from '@/theme';

function greetingKey(): TKey {
  const h = new Date().getHours();
  return h < 12 ? 'goodMorning' : h < 17 ? 'goodAfternoon' : 'goodEvening';
}

interface Activity {
  kind: 'expense' | 'wage' | 'tool' | 'note' | 'receipt';
  id: string;
  title: string;
  sub: string | null;
  amount_cents: number | null;
  day: string;
  created_at: string;
  ref: string;
  project_name: string | null;
  /** Tool movements: how many went out or came back (thousandths) and the tool's unit. */
  qty_milli: number | null;
  unit: string | null;
}

/**
 * Today dashboard (Blueprint): a blue hero with the total cost and the two daily actions, the contract card over
 * its edge, round quick actions, wages to pay, the day / week / month summary and recent activity.
 */
export default function TodayScreen() {
  const t = useT();
  const projects = useProjects();
  const pid = useCurrentProjectId();
  // moves on at midnight by itself, so the screen never shows yesterday as "today"
  const td = useToday();
  const args = pid ? [pid] : [];
  const [choosing, setChoosing] = useState(false);

  const roster = useProjectWorkers(pid);
  const allOwed =
    useFirst<{ s: number }>('SELECT COALESCE(SUM(CASE WHEN balance_cents > 0 THEN balance_cents END),0) AS s FROM v_worker_balance')?.s ?? 0;
  const wagesToPay = useMemo(
    () => (pid ? roster.reduce((a, w) => a + Math.max(0, w.balance_cents), 0) : allOwed),
    [pid, roster, allOwed],
  );
  // Pieces of tools that are out (3 of one ladder count 3); materials are used up, not lent, so they are not "out".
  const toolsOutMilli =
    useFirst<{ n: number }>(
      `SELECT COALESCE(SUM(h.qty_milli), 0) AS n FROM v_tool_holders h JOIN tools t ON t.id = h.tool_id
       WHERE t.is_material = 0 ${pid ? 'AND h.project_id = ?' : ''}`,
      args,
    )?.n ?? 0;
  const cost = useQuery<ProjectCost>(`SELECT * FROM v_project_cost ${pid ? 'WHERE project_id = ?' : "WHERE status != 'completed'"}`, args);
  const received = useFirst<{ r: number }>('SELECT received_cents AS r FROM v_project_received WHERE project_id = ?', [pid ?? ''])?.r ?? 0;
  const dayRows = useWageDay(pid, td);

  const recent = useQuery<Activity>(
    `SELECT * FROM (
       SELECT 'expense' AS kind, e.id, e.category AS title, e.paid_to AS sub, e.amount_cents, e.day, e.created_at, e.id AS ref, p.name AS project_name,
              NULL AS qty_milli, NULL AS unit
         FROM expenses e LEFT JOIN projects p ON p.id = e.project_id
         WHERE e.deleted_at IS NULL AND p.deleted_at IS NULL ${pid ? 'AND e.project_id = ?' : ''}
       UNION ALL
       SELECT 'wage', w.id, w.kind, wk.name, w.amount_cents, w.day, w.created_at, w.worker_id, p.name, NULL, NULL
         FROM wage_entries w JOIN workers wk ON wk.id = w.worker_id LEFT JOIN projects p ON p.id = w.project_id
         WHERE w.deleted_at IS NULL AND wk.deleted_at IS NULL AND p.deleted_at IS NULL ${pid ? 'AND w.project_id = ?' : ''}
       UNION ALL
       SELECT 'tool', m.id, m.kind, tl.name, NULL, m.day, m.created_at, m.tool_id, p.name, m.qty_milli, tl.unit
         FROM tool_movements m JOIN tools tl ON tl.id = m.tool_id LEFT JOIN projects p ON p.id = m.project_id
         WHERE m.deleted_at IS NULL AND tl.deleted_at IS NULL AND p.deleted_at IS NULL ${pid ? 'AND m.project_id = ?' : ''}
       UNION ALL
       SELECT 'note', n.id, 'note', n.body, NULL, n.day, n.created_at, n.id, p.name, NULL, NULL
         FROM site_notes n LEFT JOIN projects p ON p.id = n.project_id
         WHERE n.deleted_at IS NULL AND p.deleted_at IS NULL ${pid ? 'AND n.project_id = ?' : ''}
       UNION ALL
       SELECT 'receipt', r.id, r.method, r.note, r.amount_cents, r.day, r.created_at, r.id, p.name, NULL, NULL
         FROM project_receipts r JOIN projects p ON p.id = r.project_id
         WHERE r.deleted_at IS NULL AND p.deleted_at IS NULL ${pid ? 'AND r.project_id = ?' : ''}
     ) ORDER BY created_at DESC LIMIT 8`,
    pid ? [pid, pid, pid, pid, pid] : [],
  );

  const lastFull = useSetting('last_backup_at');
  const autoAt = useSetting('auto_backup_at');
  const autoError = useSetting('auto_backup_error');
  const photoCount = useFirst<{ n: number }>('SELECT COUNT(*) AS n FROM attachments WHERE deleted_at IS NULL')?.n ?? 0;
  // auto_backup_at is a UTC timestamp, td a local day: compare local days, or a backup made before 05:30 in Sri Lanka is "yesterday".
  const autoToday = !!autoAt && toDay(new Date(autoAt)) === td;
  const fullDays = daysSince(lastFull);
  const photosStale = photoCount > 0 && (fullDays == null || fullDays >= 7);
  const subtitle = formatDay(td);

  const heroActions = (
    <>
      <HeroAction icon={ShieldCheck} label={t('backup')} onPress={() => router.push('/backup')} />
      <HeroAction icon={Settings} label={t('settingsAndMore')} onPress={() => router.push('/more')} />
    </>
  );

  if (!projects.length) {
    return (
      <Screen hairlineTop={false}>
        <Hero brand title={t(greetingKey())} subtitle={subtitle} actions={heroActions} />
        <View style={{ alignItems: 'center', paddingTop: space.lg }}>
          <BrandLogo width={180} />
        </View>
        <EmptyState
          icon={Building2}
          title={t('noProjects')}
          hint={t('noProjectsHint')}
          action={<Button icon={Plus} label={t('newProject')} onPress={() => router.push('/project/form')} full />}
        />
      </Screen>
    );
  }

  const totals = cost.reduce(
    (a, p) => ({ spent: a.spent + p.expense_cents + p.labour_cents, contract: a.contract + (p.contract_cents ?? 0) }),
    { spent: 0, contract: 0 },
  );
  // Same population as the wage sheet and the Workers tab: only workers on the roster (a removed worker's day rows stay in v_wage_day).
  const onRoster = new Set(roster.map((r) => r.worker_id));
  const dayOnRoster = pid ? dayRows.filter((r) => onRoster.has(r.worker_id)) : dayRows;
  const worked = dayOnRoster.filter((r) => r.days != null).length;
  const toPay = unpaidForDay(dayOnRoster, roster);
  const noRoster = !!pid && roster.length === 0;
  const hasContract = !!pid && totals.contract > 0;
  const usedPct = hasContract ? Math.round((totals.spent / totals.contract) * 100) : 0;

  const workSubtitle = !pid
    ? t('noProjectSelected')
    : noRoster
      ? t('noWorkersOnProject')
      : `${worked} ${t('worked')} · ${t('toPayToday')} ${formatLKR(toPay)}`;
  const openWork = () => {
    if (!pid) setChoosing(true);
    else if (noRoster) router.push(`/worker/assign?projectId=${pid}`);
    else router.push('/wage/today');
  };

  const card = (
    <Card gap={space.md}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
        <Txt variant="bodyLg" weight="bold" style={{ flexShrink: 1 }} numberOfLines={2}>
          {pid ? t('contract') : t('projects')}
        </Txt>
        <Button
          kind="ghost"
          compact
          label={pid ? t('costSummary') : t('projects')}
          onPress={() => router.push(pid ? `/project/${pid}` : '/(tabs)/projects')}
          style={{ marginVertical: -space.sm }}
        />
      </View>
      {hasContract ? (
        <ContractBar spent={totals.spent} contract={totals.contract} />
      ) : (
        <Txt variant="caption" color="textMuted">
          {/* completed projects are not in this total: say so */}
          {pid ? `${t('totalCost')} ${formatLKR(totals.spent)}` : t('runningProjectsCount', { n: cost.length })}
        </Txt>
      )}
      {pid ? (
        <>
          <Divider />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <MiniFigure label={t('receivedSoFar')} value={formatLKR(received)} />
            {hasContract ? <MiniFigure label={t('balanceToContract')} value={formatLKR(Math.max(0, totals.contract - totals.spent))} /> : null}
            {received > 0 ? (
              <MiniFigure label={t('receivedMinusSpent')} value={formatLKR(received - totals.spent)} tone={received - totals.spent < 0 ? 'danger' : 'success'} />
            ) : null}
          </View>
        </>
      ) : null}
    </Card>
  );

  return (
    <View style={{ flex: 1 }}>
      <Screen hairlineTop={false} skeleton="hero">
        <Hero brand title={t(greetingKey())} subtitle={subtitle} actions={heroActions} project card={card}>
          <HeroAmount label={t('totalCost')} value={formatLKR(totals.spent)} />
          <HeroChips>
            {hasContract ? <HeroChip icon={TrendingUp} label={`${totals.spent > 0 && usedPct === 0 ? '<1' : usedPct}%`} /> : null}
            {!pid ? <HeroChip icon={Building2} label={t('runningProjectsCount', { n: cost.length })} /> : null}
          </HeroChips>
          <HeroButtons>
            <Button kind="hero" icon={Plus} label={t('newExpense')} onPress={() => router.push('/expense/form')} />
            <Button kind="heroSoft" icon={ClipboardCheck} label={t('todaysWork')} onPress={openWork} />
          </HeroButtons>
        </Hero>

        {/* Data safety: red if the daily backup failed, amber if photos need a Drive copy, else a quiet green line. */}
        {autoError && !autoToday ? (
          <SafetyCard tone="danger" icon={AlertTriangle} text={t('autoBackupFailed')} action={t('runNow')} />
        ) : photosStale ? (
          <SafetyCard
            tone="warning"
            icon={CloudOff}
            text={fullDays == null ? `${t('fullBackup')}: ${t('never')}` : t('photosOverdue', { days: fullDays })}
            action={t('backupNow')}
          />
        ) : autoToday ? (
          <InfoLine
            icon={ShieldCheck}
            tone="success"
            text={`${t('dataSafe')} · ${new Date(autoAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            onPress={() => router.push('/backup')}
          />
        ) : null}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.xs }}>
          <QuickAction icon={Receipt} label={t('newExpense')} primary onPress={() => router.push('/expense/form')} />
          {pid ? <QuickAction icon={Banknote} label={t('recordPayment')} onPress={() => router.push(`/project/receipt?projectId=${pid}`)} /> : null}
          <QuickAction icon={ArrowUpFromLine} label={t('issueTool')} onPress={() => router.push('/tool/move?kind=issue')} />
          <QuickAction icon={NotebookPen} label={t('newNote')} onPress={() => router.push('/note/form')} />
        </View>

        <WagesStrip amount={wagesToPay} />

        <ListCard inset>
          <ListRow icon={ClipboardCheck} title={t('todaysWork')} subtitle={workSubtitle} onPress={openWork} accessibilityLabel={`${t('todaysWork')}. ${workSubtitle}`} />
          <ListRow
            icon={Hammer}
            iconTone={toolsOutMilli > 0 ? 'warning' : undefined}
            title={t('toolsOut')}
            value={qtyText(toolsOutMilli)}
            valueTone={toolsOutMilli > 0 ? 'warning' : 'text'}
            onPress={() => router.push('/(tabs)/tools')}
          />
        </ListCard>

        <PeriodSummary pid={pid} today={td} />

        <SectionTitle title={t('recent')} />
        {recent.length ? (
          <ListCard inset>
            {recent.map((a) => (
              <ActivityRow key={`${a.kind}-${a.id}`} a={a} showProject={!pid} />
            ))}
          </ListCard>
        ) : (
          <EmptyState compact icon={Receipt} title={t('noExpenses')} hint={t('noExpensesHint')} />
        )}
      </Screen>

      <PickerSheet
        visible={choosing}
        title={t('chooseProject')}
        value={null}
        items={projects.map((p) => ({ id: p.id, title: p.name, icon: Building2, subtitle: t(`status_${p.status}`) }))}
        onClose={() => setChoosing(false)}
        onPick={(id) => {
          if (!id) return;
          setCurrentProject(id);
          setChoosing(false);
          router.push('/wage/today');
        }}
      />
    </View>
  );
}

/** One figure of the contract card: a small label over a bold amount. */
function MiniFigure({ label, value, tone = 'text' }: { label: string; value: string; tone?: 'text' | 'success' | 'danger' }) {
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <Txt variant="caption" weight="semibold" color="textMuted" numberOfLines={2}>
        {label}
      </Txt>
      <Txt weight="bold" numeric color={tone} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {value}
      </Txt>
    </View>
  );
}

/** A round quick action: a 60 dp tile (the first one blue) with its name under it. */
function QuickAction({ icon: Icon, label, onPress, primary }: { icon: LucideIcon; label: string; onPress: () => void; primary?: boolean }) {
  const c = useColors();
  const lift = useElevation('card');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: space.sm }}>
      {({ pressed }) => (
        <>
          <View
            style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: primary ? (pressed ? c.fillPressed : c.fill) : pressed ? c.muted : c.card,
              ...lift,
            }}>
            <Icon size={24} color={primary ? c.onFill : c.primary} strokeWidth={1.9} />
          </View>
          <Txt variant="caption" weight="semibold" center numberOfLines={2}>
            {label}
          </Txt>
        </>
      )}
    </Pressable>
  );
}

/** Wages still owed, with a Pay button that opens the Workers tab. */
function WagesStrip({ amount }: { amount: number }) {
  const c = useColors();
  const t = useT();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: c.primarySoft }}>
      <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
        <HandCoins size={22} color={c.primary} strokeWidth={1.9} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt weight="bold" numberOfLines={2}>
          {t('wagesToPay')}
        </Txt>
        <Txt variant="caption" weight="semibold" numeric color={amount > 0 ? 'danger' : 'textMuted'} numberOfLines={1}>
          {formatLKR(amount)}
        </Txt>
      </View>
      <Button kind="primary" compact label={t('payWages')} onPress={() => router.push('/(tabs)/workers')} />
    </View>
  );
}

function ActivityRow({ a, showProject }: { a: Activity; showProject: boolean }) {
  const t = useT();
  const day = a.day === toDay(new Date()) ? t('today') : formatDay(a.day);
  const withProject = (...parts: (string | null | undefined)[]) =>
    [...parts, showProject ? a.project_name : null, day].filter(Boolean).join(' · ');
  switch (a.kind) {
    case 'expense':
      return (
        <ListRow
          icon={Receipt}
          title={t(`cat_${a.title}` as TKey)}
          subtitle={withProject(a.sub)}
          value={formatLKR(a.amount_cents ?? 0)}
          onPress={() => router.push(`/expense/form?id=${a.ref}`)}
        />
      );
    case 'wage':
      return (
        <ListRow
          icon={HardHat}
          title={a.sub ?? ''}
          subtitle={withProject(t(`wage_${a.title}` as TKey))}
          value={formatLKR(a.amount_cents ?? 0)}
          onPress={() => router.push(`/worker/${a.ref}`)}
        />
      );
    case 'tool':
      return (
        <ListRow
          icon={Hammer}
          iconTone="warning"
          title={a.sub ?? ''}
          // a single piece reads as it always did; several pieces (or a material) say how many: "Issue · 3"
          subtitle={withProject(t(a.title === 'issue' ? 'issue' : 'return'), a.qty_milli != null && a.qty_milli !== 1000 ? qtyText(a.qty_milli, a.unit) : null)}
          onPress={() => router.push(`/tool/${a.ref}`)}
        />
      );
    case 'receipt':
      return (
        <ListRow
          icon={Banknote}
          iconTone="success"
          title={t('moneyFromClient')}
          subtitle={withProject(t(`method_${a.title}` as TKey), a.sub)}
          value={`+${formatLKR(a.amount_cents ?? 0)}`}
          valueTone="success"
          onPress={() => router.push(`/project/receipt?id=${a.ref}`)}
        />
      );
    default:
      return <ListRow icon={NotebookPen} title={a.sub ?? ''} subtitle={withProject()} onPress={() => router.push(`/note/form?id=${a.ref}`)} />;
  }
}

function SafetyCard({ tone, icon: Icon, text, action }: { tone: 'danger' | 'warning'; icon: LucideIcon; text: string; action: string }) {
  const c = useColors();
  return (
    <Card tone={tone === 'danger' ? 'dangerSoft' : 'warningSoft'}>
      <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
        <Icon size={24} color={c[tone]} strokeWidth={2} />
        <Txt weight="semibold" color={tone} style={{ flex: 1 }}>
          {text}
        </Txt>
      </View>
      <Button kind={tone === 'danger' ? 'primary' : 'secondary'} compact icon={ShieldCheck} label={action} onPress={() => router.push('/backup')} />
    </Card>
  );
}
