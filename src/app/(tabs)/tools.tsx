import { router } from 'expo-router';
import { Hammer, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { SectionList, View } from 'react-native';

import { TabHeader } from '@/components/ProjectSwitcher';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Chips } from '@/components/ui/form';
import { ListRow } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useQuery } from '@/db';
import type { ToolStatus } from '@/db/types';
import { useT } from '@/i18n';
import { formatDay } from '@/lib/dates';
import { radius, space, useColors } from '@/theme';

type Row = ToolStatus & { worker_name: string | null; project_name: string | null };
type Filter = 'all' | 'out' | 'in';

export default function ToolsScreen() {
  const t = useT();
  const c = useColors();
  const [filter, setFilter] = useState<Filter>('all');
  const rows = useQuery<Row>(
    `SELECT s.*, w.name AS worker_name, p.name AS project_name FROM v_tool_status s
     LEFT JOIN workers w ON w.id = s.worker_id LEFT JOIN projects p ON p.id = s.project_id
     ORDER BY s.is_out DESC, s.name COLLATE NOCASE`,
  );
  const out = rows.filter((r) => r.is_out);
  const inStore = rows.filter((r) => !r.is_out);
  const sections = [
    ...(filter !== 'in' && out.length ? [{ key: 'out', title: `${t('out')} (${out.length})`, data: out }] : []),
    ...(filter !== 'out' && inStore.length ? [{ key: 'in', title: `${t('inStore')} (${inStore.length})`, data: inStore }] : []),
  ];

  return (
    <View style={{ flex: 1 }}>
      <TabHeader title={t('tools')} allowAll />
      <SectionList
        sections={sections}
        keyExtractor={(r) => r.tool_id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 140, gap: space.sm }}
        ListHeaderComponent={
          rows.length ? (
            <View style={{ gap: space.md }}>
              <Chips
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: t('all') },
                  { value: 'out', label: `${t('out')} ${out.length}` },
                  { value: 'in', label: t('inStore') },
                ]}
              />
              <Button kind="secondary" icon={Plus} label={t('newTool')} onPress={() => router.push('/tool/form')} />
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          rows.length ? null : (
            <EmptyState
              icon={Hammer}
              title={t('noTools')}
              hint={t('noToolsHint')}
              action={<Button icon={Plus} label={t('newTool')} onPress={() => router.push('/tool/form')} full />}
            />
          )
        }
        renderSectionHeader={({ section }) => (
          <Txt weight="bold" color="textMuted" style={{ paddingTop: space.lg, paddingBottom: space.xs }}>
            {section.title}
          </Txt>
        )}
        renderItem={({ item }) => (
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: item.is_out ? c.warning : c.border, overflow: 'hidden' }}>
            <ListRow
              icon={Hammer}
              iconTone={item.is_out ? 'warning' : 'slate'}
              title={item.code ? `${item.name} · ${item.code}` : item.name}
              subtitle={
                item.is_out
                  ? [`${t('outWith')} ${item.worker_name ?? item.taken_by ?? ''}`, item.project_name, item.last_day ? formatDay(item.last_day) : null]
                      .filter(Boolean)
                      .join(' · ')
                  : undefined
              }
              badge={<Badge tone={item.is_out ? 'warning' : 'success'} label={item.is_out ? t('out') : t('inStore')} />}
              onPress={() => router.push(`/tool/${item.tool_id}`)}
            />
          </View>
        )}
      />
    </View>
  );
}
