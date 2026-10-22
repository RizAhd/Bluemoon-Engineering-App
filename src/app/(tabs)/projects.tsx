import { router } from 'expo-router';
import { Building2, Plus, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ListControls, oneOf, useListPrefs } from '@/components/ListControls';
import { TabHeader } from '@/components/ProjectSwitcher';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { SearchField } from '@/components/ui/form';
import { GroupLabel, ListCard, ListRow, Screen } from '@/components/ui/layout';
import type { ProjectCost, ProjectStatus } from '@/db/types';
import { PROJECT_SORTS, useCurrentProjectId, useProjectList, type ProjectSort } from '@/hooks/data';
import { useT } from '@/i18n';
import { formatLKR } from '@/lib/money';
import { radius, space, useColors } from '@/theme';

type Row = ProjectCost & { location: string | null; client: string | null };
type Filter = 'all' | ProjectStatus;

const STATUSES: ProjectStatus[] = ['active', 'on_hold', 'completed'];
/** The search box appears above this many projects (FLOWS section 2). */
const SEARCH_FROM = 5;

/** What the Projects tab remembers (settings `list_projects_<field>`); these are the defaults. */
const DEFAULTS = { status: 'all', sort: 'name' };

function total(p: Row) {
  return p.expense_cents + p.labour_cents;
}

/** Thin contract progress bar: ink fill, warning above 85 %, danger at/over 100 %. */
function MiniBar({ spent, contract }: { spent: number; contract: number }) {
  const c = useColors();
  const ratio = contract > 0 ? spent / contract : 0;
  const fill = ratio >= 1 ? c.danger : ratio > 0.85 ? c.warning : c.slate;
  return (
    <View
      accessible
      accessibilityLabel={`${Math.round(ratio * 100)} %`}
      style={{ marginTop: space.sm, height: 6, borderRadius: radius.sm, backgroundColor: c.border, overflow: 'hidden' }}>
      <View style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%`, height: 6, borderRadius: radius.sm, backgroundColor: fill }} />
    </View>
  );
}

/**
 * Projects tab: the full list, grouped by status, in the chosen order (name, newest, highest cost, most of the
 * contract used). Tapping a row opens its hub and does not change the current project; the hub's actions do.
 *
 * There is no month filter here on purpose: a project's figures are its whole-life totals, so "projects with records
 * in March" next to all-time totals would read as March's costs. Month views live on Expenses and in the project hub.
 */
export default function ProjectsScreen() {
  const t = useT();
  const c = useColors();
  const pid = useCurrentProjectId();
  const { prefs, set, reset } = useListPrefs('projects', DEFAULTS);
  const filter = oneOf<Filter>(prefs.status, ['all', ...STATUSES], 'all');
  const sort = oneOf<ProjectSort>(prefs.sort, PROJECT_SORTS, 'name');
  const [q, setQ] = useState('');
  const rows: Row[] = useProjectList(sort);

  const goNew = () => router.push('/project/form');
  // The search text only applies while its field is on screen, so it can never filter the list invisibly.
  const query = rows.length > SEARCH_FROM ? q.trim().toLowerCase() : '';

  const { counts, visible, activeFilter } = useMemo(() => {
    const counts: Record<ProjectStatus, number> = { active: 0, on_hold: 0, completed: 0 };
    rows.forEach((r) => {
      counts[r.status] += 1;
    });
    // A chip whose count dropped to 0 is disabled: fall back to All instead of an empty list behind a dead chip.
    const activeFilter: Filter = filter !== 'all' && counts[filter] === 0 ? 'all' : filter;
    const matches = (r: Row) => !query || [r.name, r.client, r.location].some((s) => (s ?? '').toLowerCase().includes(query));
    return { counts, activeFilter, visible: rows.filter((r) => matches(r) && (activeFilter === 'all' || r.status === activeFilter)) };
  }, [rows, query, filter]);

  // Opening a project to look at it must not move the app's current project; the hub's actions do that.
  const open = (p: Row) => router.push(`/project/${p.project_id}`);

  const applied = [activeFilter !== 'all' ? t(`status_${activeFilter}`) : null, sort !== 'name' ? t(`sort_${sort}`) : null].filter((s): s is string => !!s);

  const renderRow = (p: Row) => {
    const current = p.project_id === pid;
    const label = `${p.name}${current ? ` (${t('thisProject')})` : ''}, ${t(`status_${p.status}`)}, ${formatLKR(total(p))}`;
    return (
      <ListRow
        key={p.project_id}
        icon={Building2}
        iconTone={current ? 'primary' : undefined}
        title={p.name}
        subtitle={[p.client, p.location].filter(Boolean).join(' · ') || undefined}
        value={formatLKR(total(p))}
        accessibilityLabel={label}
        badge={
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            <Badge tone={p.status === 'active' ? 'success' : p.status === 'on_hold' ? 'warning' : 'slate'} label={t(`status_${p.status}`)} />
            {current ? <Badge tone="primary" label={t('thisProject')} /> : null}
          </View>
        }
        onPress={() => open(p)}>
        {p.contract_cents ? <MiniBar spent={total(p)} contract={p.contract_cents} /> : null}
      </ListRow>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TabHeader title={t('projects')} showProject={false} />
      <Screen hairlineTop={false} gap={space.md}>
        {rows.length === 0 ? (
          // The floating "New project" button is the screen's one primary action here, so the empty state's own is secondary.
          <EmptyState icon={Building2} title={t('noProjects')} hint={t('noProjectsHint')} action={<Button kind="secondary" icon={Plus} label={t('newProject')} onPress={goNew} full />} />
        ) : (
          <>
            {rows.length > SEARCH_FROM ? <SearchField value={q} onChangeText={setQ} placeholder={t('search')} /> : null}
            <ListControls
              quick={{
                value: activeFilter,
                onChange: (v) => set('status', v),
                options: [
                  { value: 'all', label: t('all') },
                  ...STATUSES.map((s) => ({ value: s, label: t(`status_${s}`), count: counts[s], disabled: counts[s] === 0 })),
                ],
              }}
              sort={{ value: sort, onChange: (v) => set('sort', v), options: PROJECT_SORTS.map((s) => ({ value: s, label: t(`sort_${s}`) })) }}
              sheetCount={sort !== 'name' ? 1 : 0}
              applied={applied}
              onClear={reset}
            />
            {visible.length === 0 ? (
              <EmptyState icon={Search} title={`0 ${t('projects')}`} hint={query ? `"${q.trim()}"` : undefined} />
            ) : activeFilter === 'all' ? (
              STATUSES.map((s) => {
                const group = visible.filter((r) => r.status === s);
                if (!group.length) return null;
                return (
                  <View key={s} style={{ gap: space.sm }}>
                    <GroupLabel label={`${t(`status_${s}`)} (${group.length})`} value={formatLKR(group.reduce((n, r) => n + total(r), 0))} />
                    <ListCard inset>{group.map(renderRow)}</ListCard>
                  </View>
                );
              })
            ) : (
              <ListCard inset>{visible.map(renderRow)}</ListCard>
            )}
          </>
        )}
      </Screen>
    </View>
  );
}
