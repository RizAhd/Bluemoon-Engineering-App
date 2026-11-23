import { router } from 'expo-router';
import { Building2, Check, Plus, Search, Settings } from 'lucide-react-native';
import { memo, useMemo, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Hero, HeroAction, HeroTiles } from '@/components/Hero';
import { ListControls, oneOf, useListPrefs } from '@/components/ListControls';
import { Button } from '@/components/ui/Button';
import { CardList, type CardSection } from '@/components/ui/CardList';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { GroupLabel, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import type { ProjectCost, ProjectStatus } from '@/db/types';
import { PROJECT_SORTS, useCurrentProjectId, useProjectList, type ProjectSort } from '@/hooks/data';
import { useListSearch } from '@/hooks/search';
import { useT } from '@/i18n';
import { formatLKR } from '@/lib/money';
import { radius, space, useColors } from '@/theme';

type Row = ProjectCost & { location: string | null; client: string | null; received_cents?: number };
type Filter = 'all' | ProjectStatus;

const STATUSES: ProjectStatus[] = ['active', 'on_hold', 'completed'];

/** What a project can be found by in the search box. */
const projectFields = (r: Row) => [r.name, r.client, r.location];

/** What the Projects tab remembers (settings `list_projects_<field>`); these are the defaults. */
const DEFAULTS = { status: 'all', sort: 'name' };

function total(p: Row) {
  return p.expense_cents + p.labour_cents;
}

/** Percent of the contract used: "<1" when something is spent but under half a percent, never a misleading "0". */
function usedPct(spent: number, contract: number): string {
  const pct = Math.round((spent / contract) * 100);
  return spent > 0 && pct === 0 ? '<1' : String(pct);
}

/** Thin contract progress bar: blue fill (white on the navy card), warning above 85 %, danger at/over 100 %. */
function MiniBar({ spent, contract, onDark }: { spent: number; contract: number; onDark?: boolean }) {
  const c = useColors();
  const ratio = contract > 0 ? spent / contract : 0;
  const fill = ratio >= 1 ? c.danger : ratio > 0.85 ? c.amber : onDark ? c.onSlate : c.primary;
  return (
    <View
      accessible
      accessibilityLabel={`${usedPct(spent, contract)} %`}
      style={{ height: 6, borderRadius: radius.sm, backgroundColor: onDark ? c.headerSoft : c.surface2, overflow: 'hidden' }}>
      <View style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%`, height: 6, borderRadius: radius.sm, backgroundColor: fill }} />
    </View>
  );
}

/**
 * Projects tab: the full list, grouped by status, in the chosen order (name, newest, highest cost, most of the
 * contract used). Tapping a card opens its hub and does not change the current project; the hub's actions do.
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
  const rows: Row[] = useProjectList(sort);
  // The search box is only drawn with the list (not over the empty state), and its text only applies while it is on screen.
  const search = useListSearch(rows, projectFields, { shown: rows.length > 0 });

  const goNew = () => router.push('/project/form');

  // the hero's tiles count every project, whatever the search or chip shows
  const all = useMemo(() => {
    const n: Record<ProjectStatus, number> = { active: 0, on_hold: 0, completed: 0 };
    rows.forEach((r) => {
      n[r.status] += 1;
    });
    return n;
  }, [rows]);

  const { counts, visible, activeFilter } = useMemo(() => {
    // The chips count what the search leaves, so a chip never promises rows the search has already hidden.
    const counts: Record<ProjectStatus, number> = { active: 0, on_hold: 0, completed: 0 };
    search.filtered.forEach((r) => {
      counts[r.status] += 1;
    });
    // A chip whose count dropped to 0 is disabled: fall back to All instead of an empty list behind a dead chip.
    const activeFilter: Filter = filter !== 'all' && counts[filter] === 0 ? 'all' : filter;
    return { counts, activeFilter, visible: search.filtered.filter((r) => activeFilter === 'all' || r.status === activeFilter) };
  }, [search.filtered, filter]);

  // Opening a project to look at it must not move the app's current project; the hub's actions do that.
  const open = (p: Row) => router.push(`/project/${p.project_id}`);

  const applied = [activeFilter !== 'all' ? t(`status_${activeFilter}`) : null, sort !== 'name' ? t(`sort_${sort}`) : null].filter((s): s is string => !!s);

  const renderRow = (p: Row) => <ProjectCard p={p} current={p.project_id === pid} onOpen={open} />;

  // Every project is a card of its own; under "All" each status group opens with its label and total.
  const sections: CardSection<Row>[] =
    activeFilter === 'all'
      ? STATUSES.flatMap((s) => {
          const group = visible.filter((r) => r.status === s);
          const title = <GroupLabel label={`${t(`status_${s}`)} (${group.length})`} value={formatLKR(group.reduce((n, r) => n + total(r), 0))} />;
          return group.map((r, i) => ({ key: `${s}:${r.project_id}`, title: i === 0 ? title : undefined, rows: [r] }));
        })
      : visible.map((r) => ({ key: r.project_id, rows: [r] }));

  const hero = (card?: ReactNode) => (
    <Hero
      title={t('projects')}
      subtitle={t('projectsSubtitle')}
      actions={<HeroAction icon={Settings} label={t('settingsAndMore')} onPress={() => router.push('/more')} />}
      card={card}>
      {rows.length ? (
        <HeroTiles>
          {(['active', 'completed', 'on_hold'] as const).map((s) => (
            <StatusTile key={s} label={t(`status_${s}`)} count={all[s]} on={activeFilter === s} onPress={() => set('status', activeFilter === s ? 'all' : s)} />
          ))}
        </HeroTiles>
      ) : null}
    </Hero>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Screen hairlineTop={false} scroll={false}>
        {rows.length === 0 ? (
          // The "+" in the tab bar is the screen's primary action here, so the empty state's own is secondary.
          <CardList
            sections={[]}
            keyOf={projectKey}
            renderRow={renderRow}
            header={hero()}
            empty={<EmptyState icon={Building2} title={t('noProjects')} hint={t('noProjectsHint')} action={<Button kind="secondary" icon={Plus} label={t('newProject')} onPress={goNew} full />} />}
          />
        ) : (
          <CardList
            sections={sections}
            keyOf={projectKey}
            renderRow={renderRow}
            inset={false}
            gap={space.md}
            empty={search.noResults ?? <EmptyState icon={Search} title={`0 ${t('projects')}`} />}
            header={
              <View style={{ gap: space.md }}>
                {hero(search.node)}
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
              </View>
            }
          />
        )}
      </Screen>
    </View>
  );
}

const projectKey = (p: Row) => p.project_id;

/**
 * A glass count tile on the hero (Active 2 · Completed 1 · On hold 0). Tapping it shows only that status (again: all).
 * Its spoken label has a colon ("Completed: 4"), so it is never mistaken for the filter chip "Completed 4".
 */
function StatusTile({ label, count, on, onPress }: { label: string; count: number; on: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: count === 0 }}
      accessibilityLabel={`${label}: ${count}`}
      disabled={count === 0}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        gap: 4,
        padding: space.md + 2,
        borderRadius: radius.md + 2,
        backgroundColor: pressed || on ? c.headerDeep : c.headerSoft,
        borderWidth: 1,
        borderColor: on ? c.onHeader : c.headerLine,
      })}>
      <Txt variant="caption" weight="semibold" color="onHeader" numberOfLines={1}>
        {label}
      </Txt>
      <Txt variant="heading" weight="bold" color="onHeader" numeric numberOfLines={1}>
        {String(count)}
      </Txt>
    </Pressable>
  );
}

/**
 * One project as a card: icon, badges, name, client and place, what the client paid, then the cost. The current
 * project is the navy card with the contract bar; the others are white with their cost in a soft box.
 */
const ProjectCard = memo(function ProjectCard({ p, current, onOpen }: { p: Row; current: boolean; onOpen: (p: Row) => void }) {
  const t = useT();
  const c = useColors();
  const label = `${p.name}${current ? ` (${t('thisProject')})` : ''}, ${t(`status_${p.status}`)}, ${formatLKR(total(p))}`;
  const fg = current ? c.onSlate : c.text;
  const muted = current ? c.onSlate : c.textMuted;
  const sub = [
    p.client,
    p.location,
    // what the client has paid, only once something was received and a value is known
    p.contract_cents && p.received_cents ? t('receivedOfValue', { received: formatLKR(p.received_cents), value: formatLKR(p.contract_cents) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const contract = p.contract_cents ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onOpen(p)}
      android_ripple={{ color: current ? c.slatePressed : c.muted }}
      style={({ pressed }) => ({ padding: space.lg, gap: space.md, backgroundColor: current ? (pressed ? c.slatePressed : c.slate) : pressed ? c.muted : c.card })}>
      <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: current ? c.headerSoft : c.primarySoft,
          }}>
          <Building2 size={22} color={current ? c.onSlate : c.primary} strokeWidth={1.9} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            {current ? <Badge tone="primary" icon={Check} label={t('thisProject')} /> : null}
            <Badge tone={p.status === 'active' ? 'success' : p.status === 'on_hold' ? 'warning' : 'slate'} label={t(`status_${p.status}`)} />
          </View>
          <Txt variant="title" weight="bold" numberOfLines={2} style={{ color: fg }}>
            {p.name}
          </Txt>
          {sub ? (
            <Txt variant="caption" numberOfLines={2} style={{ color: muted, opacity: current ? 0.8 : 1 }}>
              {sub}
            </Txt>
          ) : null}
        </View>
      </View>

      {current ? (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md }}>
            <View style={{ flexShrink: 1, gap: 2 }}>
              <Txt variant="caption" weight="semibold" style={{ color: muted, opacity: 0.8 }}>
                {t('totalCost')}
              </Txt>
              <Txt variant="title" weight="bold" numeric numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ color: fg, fontSize: 24, lineHeight: 30 }}>
                {formatLKR(total(p))}
              </Txt>
            </View>
            {contract > 0 ? (
              <View style={{ flexShrink: 1, alignItems: 'flex-end', gap: 2 }}>
                <Txt variant="caption" weight="semibold" style={{ color: muted, opacity: 0.8 }}>
                  {t('contract')}
                </Txt>
                <Txt weight="bold" numeric numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ color: fg }}>
                  {formatLKR(contract)}
                </Txt>
              </View>
            ) : null}
          </View>
          {contract > 0 ? (
            <>
              <MiniBar spent={total(p)} contract={contract} onDark />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                <Txt variant="caption" weight="semibold" numeric style={{ color: muted, opacity: 0.8 }}>
                  {`${usedPct(total(p), contract)}%`}
                </Txt>
                <Txt variant="caption" weight="semibold" numeric numberOfLines={1} style={{ color: muted, opacity: 0.8, flexShrink: 1, textAlign: 'right' }}>
                  {`${t('balanceToContract')} ${formatLKR(Math.max(0, contract - total(p)))}`}
                </Txt>
              </View>
            </>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: space.md,
              paddingHorizontal: space.md,
              paddingVertical: space.sm + 2,
              borderRadius: radius.md,
              backgroundColor: c.surface2,
            }}>
            <Txt variant="caption" weight="semibold" color="textMuted" numberOfLines={2} style={{ flexShrink: 1 }}>
              {contract > 0 ? `${t('totalCost')} · ${usedPct(total(p), contract)}%` : t('totalCost')}
            </Txt>
            <Txt variant="bodyLg" weight="bold" numeric numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ flexShrink: 0, maxWidth: '60%' }}>
              {formatLKR(total(p))}
            </Txt>
          </View>
          {contract > 0 ? <MiniBar spent={total(p)} contract={contract} /> : null}
        </View>
      )}
    </Pressable>
  );
});
