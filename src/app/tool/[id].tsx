import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ArrowDownToLine, ArrowUpFromLine, Camera, Pencil } from 'lucide-react-native';
import { Alert } from 'react-native';

import { PhotoStrip } from '@/components/PhotoStrip';
import { Button, HeaderButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/feedback';
import { Card, ListCard, ListRow, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst, useQuery } from '@/db';
import { deleteRecord } from '@/db/repo';
import type { Tool, ToolMovement, ToolStatus } from '@/db/types';
import { useAttachmentCounts } from '@/hooks/data';
import { useT } from '@/i18n';
import { formatDay } from '@/lib/dates';

type Move = ToolMovement & { worker_name: string | null; project_name: string | null };

export default function ToolDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const tool = useFirst<Tool>('SELECT * FROM tools WHERE id = ? AND deleted_at IS NULL', [id]);
  const status = useFirst<ToolStatus & { worker_name: string | null; project_name: string | null }>(
    `SELECT s.*, w.name AS worker_name, p.name AS project_name FROM v_tool_status s
     LEFT JOIN workers w ON w.id = s.worker_id LEFT JOIN projects p ON p.id = s.project_id WHERE s.tool_id = ?`,
    [id],
  );
  const moves = useQuery<Move>(
    `SELECT m.*, w.name AS worker_name, p.name AS project_name FROM tool_movements m
     LEFT JOIN workers w ON w.id = m.worker_id LEFT JOIN projects p ON p.id = m.project_id
     WHERE m.tool_id = ? AND m.deleted_at IS NULL ORDER BY m.day DESC, m.created_at DESC`,
    [id],
  );
  const photos = useAttachmentCounts('tool_movements');

  if (!tool || !status) return null;
  const out = !!status.is_out;

  return (
    <>
      <Stack.Screen
        options={{
          title: tool.name,
          headerRight: () => <HeaderButton icon={Pencil} label={t('editTool')} onPress={() => router.push(`/tool/form?id=${tool.id}`)} />,
        }}
      />
      <Screen>
        <Card tone={out ? 'warningSoft' : 'successSoft'} style={{ borderColor: 'transparent' }}>
          <Badge tone={out ? 'warning' : 'success'} label={out ? t('out') : t('inStore')} />
          {out ? (
            <>
              <Txt variant="title" weight="bold">
                {t('outWith')} {status.worker_name ?? status.taken_by}
              </Txt>
              <Txt color="textMuted">{[status.project_name, status.last_day ? formatDay(status.last_day) : null].filter(Boolean).join(' · ')}</Txt>
            </>
          ) : null}
          {tool.code ? <Txt color="textMuted">{tool.code}</Txt> : null}
        </Card>

        {out ? (
          <Button icon={ArrowDownToLine} label={t('returnTool')} onPress={() => router.push(`/tool/move?toolId=${tool.id}&kind=return`)} />
        ) : (
          <Button icon={ArrowUpFromLine} label={t('issueTool')} onPress={() => router.push(`/tool/move?toolId=${tool.id}&kind=issue`)} />
        )}

        <PhotoStrip ownerTable="tools" ownerId={tool.id} label={t('photoProof')} editable={false} />

        <SectionTitle title={t('history')} />
        {moves.length ? (
          <ListCard>
            {moves.map((m) => {
              const n = photos.get(m.id) ?? 0;
              return (
                <ListRow
                  key={m.id}
                  icon={m.kind === 'issue' ? ArrowUpFromLine : ArrowDownToLine}
                  iconTone={m.kind === 'issue' ? 'warning' : 'success'}
                  title={`${t(m.kind === 'issue' ? 'issue' : 'return')} · ${formatDay(m.day)}`}
                  subtitle={[m.worker_name ?? m.taken_by, m.project_name, m.condition, m.note].filter(Boolean).join(' · ')}
                  badge={n ? <Badge icon={Camera} label={String(n)} /> : undefined}
                  onPress={() =>
                    Alert.alert(t(m.kind === 'issue' ? 'issue' : 'return'), formatDay(m.day), [
                      { text: t('close'), style: 'cancel' },
                      { text: t('photoProof'), onPress: () => router.push(`/tool/move?id=${m.id}`) },
                      {
                        text: t('delete'),
                        style: 'destructive',
                        onPress: () =>
                          Alert.alert(t('confirmDelete'), t('confirmDeleteBody'), [
                            { text: t('cancel'), style: 'cancel' },
                            { text: t('delete'), style: 'destructive', onPress: () => deleteRecord('tool_movements', m.id) },
                          ]),
                      },
                    ])
                  }
                />
              );
            })}
          </ListCard>
        ) : (
          <Txt color="textMuted">{t('issueTool')}</Txt>
        )}
      </Screen>
    </>
  );
}
