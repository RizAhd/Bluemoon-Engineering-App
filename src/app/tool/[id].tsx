import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ArrowDownToLine, ArrowUpFromLine, Camera, CheckCircle2, Hammer, History, Pencil } from 'lucide-react-native';
import { memo } from 'react';
import { Alert, View } from 'react-native';

import { PhotoStrip } from '@/components/PhotoStrip';
import { Button, HeaderButton } from '@/components/ui/Button';
import { CardList } from '@/components/ui/CardList';
import { Badge, EmptyState, toast } from '@/components/ui/feedback';
import { Card, ListRow, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst, useQuery } from '@/db';
import { deleteRecord } from '@/db/repo';
import type { Tool, ToolMovement, ToolStatus } from '@/db/types';
import { useCurrentProjectId } from '@/hooks/data';
import { useT } from '@/i18n';
import { formatDay } from '@/lib/dates';
import { showError } from '@/lib/errors';
import { space, useColors } from '@/theme';

type Move = ToolMovement & { worker_name: string | null; project_name: string | null };

export default function ToolDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const c = useColors();
  const pid = useCurrentProjectId();
  const tool = useFirst<Tool>('SELECT * FROM tools WHERE id = ? AND deleted_at IS NULL', [id ?? '']);
  const status = useFirst<ToolStatus & { worker_name: string | null; project_name: string | null }>(
    `SELECT s.*, w.name AS worker_name, p.name AS project_name FROM v_tool_status s
     LEFT JOIN workers w ON w.id = s.worker_id LEFT JOIN projects p ON p.id = s.project_id WHERE s.tool_id = ?`,
    [id ?? ''],
  );
  const moves = useQuery<Move>(
    `SELECT m.*, w.name AS worker_name, p.name AS project_name FROM tool_movements m
     LEFT JOIN workers w ON w.id = m.worker_id LEFT JOIN projects p ON p.id = m.project_id
     WHERE m.tool_id = ? AND m.deleted_at IS NULL ORDER BY m.day DESC, m.created_at DESC`,
    [id ?? ''],
  );
  // Photo counts of this tool's movements only (not of every movement on the phone).
  const photoRows = useQuery<{ owner_id: string; n: number }>(
    `SELECT a.owner_id, COUNT(*) AS n FROM attachments a JOIN tool_movements m ON m.id = a.owner_id
     WHERE a.owner_table = 'tool_movements' AND a.deleted_at IS NULL AND m.tool_id = ? GROUP BY a.owner_id`,
    [id ?? ''],
  );
  const photos = new Map(photoRows.map((r) => [r.owner_id, r.n]));

  if (!tool || !status) {
    return (
      <>
        <Stack.Screen options={{ title: t('tool') }} />
        <Screen>
          <EmptyState icon={Hammer} title={t('toolNotFound')} action={<Button kind="secondary" label={t('close')} onPress={() => router.back()} full />} />
        </Screen>
      </>
    );
  }

  const out = !!status.is_out;
  const title = tool.code ? `${tool.name} · ${tool.code}` : tool.name;
  const openMove = (kind: 'issue' | 'return') =>
    router.push({ pathname: '/tool/move', params: { toolId: tool.id, kind, ...(kind === 'issue' && pid ? { projectId: pid } : {}) } });

  function removeMove(m: Move) {
    Alert.alert(t('confirmDelete'), t('confirmDeleteBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => {
          try {
            deleteRecord('tool_movements', m.id);
            toast(t('deleted'));
          } catch (e) {
            showError(e, 'tool.deleteMove', t, { id: m.id });
          }
        },
      },
    ]);
  }

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: () => <HeaderButton icon={Pencil} label={t('editTool')} onPress={() => router.push(`/tool/form?id=${tool.id}`)} />,
        }}
      />
      <Screen scroll={false}>
        <CardList
          sections={[{ key: 'moves', rows: moves }]}
          keyOf={moveKey}
          renderRow={(m) => <MoveRow m={m} photos={photos.get(m.id) ?? 0} onRemove={removeMove} />}
          inset
          gap={space.lg}
          empty={
            <Card>
              <EmptyState compact icon={History} title={t('noToolHistory')} hint={t('noToolHistoryHint')} />
            </Card>
          }
          header={
            <View style={{ gap: space.lg }}>
              {/* Status card: colour + icon + word, never colour alone. */}
              <Card tone={out ? 'warningSoft' : 'successSoft'}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  {out ? <ArrowUpFromLine size={24} color={c.warning} strokeWidth={2} /> : <CheckCircle2 size={24} color={c.success} strokeWidth={2} />}
                  <View style={{ flex: 1, gap: space.xs }}>
                    <Txt weight="semibold" color={out ? 'warning' : 'success'}>
                      {out ? `${t('outWith')} ${status.worker_name ?? status.taken_by ?? ''}`.trim() : t('inStore')}
                    </Txt>
                    {out ? (
                      <Txt variant="caption" color="textMuted">
                        {[status.project_name, status.last_day ? formatDay(status.last_day) : null].filter(Boolean).join(' · ')}
                      </Txt>
                    ) : status.last_day ? (
                      <Txt variant="caption" color="textMuted" numeric>
                        {formatDay(status.last_day)}
                      </Txt>
                    ) : null}
                  </View>
                  {/* in store, the line itself says so; out, the badge adds the word next to who has it */}
                  {out ? <Badge tone="warning" label={t('out')} /> : null}
                </View>
              </Card>

              {out ? (
                <Button icon={ArrowDownToLine} label={t('returnTool')} onPress={() => openMove('return')} />
              ) : (
                <Button icon={ArrowUpFromLine} label={t('issueTool')} onPress={() => openMove('issue')} />
              )}

              {tool.notes ? (
                <Card>
                  <Txt eyebrow>{t('notes')}</Txt>
                  <Txt>{tool.notes}</Txt>
                </Card>
              ) : null}

              <PhotoStrip ownerTable="tools" ownerId={tool.id} label={t('photoProof')} editable={false} />

              <SectionTitle title={t('history')} count={moves.length || undefined} />
            </View>
          }
        />
      </Screen>
    </>
  );
}

const moveKey = (m: Move) => m.id;

/** One issue or return: day, who, project, condition and note, photo count; tap for photos or delete. */
const MoveRow = memo(function MoveRow({ m, photos, onRemove }: { m: Move; photos: number; onRemove: (m: Move) => void }) {
  const t = useT();
  const isIssue = m.kind === 'issue';
  return (
    <ListRow
      icon={isIssue ? ArrowUpFromLine : ArrowDownToLine}
      iconTone={isIssue ? 'warning' : 'success'}
      title={`${t(isIssue ? 'issue' : 'return')} · ${formatDay(m.day)}`}
      subtitle={[m.worker_name ?? m.taken_by, m.project_name, m.condition, m.note].filter(Boolean).join(' · ')}
      badge={photos ? <Badge icon={Camera} label={String(photos)} /> : undefined}
      onPress={() =>
        Alert.alert(`${t(isIssue ? 'issue' : 'return')} · ${formatDay(m.day)}`, [m.worker_name ?? m.taken_by, m.project_name].filter(Boolean).join(' · '), [
          { text: t('close'), style: 'cancel' },
          { text: t('photoProof'), onPress: () => router.push(`/tool/move?id=${m.id}`) },
          { text: t('delete'), style: 'destructive', onPress: () => onRemove(m) },
        ])
      }
    />
  );
});
