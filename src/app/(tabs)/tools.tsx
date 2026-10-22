import { router } from 'expo-router';
import { Hammer, Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { HeaderAction, TabHeader } from '@/components/ProjectSwitcher';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Chips } from '@/components/ui/form';
import { GroupLabel, ListCard, ListRow, Screen } from '@/components/ui/layout';
import { useQuery } from '@/db';
import type { ToolStatus } from '@/db/types';
import { useCurrentProjectId } from '@/hooks/data';
import { useT } from '@/i18n';
import { formatDay } from '@/lib/dates';
import { space, useColors } from '@/theme';

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

  const goNew = () => router.push('/tool/form');

  const renderRow = (item: Row, muted = false) => (
    <ListRow
      key={item.tool_id}
      icon={Hammer}
      iconTone={item.is_out ? 'warning' : undefined}
      muted={muted}
      title={item.code ? `${item.name} · ${item.code}` : item.name}
      subtitle={
        item.is_out
          ? [`${t('outWith')} ${item.worker_name ?? item.taken_by ?? ''}`.trim(), item.project_name, item.last_day ? formatDay(item.last_day) : null]
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      badge={<Badge tone={item.is_out ? 'warning' : 'success'} label={item.is_out ? t('out') : t('inStore')} />}
      onPress={() => router.push(`/tool/${item.tool_id}`)}
    />
  );

  const showOut = filter !== 'in';
  const showIn = filter !== 'out';

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TabHeader title={t('tools')} allowAll right={<HeaderAction icon={Plus} label={t('newTool')} onPress={goNew} />} />
      <Screen hairlineTop={false} gap={space.md}>
        {rows.length === 0 ? (
          <EmptyState icon={Hammer} title={t('noTools')} hint={t('noToolsHint')} action={<Button icon={Plus} label={t('newTool')} onPress={goNew} full />} />
        ) : (
          <>
            <Chips
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: t('all') },
                { value: 'out', label: t('out'), count: out.length, disabled: out.length === 0 },
                { value: 'in', label: t('inStore'), count: inStore.length, disabled: inStore.length === 0 },
              ]}
            />

            {showOut && outHere.length ? (
              <View style={{ gap: space.sm }}>
                <GroupLabel label={`${t(pid ? 'outHere' : 'out')} (${outHere.length})`} />
                <ListCard inset>{outHere.map((r) => renderRow(r))}</ListCard>
              </View>
            ) : null}

            {showIn && inStore.length ? (
              <View style={{ gap: space.sm }}>
                <GroupLabel label={`${t(pid ? 'availableToIssue' : 'inStore')} (${inStore.length})`} />
                <ListCard inset>{inStore.map((r) => renderRow(r))}</ListCard>
              </View>
            ) : null}

            {showOut && outElsewhere.length ? (
              <View style={{ gap: space.sm }}>
                <GroupLabel label={`${t('outElsewhere')} (${outElsewhere.length})`} />
                <ListCard inset>
                  <ListRow
                    icon={Hammer}
                    title={t('otherProjects')}
                    subtitle={showElsewhere ? t('hide') : t('showAll')}
                    value={String(outElsewhere.length)}
                    expanded={showElsewhere}
                    accessibilityLabel={`${t('outElsewhere')}: ${outElsewhere.length}. ${showElsewhere ? t('hide') : t('showAll')}`}
                    onPress={() => setShowElsewhere((v) => !v)}
                  />
                  {showElsewhere ? outElsewhere.map((r) => renderRow(r, true)) : null}
                </ListCard>
              </View>
            ) : null}
          </>
        )}
      </Screen>
    </View>
  );
}
