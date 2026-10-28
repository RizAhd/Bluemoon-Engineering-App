import { router } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import {
  AlertTriangle,
  ArrowUpFromLine,
  Building2,
  ChevronRight,
  ClipboardCheck,
  CloudOff,
  Hammer,
  HardHat,
  NotebookPen,
  Plus,
  Receipt,
  ShieldCheck,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { BrandLogo } from '@/components/Brand';
import { PeriodSummary } from '@/components/PeriodSummary';
import { TabHeader } from '@/components/ProjectSwitcher';
import { ContractBar, Stat, Tiles } from '@/components/Stats';
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
import { hairline, radius, space, useColors } from '@/theme';

function greetingKey(): TKey {
  const h = new Date().getHours();
  return h < 12 ? 'goodMorning' : h < 17 ? 'goodAfternoon' : 'goodEvening';
}

interface Activity {
  kind: 'expense' | 'wage' | 'tool' | 'note';
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

/** Today dashboard: data safety, today's spend, work & pay, cost summary, quick actions, recent activity. */
export default function TodayScreen() {
  const t = useT();
  const c = useColors();
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
     ) ORDER BY created_at DESC LIMIT 8`,
    pid ? [pid, pid, pid, pid] : [],
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

  if (!projects.length) {
    return (
      <View style={{ flex: 1 }}>
        <TabHeader title={t(greetingKey())} subtitle={subtitle} showProject={false} brand />
        <Screen hairlineTop={false} paddingBottom={24}>
          <View style={{ alignItems: 'center', paddingTop: space.xl }}>
            <BrandLogo width={180} />
          </View>
          <EmptyState
            icon={Building2}
            title={t('noProjects')}
            hint={t('noProjectsHint')}
            action={<Button icon={Plus} label={t('newProject')} onPress={() => router.push('/project/form')} full />}
          />
        </Screen>
      </View>
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

  return (
    <View style={{ flex: 1 }}>
      <TabHeader title={t(greetingKey())} subtitle={subtitle} brand />
      <Screen hairlineTop={false}>
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

        <PeriodSummary pid={pid} today={td} />

        <Tiles>
          <Stat
            label={t('wagesToPay')}
            value={formatLKR(wagesToPay)}
            tone={wagesToPay > 0 ? 'danger' : 'text'}
            onPress={() => router.push('/(tabs)/workers')}
          />
          <Stat label={t('toolsOut')} value={qtyText(toolsOutMilli)} tone={toolsOutMilli > 0 ? 'warning' : 'text'} onPress={() => router.push('/(tabs)/tools')} />
        </Tiles>

        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
            <Txt eyebrow style={{ flexShrink: 1 }}>
              {t('totalCost')}
            </Txt>
          </View>
          <Txt variant="amount" weight="bold" numeric adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1}>
            {formatLKR(totals.spent)}
          </Txt>
          {pid ? (
            totals.contract > 0 ? (
              <ContractBar spent={totals.spent} contract={totals.contract} />
            ) : null
          ) : (
            <Txt variant="caption" color="textMuted">
              {/* completed projects are not in this total: say so */}
              {t('runningProjectsCount', { n: cost.length })}
            </Txt>
          )}
          <Divider />
          <View style={{ alignItems: 'flex-start' }}>
            <Button
              kind="ghost"
              compact
              label={pid ? t('costSummary') : t('projects')}
              onPress={() => router.push(pid ? `/project/${pid}` : '/(tabs)/projects')}
              // the 48 dp touch target stays; it just does not add a band of empty card under the link
              style={{ marginTop: -space.xs, marginBottom: -space.md }}
            />
          </View>
        </Card>

        <Card onPress={openWork} accessibilityLabel={`${t('todaysWork')}. ${workSubtitle}`} padding={space.md}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <ClipboardCheck size={22} color={c.primary} strokeWidth={2} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt weight="semibold">{t('todaysWork')}</Txt>
              <Txt variant="caption" color="textMuted" numberOfLines={2}>
                {workSubtitle}
              </Txt>
            </View>
            <ChevronRight size={20} color={c.textMuted} strokeWidth={2} />
          </View>
        </Card>

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <QuickAction icon={Receipt} label={t('newExpense')} onPress={() => router.push('/expense/form')} />
          <QuickAction icon={ArrowUpFromLine} label={t('issueTool')} onPress={() => router.push('/tool/move?kind=issue')} />
          <QuickAction icon={NotebookPen} label={t('newNote')} onPress={() => router.push('/note/form')} />
        </View>

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

function QuickAction({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      android_ripple={{ color: c.muted }}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 84,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: hairline,
        borderColor: c.border,
        backgroundColor: pressed ? c.muted : c.card,
      })}>
      <Icon size={24} color={c.primary} strokeWidth={2} />
      <Txt variant="caption" weight="semibold" center numberOfLines={2}>
        {label}
      </Txt>
    </Pressable>
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
          title={a.sub ?? ''}
          // a single piece reads as it always did; several pieces (or a material) say how many: "Issue · 3"
          subtitle={withProject(t(a.title === 'issue' ? 'issue' : 'return'), a.qty_milli != null && a.qty_milli !== 1000 ? qtyText(a.qty_milli, a.unit) : null)}
          onPress={() => router.push(`/tool/${a.ref}`)}
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
