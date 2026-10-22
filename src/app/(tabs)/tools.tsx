import { router } from 'expo-router';
import { Hammer, Plus } from 'lucide-react-native';
import { memo, useMemo, useState } from 'react';
import { View } from 'react-native';

import { HeaderAction, TabHeader } from '@/components/ProjectSwitcher';
import { ShareHeaderButton, useShareSheet } from '@/components/ShareSheet';
import { Button } from '@/components/ui/Button';
import { CardList, type CardSection } from '@/components/ui/CardList';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Chips } from '@/components/ui/form';
import { ListRow, Screen } from '@/components/ui/layout';
import { useQuery } from '@/db';
import type { ToolStatus } from '@/db/types';
import { useCurrentProjectId } from '@/hooks/data';
import { useT } from '@/i18n';
import { formatDay } from '@/lib/dates';
import { useColors } from '@/theme';

type Row = ToolStatus & { worker_name: string | null; project_name: string | null };
type Filter = 'all' | 'out' | 'in';

/**
 * Tools tab. With a current project: "Out on this project" · "In store — available" ·
 * a collapsed "Other projects" group (out elsewhere). With "All projects": Out · In store.
 */
export default function ToolsScreen() {
  const t = useT();
  const c = useColors();
  const pid = useCurrentProjectId();
  const [filter, setFilter] = useState<Filter>('all');
  const [showElsewhere, setShowElsewhere] = useState(false);
  // The tools that are out now, on the current project (or on all projects), as a message.
  const share = useShareSheet({ kind: 'toolsOut', id: pid });
  const rows = useQuery<Row>(
    `SELECT s.*, w.name AS worker_name, p.name AS project_name FROM v_tool_status s
     LEFT JOIN workers w ON w.id = s.worker_id LEFT JOIN projects p ON p.id = s.project_id
     ORDER BY s.is_out DESC, s.name COLLATE NOCASE`,
  );

  const { out, inStore, outHere, outElsewhere } = useMemo(() => {
    const out = rows.filter((r) => r.is_out);
    const inStore = rows.filter((r) => !r.is_out);
    return {
      out,
      inStore,
      outHere: pid ? out.filter((r) => r.project_id === pid) : out,
      outElsewhere: pid ? out.filter((r) => r.project_id !== pid) : [],
    };
  }, [rows, pid]);

  // A selected chip whose group has emptied (the last tool was returned, issued or deleted) falls back to All, never a blank list.
  const active: Filter = (filter === 'out' && out.length === 0) || (filter === 'in' && inStore.length === 0) ? 'all' : filter;

  const goNew = () => router.push('/tool/form');

  // Tools out on another project are drawn muted, under the collapsible "Other projects" row.
  const renderRow = (item: Row) => <ToolRow item={item} pid={pid} muted={!!pid && !!item.is_out && item.project_id !== pid} />;

  const showOut = active !== 'in';
  const showIn = active !== 'out';

  const sections: CardSection<Row>[] = [
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
          <>
            <ShareHeaderButton onPress={share.open} />
            <HeaderAction icon={Plus} label={t('newTool')} onPress={goNew} />
          </>
        }
      />
      <Screen hairlineTop={false} scroll={false}>
        <CardList
          sections={rows.length ? sections : []}
          keyOf={toolKey}
          renderRow={renderRow}
          inset
          empty={rows.length === 0 ? <EmptyState icon={Hammer} title={t('noTools')} hint={t('noToolsHint')} action={<Button icon={Plus} label={t('newTool')} onPress={goNew} full />} /> : null}
          header={
            rows.length ? (
              <Chips
                value={active}
                onChange={setFilter}
                options={[
                  { value: 'all', label: t('all') },
                  { value: 'out', label: t('out'), count: out.length, disabled: out.length === 0 },
                  { value: 'in', label: t('inStore'), count: inStore.length, disabled: inStore.length === 0 },
                ]}
              />
            ) : null
          }
        />
      </Screen>
      {share.sheet}
    </View>
  );
}

const toolKey = (r: Row) => r.tool_id;

/** One tool: name and code, who has it and where, out / in store badge. */
const ToolRow = memo(function ToolRow({ item, pid, muted }: { item: Row; pid: string | null; muted: boolean }) {
  const t = useT();
  return (
    <ListRow
      icon={Hammer}
      iconTone={item.is_out ? 'warning' : undefined}
      muted={muted}
      title={item.code ? `${item.name} · ${item.code}` : item.name}
      subtitle={
        item.is_out
          ? // The project name only says something when the tool is on another project than the one chosen.
            [`${t('outWith')} ${item.worker_name ?? item.taken_by ?? ''}`.trim(), item.project_id !== pid ? item.project_name : null, item.last_day ? formatDay(item.last_day) : null]
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      badge={<Badge tone={item.is_out ? 'warning' : 'success'} label={item.is_out ? t('out') : t('inStore')} />}
      onPress={() => router.push(`/tool/${item.tool_id}`)}
    />
  );
});
