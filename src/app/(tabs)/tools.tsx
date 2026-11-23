import { router } from 'expo-router';
import { ArrowDownToLine, ArrowUpFromLine, Hammer, Package, PackagePlus, Plus, Settings, Share2 } from 'lucide-react-native';
import { memo, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Hero, HeroAction, HeroButtons, HeroTile, HeroTiles } from '@/components/Hero';
import { useShareSheet } from '@/components/ShareSheet';
import { Button } from '@/components/ui/Button';
import { CardList, type CardSection } from '@/components/ui/CardList';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/form';
import { Card, ListRow, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useQuery, useSetting } from '@/db';
import type { ToolStock } from '@/db/types';
import { useCurrentProjectId } from '@/hooks/data';
import { usePdfShare } from '@/hooks/pdfShare';
import { useListSearch } from '@/hooks/search';
import { useT } from '@/i18n';
import { formatDay } from '@/lib/dates';
import { exportToolsRegisterPdf } from '@/lib/reports/export';
import { isSinglePiece, qtyText } from '@/lib/toolStock';
import { radius, space, useColors } from '@/theme';

/** One tool or material with its counts, and (for a single piece) where it is, as the tab has always shown. */
type Row = ToolStock & {
  last_day: string | null;
  project_id: string | null;
  worker_id: string | null;
  taken_by: string | null;
  is_out: number;
  worker_name: string | null;
  project_name: string | null;
  /** How much of it the current project has (thousandths). */
  here_milli: number;
};
type Bucket = 'out' | 'in' | 'elsewhere';
type Bucketed = Row & { bucket: Bucket };
type Filter = 'all' | 'out' | 'in';

/** What a tool can be found by in the search box. */
const toolFields = (r: Row) => [r.name, r.code, r.worker_name, r.project_name];

/**
 * Tools tab (Blueprint): a blue hero with the project, what is in store and out, and Issue / Return; the search box
 * over its edge; All · Out · In store. With a current project: "Out on this project" · a collapsed "Other projects"
 * group (out elsewhere) · "In store — available" as a grid of tiles. With "All projects": Out · In store.
 * A tool with several pieces can be in two groups at once (3 out, 7 in store); a material counts what is left.
 */
