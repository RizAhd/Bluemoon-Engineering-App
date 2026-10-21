import { router } from 'expo-router';
import { Building2, CloudOff, Hammer, HardHat, NotebookPen, Plus, Receipt, ShieldCheck } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import { TabHeader } from '@/components/ProjectSwitcher';
import { ContractBar, Stat } from '@/components/Stats';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Card, ListCard, ListRow, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst, useQuery, useSetting } from '@/db';
import type { ProjectCost } from '@/db/types';
import { useCurrentProjectId, useProjects } from '@/hooks/data';
import { useT, type TKey } from '@/i18n';
import { daysSince, formatDay, today } from '@/lib/dates';
import { formatLKR } from '@/lib/money';
import { space, useColors } from '@/theme';

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
}

export default function TodayScreen() {
  const t = useT();
  const c = useColors();
  const projects = useProjects();
  const pid = useCurrentProjectId();
  const td = today();
  const scope = pid ? 'AND project_id = ?' : '';
  const args = pid ? [pid] : [];

  const spentToday =
    useFirst<{ s: number }>(
      `SELECT COALESCE(SUM(amount_cents),0) AS s FROM expenses WHERE deleted_at IS NULL AND day = ? ${scope}`,
      [td, ...args],
    )?.s ?? 0;
  const wagesToPay =
    useFirst<{ s: number }>('SELECT COALESCE(SUM(CASE WHEN balance_cents > 0 THEN balance_cents END),0) AS s FROM v_worker_balance')?.s ?? 0;
  const toolsOut = useFirst<{ n: number }>('SELECT COUNT(*) AS n FROM v_tool_status WHERE is_out = 1')?.n ?? 0;
  const cost = useQuery<ProjectCost>(`SELECT * FROM v_project_cost ${pid ? 'WHERE project_id = ?' : "WHERE status != 'completed'"}`, args);

  const recent = useQuery<Activity>(
    `SELECT * FROM (
       SELECT 'expense' AS kind, e.id, e.category AS title, e.paid_to AS sub, e.amount_cents, e.day, e.created_at, e.id AS ref
         FROM expenses e WHERE e.deleted_at IS NULL ${scope}
       UNION ALL
       SELECT 'wage', w.id, w.kind, wk.name, w.amount_cents, w.day, w.created_at, w.worker_id
         FROM wage_entries w JOIN workers wk ON wk.id = w.worker_id WHERE w.deleted_at IS NULL ${pid ? 'AND w.project_id = ?' : ''}
       UNION ALL
       SELECT 'tool', m.id, m.kind, t.name, NULL, m.day, m.created_at, m.tool_id
         FROM tool_movements m JOIN tools t ON t.id = m.tool_id WHERE m.deleted_at IS NULL ${pid ? 'AND m.project_id = ?' : ''}
       UNION ALL
       SELECT 'note', n.id, 'note', n.body, NULL, n.day, n.created_at, n.id
         FROM site_notes n WHERE n.deleted_at IS NULL ${scope}
     ) ORDER BY created_at DESC LIMIT 8`,
    pid ? [pid, pid, pid, pid] : [],
  );

  const lastBackup = useSetting('last_backup_at');
  const daysSinceBackup = daysSince(lastBackup);
  const hasData = recent.length > 0;

  if (!projects.length) {
    return (
      <View style={{ flex: 1 }}>
        <TabHeader title={t(greetingKey())} />
        <EmptyState
          icon={Building2}
          title={t('noProjects')}
          hint={t('noProjectsHint')}
          action={<Button icon={Plus} label={t('newProject')} onPress={() => router.push('/project/form')} full />}
        />
      </View>
    );
  }

  const totals = cost.reduce(
    (a, p) => ({ spent: a.spent + p.expense_cents + p.labour_cents, contract: a.contract + (p.contract_cents ?? 0) }),
    { spent: 0, contract: 0 },
  );

  return (
    <View style={{ flex: 1 }}>
      <TabHeader title={t(greetingKey())} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.lg, paddingBottom: 140 }}>
        {hasData && (daysSinceBackup == null || daysSinceBackup >= 3) ? (
          <Card tone="warningSoft" style={{ borderColor: 'transparent' }}>
            <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
              <CloudOff size={26} color={c.warning} />
              <View style={{ flex: 1 }}>
                <Txt weight="bold" color="warning">
                  {daysSinceBackup == null ? `${t('lastBackup')}: ${t('never')}` : t('backupOverdue', { days: daysSinceBackup })}
                </Txt>
              </View>
            </View>
            <Button icon={ShieldCheck} label={t('backupNow')} onPress={() => router.push('/backup')} />
          </Card>
        ) : null}

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Stat label={t('spentToday')} value={formatLKR(spentToday)} onPress={() => router.push('/(tabs)/expenses')} />
          <Stat label={t('wagesToPay')} value={formatLKR(wagesToPay)} onPress={() => router.push('/(tabs)/workers')} />
        </View>

        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Txt color="textMuted" weight="semibold">
              {t('totalCost')}
            </Txt>
            {toolsOut > 0 ? <Badge icon={Hammer} tone="warning" label={`${toolsOut} ${t('toolsOut')}`} /> : null}
          </View>
          <Txt variant="amount" weight="bold" numeric>
            {formatLKR(totals.spent)}
          </Txt>
          {totals.contract > 0 ? <ContractBar spent={totals.spent} contract={totals.contract} /> : null}
          {pid ? <Button kind="secondary" label={t('costSummary')} onPress={() => router.push(`/project/${pid}`)} /> : null}
        </Card>

        <SectionTitle title={t('recent')} />
        {recent.length ? (
          <ListCard>
            {recent.map((a) => (
              <ActivityRow key={`${a.kind}-${a.id}`} a={a} />
            ))}
          </ListCard>
        ) : (
          <EmptyState icon={Receipt} title={t('noExpenses')} hint={t('noExpensesHint')} />
        )}
      </ScrollView>
    </View>
  );
}

function ActivityRow({ a }: { a: Activity }) {
  const t = useT();
  const day = a.day === today() ? t('today') : formatDay(a.day);
  switch (a.kind) {
    case 'expense':
      return (
        <ListRow
          icon={Receipt}
          iconTone="primary"
          title={t(`cat_${a.title}` as TKey)}
          subtitle={[a.sub, day].filter(Boolean).join(' · ')}
          value={formatLKR(a.amount_cents ?? 0)}
          onPress={() => router.push(`/expense/form?id=${a.ref}`)}
        />
      );
    case 'wage':
      return (
        <ListRow
          icon={HardHat}
          title={a.sub ?? ''}
          subtitle={`${t(`wage_${a.title}` as TKey)} · ${day}`}
          value={formatLKR(a.amount_cents ?? 0)}
          onPress={() => router.push(`/worker/${a.ref}`)}
        />
      );
    case 'tool':
      return (
        <ListRow
          icon={Hammer}
          title={a.sub ?? ''}
          subtitle={`${t(a.title === 'issue' ? 'issue' : 'return')} · ${day}`}
          onPress={() => router.push(`/tool/${a.ref}`)}
        />
      );
    default:
      return (
        <ListRow icon={NotebookPen} title={a.sub ?? ''} subtitle={day} onPress={() => router.push(`/note/form?id=${a.ref}`)} />
      );
  }
}

