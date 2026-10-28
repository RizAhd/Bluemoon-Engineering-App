import { router } from 'expo-router';
import { Hammer, Package, PackagePlus, Plus } from 'lucide-react-native';
import { memo, useMemo, useState } from 'react';
import { View } from 'react-native';

import { HeaderAction, TabHeader } from '@/components/ProjectSwitcher';
import { ShareHeaderButton, useShareSheet } from '@/components/ShareSheet';
import { Button } from '@/components/ui/Button';
import { CardList, type CardSection } from '@/components/ui/CardList';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Chips } from '@/components/ui/form';
import { ListRow, Screen } from '@/components/ui/layout';
import { useQuery, useSetting } from '@/db';
import type { ToolStock } from '@/db/types';
import { useCurrentProjectId } from '@/hooks/data';
import { usePdfShare } from '@/hooks/pdfShare';
import { useListSearch } from '@/hooks/search';
import { useT } from '@/i18n';
import { formatDay } from '@/lib/dates';
import { exportToolsRegisterPdf } from '@/lib/reports/export';
import { isSinglePiece, qtyText } from '@/lib/toolStock';
import { space, useColors } from '@/theme';

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
 * Tools tab. With a current project: "Out on this project" · "In store — available" ·
 * a collapsed "Other projects" group (out elsewhere). With "All projects": Out · In store.
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

  const sections: CardSection<Bucketed>[] = [
    { key: 'out', label: `${t(pid ? 'outHere' : 'out')} (${outHere.length})`, rows: showOut ? outHere : [] },
    { key: 'in', label: `${t(pid ? 'availableToIssue' : 'inStore')} (${inStore.length})`, rows: showIn ? inStore : [] },
    {
      key: 'elsewhere',
      label: `${t('outElsewhere')} (${outElsewhere.length})`,
      rows: showOut && showElsewhere ? outElsewhere : [],
      before:
        showOut && outElsewhere.length
          ? [
              {
                key: 'toggle',
                node: (
                  <ListRow
                    icon={Hammer}
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

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TabHeader
        title={t('tools')}
        allowAll
        right={
          // With no tools the empty state has the one "New tool" button; nothing to share yet either.
          rows.length ? (
            <>
              <ShareHeaderButton onPress={share.open} />
              {/* a tool-shaped "new", so it does not read as a second copy of the round + (which adds anything) */}
              <HeaderAction icon={PackagePlus} label={t('newTool')} onPress={goNew} />
            </>
          ) : undefined
        }
      />
      <Screen hairlineTop={false} scroll={false}>
        <CardList
          sections={rows.length ? sections : []}
          keyOf={toolKey}
          renderRow={renderRow}
          inset
          empty={rows.length === 0 ? <EmptyState icon={Hammer} title={t('noTools')} hint={t('noToolsHint')} action={<Button icon={Plus} label={t('newTool')} onPress={goNew} full />} /> : search.noResults}
          header={
            rows.length ? (
              <View style={{ gap: space.md }}>
                {search.node}
                <Chips
                  value={active}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: t('all') },
                    { value: 'out', label: t('out'), count: out.length, disabled: out.length === 0 },
                    { value: 'in', label: t('inStore'), count: inStore.length, disabled: inStore.length === 0 },
                  ]}
                />
              </View>
            ) : null
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
  const single = isSinglePiece(item);
  const out = item.out_milli > 0;
  const material = !!item.is_material;

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
  } else if (material) {
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

  return (
    <ListRow
      icon={material ? Package : Hammer}
      iconTone={out && item.bucket !== 'in' ? 'warning' : undefined}
      muted={muted}
      title={item.code ? `${item.name} · ${item.code}` : item.name}
      subtitle={subtitle}
      badge={<Badge tone={badge.tone} label={badge.label} />}
      onPress={() => router.push(`/tool/${item.tool_id}`)}
    />
  );
});