export default function ToolsScreen() {
  const t = useT();
  const c = useColors();
  const pid = useCurrentProjectId();
  const [filter, setFilter] = useState<Filter>('all');
  const [showElsewhere, setShowElsewhere] = useState(false);
  const rows = useQuery<Row>(
    `SELECT s.*, st.last_day, st.project_id, st.worker_id, st.taken_by, st.is_out, w.name AS worker_name, p.name AS project_name,
            COALESCE((SELECT SUM(h.qty_milli) FROM v_tool_holders h WHERE h.tool_id = s.tool_id AND h.project_id IS ?), 0) AS here_milli
     FROM v_tool_stock s
     JOIN v_tool_status st ON st.tool_id = s.tool_id
     LEFT JOIN workers w ON w.id = st.worker_id LEFT JOIN projects p ON p.id = st.project_id
     ORDER BY (s.out_milli > 0) DESC, s.name COLLATE NOCASE`,
    [pid],
  );
  // In memory over the rows already loaded; the box is only drawn with the list, so its text applies only while it is on screen.
  const search = useListSearch(rows, toolFields, { shown: rows.length > 0 });
  const found = search.filtered;
  // The tools that are out now, on the current project (or on all projects), as a message; the PDF is the whole register.
  const letterhead = useSetting('export_letterhead') === '1';
  const pdf = usePdfShare({
    tag: 'tools.pdf',
    title: t('tools'),
    make: (notice) => exportToolsRegisterPdf({ letterhead, onNotice: notice }),
    details: { letterhead },
  });
  const share = useShareSheet({
    kind: 'toolsOut',
    id: pid,
    pdf: { hint: `${t('pdfToolsRegister')} · ${t('toolsCount', { n: rows.length })} · ${t(letterhead ? 'letterheadOption' : 'pdfPlainPaper')}`, run: pdf.run },
  });

  const { out, inStore, outHere, outElsewhere } = useMemo(() => {
    const tag = (list: Row[], bucket: Bucket): Bucketed[] => list.map((r) => ({ ...r, bucket }));
    const out = found.filter((r) => r.out_milli > 0);
    // A material with nothing in store and nothing out ("Out of stock", e.g. a new one at 0) still has its row, so its page can be opened to add stock.
    const inStore = found.filter((r) => r.in_store_milli > 0 || r.out_milli <= 0);
    return {
      out,
      inStore: tag(inStore, 'in'),
      outHere: tag(pid ? found.filter((r) => r.here_milli > 0) : out, 'out'),
      outElsewhere: tag(pid ? found.filter((r) => r.out_milli - r.here_milli > 0) : [], 'elsewhere'),
    };
  }, [found, pid]);

  // A selected chip whose group has emptied (the last tool was returned, issued or deleted) falls back to All, never a blank list.
  const active: Filter = (filter === 'out' && out.length === 0) || (filter === 'in' && inStore.length === 0) ? 'all' : filter;

  const goNew = () => router.push('/tool/form');

  // Tools out on another project are drawn muted, under the collapsible "Other projects" row.
  const renderRow = (item: Bucketed) => <ToolRow item={item} pid={pid} muted={item.bucket === 'elsewhere'} />;


  const showOut = active !== 'in';
  const showIn = active !== 'out';

  // Section heads: the name in bold and the count beside it, as one text ("Out on this project (2)").
  const head = (label: string, n: number) => (
    <Txt variant="title" weight="bold" accessibilityRole="header" numberOfLines={2}>
      {label}
      <Txt variant="title" weight="semibold" color="textMuted" numeric>
        {` (${n})`}
      </Txt>
    </Txt>
  );

  // Out on this project (or out anywhere) and the collapsible "Other projects" are list rows; what is in store is
  // drawn as a two-column grid of tiles under them (the list's footer), as in the Blueprint design.
  const sections: CardSection<Bucketed>[] = [
    { key: 'out', title: head(t(pid ? 'outHere' : 'out'), outHere.length), rows: showOut ? outHere : [] },
    {
      key: 'elsewhere',
      title: head(t('outElsewhere'), outElsewhere.length),
      rows: showOut && showElsewhere ? outElsewhere : [],
      before:
        showOut && outElsewhere.length
          ? [
              {
                key: 'toggle',
                node: (
                  <ListRow
                    icon={Hammer}
                    iconTone="slate"
                    title={t('otherProjects')}
                    subtitle={showElsewhere ? t('hide') : t('showAll')}
                    value={String(outElsewhere.length)}
                    expanded={showElsewhere}
                    accessibilityLabel={`${t('outElsewhere')}: ${outElsewhere.length}. ${showElsewhere ? t('hide') : t('showAll')}`}
                    onPress={() => setShowElsewhere((v) => !v)}
                  />
                ),
              },
            ]
          : [],
    },
  ];

  const storeGrid =
    rows.length && showIn && inStore.length ? (
      <View style={{ gap: space.md }}>
        {head(t(pid ? 'availableToIssue' : 'inStore'), inStore.length)}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          {inStore.map((r) => (
            <ToolTile key={toolKey(r)} item={r} />
          ))}
        </View>
      </View>
    ) : null;

  const outPieces = out.reduce((a, r) => a + r.out_milli, 0);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Screen hairlineTop={false} scroll={false}>
        <CardList
          sections={rows.length ? sections : []}
          keyOf={toolKey}
          renderRow={renderRow}
          inset
          gap={space.lg}
          footer={storeGrid}
          // the in-store grid is the footer: "nothing found" is only for a search that leaves no tool anywhere
          empty={rows.length === 0 ? <EmptyState icon={Hammer} title={t('noTools')} hint={t('noToolsHint')} action={<Button icon={Plus} label={t('newTool')} onPress={goNew} full />} /> : storeGrid ? undefined : search.noResults}
          header={
            <View style={{ gap: space.lg }}>
              <Hero
                title={t('tools')}
                project={{ allowAll: true }}
                actions={
                  <>
                    {/* With no tools the empty state has the one "New tool" button; nothing to share yet either. */}
                    {rows.length ? <HeroAction icon={Share2} label={t('share')} onPress={share.open} /> : null}
                    {/* a tool-shaped "new", so it does not read as a second copy of the round + (which adds anything) */}
                    {rows.length ? <HeroAction icon={PackagePlus} label={t('newTool')} onPress={goNew} /> : null}
                    <HeroAction icon={Settings} label={t('settingsAndMore')} onPress={() => router.push('/more')} />
                  </>
                }
                card={rows.length ? search.node : undefined}>
                {rows.length ? (
                  <>
                    <HeroTiles>
                      <HeroTile label={t('inStore')} value={String(inStore.length)} caption={t('toolsCount', { n: inStore.length })} dot={c.onHeader} />
                      <HeroTile label={t(pid ? 'outHere' : 'out')} value={String(outHere.length)} caption={t('outCount', { n: qtyText(outPieces) })} dot={c.amber} />
                    </HeroTiles>
                    <HeroButtons>
                      <Button kind="hero" icon={ArrowUpFromLine} label={t('issueTool')} onPress={() => router.push('/tool/move?kind=issue')} />
                      <Button kind="heroSoft" icon={ArrowDownToLine} label={t('returnTool')} onPress={() => router.push('/tool/move?kind=return')} disabled={out.length === 0} />
                    </HeroButtons>
                  </>
                ) : null}
              </Hero>
              {rows.length ? (
                <Segmented
                  value={active}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: `${t('all')} · ${rows.length}`, accessibilityLabel: t('all') },
                    { value: 'out', label: `${t('out')} · ${out.length}`, accessibilityLabel: `${t('out')} ${out.length}` },
                    { value: 'in', label: `${t('inStore')} · ${inStore.length}`, accessibilityLabel: `${t('inStore')} ${inStore.length}` },
                  ]}
                />
              ) : null}
            </View>
          }
        />
      </Screen>
      {share.sheet}
    </View>
  );
}

// a tool with several pieces sits in the "out" and the "in store" group at the same time: one key per group
const toolKey = (r: Bucketed) => `${r.bucket}-${r.tool_id}`;

/** One tool or material: name and code, its counts, and for a single piece who has it and where. */
const ToolRow = memo(function ToolRow({ item, pid, muted }: { item: Bucketed; pid: string | null; muted: boolean }) {
  const t = useT();
  const { subtitle, badge } = describe(item, pid, t);
  const out = item.out_milli > 0;
  return (
    <ListRow
      icon={item.is_material ? Package : Hammer}
      iconTone={out && item.bucket !== 'in' ? 'warning' : undefined}
      muted={muted}
      title={item.code ? `${item.name} · ${item.code}` : item.name}
      subtitle={subtitle}
      badge={<Badge tone={badge.tone} label={badge.label} />}
      onPress={() => router.push(`/tool/${item.tool_id}`)}
    />
  );
});

/** The words under a tool and its status badge (shared by the rows and the in-store tiles). */
function describe(item: Row, pid: string | null, t: ReturnType<typeof useT>) {
  const single = isSinglePiece(item);
  const out = item.out_milli > 0;
  let subtitle: string | undefined;
  let badge: { tone: 'success' | 'warning' | 'danger'; label: string };
  if (single) {
    subtitle = out
      ? // The project name only says something when the tool is on another project than the one chosen.
        [`${t('outWith')} ${item.worker_name ?? item.taken_by ?? ''}`.trim(), item.project_id !== pid ? item.project_name : null, item.last_day ? formatDay(item.last_day) : null]
          .filter(Boolean)
          .join(' · ')
      : undefined;
    badge = { tone: out ? 'warning' : 'success', label: t(out ? 'out' : 'inStore') };
  } else if (item.is_material) {
    subtitle = [t('leftCount', { n: qtyText(item.in_store_milli, item.unit) }), out ? t('issuedCount', { n: qtyText(item.out_milli, item.unit) }) : null].filter(Boolean).join(' · ');
    badge = item.in_store_milli > 0 ? { tone: 'success', label: t('leftCount', { n: qtyText(item.in_store_milli, item.unit) }) } : { tone: 'danger', label: t('outOfStock') };
  } else {
    subtitle = [out ? t('outCount', { n: qtyText(item.out_milli, item.unit) }) : null, t('inStoreCount', { n: qtyText(item.in_store_milli, item.unit) })].filter(Boolean).join(' · ');
    badge = !out
      ? { tone: 'success', label: t('inStore') }
      : item.in_store_milli <= 0
        ? { tone: 'warning', label: t('out') }
        : { tone: 'warning', label: t('outCount', { n: qtyText(item.out_milli, item.unit) }) };
  }
  return { subtitle, badge };
}

/** A tool in the store as a tile: icon, status, name, counts, and for several pieces a store / out bar. */
const ToolTile = memo(function ToolTile({ item }: { item: Bucketed }) {
  const t = useT();
  const c = useColors();
  const { subtitle, badge } = describe(item, null, t);
  const pieces = !isSinglePiece(item) && !item.is_material && item.quantity_milli > 0;
  const mostlyOut = pieces && item.out_milli > item.in_store_milli;
  const Icon = item.is_material ? Package : Hammer;
  const title = item.code ? `${item.name} · ${item.code}` : item.name;
  return (
    <Card
      onPress={() => router.push(`/tool/${item.tool_id}`)}
      accessibilityLabel={[title, subtitle, badge.label].filter(Boolean).join('. ')}
      padding={space.lg}
      gap={space.sm}
      style={{ flexGrow: 1, flexBasis: 140, maxWidth: '100%' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: radius.md,
            backgroundColor: mostlyOut ? c.warningSoft : c.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Icon size={21} color={mostlyOut ? c.warning : c.primary} strokeWidth={1.9} />
        </View>
        <View style={{ flexShrink: 1 }}>
          <Badge tone={badge.tone} label={badge.label} />
        </View>
      </View>
      <Txt variant="bodyLg" weight="bold" numberOfLines={2}>
        {title}
      </Txt>
      {pieces ? (
        <View style={{ flexDirection: 'row', height: 6, gap: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {item.in_store_milli > 0 ? <View style={{ flex: item.in_store_milli, borderRadius: 3, backgroundColor: c.primary }} /> : null}
          {item.out_milli > 0 ? <View style={{ flex: item.out_milli, borderRadius: 3, backgroundColor: c.amber }} /> : null}
        </View>
      ) : null}
      {subtitle ? (
        <Txt variant="caption" color="textMuted" numberOfLines={2}>
          {subtitle}
        </Txt>
      ) : null}
    </Card>
  );
});
