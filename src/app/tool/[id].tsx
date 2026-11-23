import { router, Stack, useLocalSearchParams } from 'expo-router';
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, Camera, Hammer, History, Package, Pencil } from 'lucide-react-native';
import { memo } from 'react';
import { Alert, View } from 'react-native';

import { Hero, HeroAction, HeroButtons, HeroChip } from '@/components/Hero';
import { PhotoStrip } from '@/components/PhotoStrip';
import { Button } from '@/components/ui/Button';
import { CardList } from '@/components/ui/CardList';
import { Badge, EmptyState, toast } from '@/components/ui/feedback';
import { Card, ListCard, ListRow, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst, useQuery } from '@/db';
import { deleteRecord } from '@/db/repo';
import type { Tool, ToolHolder, ToolMovement, ToolStatus, ToolStock } from '@/db/types';
import { useCurrentProjectId } from '@/hooks/data';
import { useListSearch } from '@/hooks/search';
import { useT } from '@/i18n';
import { formatDay } from '@/lib/dates';
import { showError } from '@/lib/errors';
import { isSinglePiece, qtyText } from '@/lib/toolStock';
import { hairline, radius, space, useColors } from '@/theme';

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
  const stock = useFirst<ToolStock>('SELECT * FROM v_tool_stock WHERE tool_id = ?', [id ?? '']);
  // who has how much of it now (several people and projects can each hold some)
  const holders = useQuery<ToolHolder & { worker_name: string | null; project_name: string | null }>(
    `SELECT h.*, w.name AS worker_name, p.name AS project_name FROM v_tool_holders h
     LEFT JOIN workers w ON w.id = h.worker_id LEFT JOIN projects p ON p.id = h.project_id
     WHERE h.tool_id = ? ORDER BY h.qty_milli DESC`,
    [id ?? ''],
  );
  // Photo counts of this tool's movements only (not of every movement on the phone).
  const photoRows = useQuery<{ owner_id: string; n: number }>(
    `SELECT a.owner_id, COUNT(*) AS n FROM attachments a JOIN tool_movements m ON m.id = a.owner_id
     WHERE a.owner_table = 'tool_movements' AND a.deleted_at IS NULL AND m.tool_id = ? GROUP BY a.owner_id`,
    [id ?? ''],
  );
  const photos = new Map(photoRows.map((r) => [r.owner_id, r.n]));
  // The history searched by who, project, condition, note and day; the box is drawn with the history only.
  const search = useListSearch(moves, (m) => [m.worker_name ?? m.taken_by, m.project_name, m.condition, m.note, formatDay(m.day)], { shown: moves.length > 0 });

  if (!tool || !status || !stock) {
    return (
      <>
        <Stack.Screen options={{ title: t('tool') }} />
        <Screen>
          <EmptyState icon={Hammer} title={t('toolNotFound')} action={<Button kind="secondary" label={t('close')} onPress={() => router.back()} full />} />
        </Screen>
      </>
    );
  }

  const single = isSinglePiece(stock);
  const material = !!stock.is_material;
  const out = single ? !!status.is_out : stock.out_milli > 0;
  const canIssue = stock.in_store_milli > 0;
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

  // a tool with several pieces whose most are out says so under the blue, in amber (never a single piece or a material)
  const mostOut = !single && !material && stock.out_milli > stock.in_store_milli;
  const Icon = material ? Package : Hammer;

  return (
    <>
      <Stack.Screen options={{ title, headerShown: false }} />
      <Screen scroll={false}>
        <CardList
          sections={[{ key: 'moves', rows: search.filtered }]}
          keyOf={moveKey}
          renderRow={(m) => <MoveRow m={m} photos={photos.get(m.id) ?? 0} onRemove={removeMove} qtyUnit={single ? undefined : (stock.unit ?? '')} />}
          inset
          gap={space.lg}
          empty={
            <Card>
              {search.noResults ?? <EmptyState compact icon={History} title={t('noToolHistory')} hint={t('noToolHistoryHint')} />}
            </Card>
          }
          header={
            <View style={{ gap: space.lg }}>
              <Hero
                back
                title={t('tool')}
                actions={<HeroAction icon={Pencil} label={t('editTool')} onPress={() => router.push(`/tool/form?id=${tool.id}`)} />}
                card={
                  mostOut ? (
                    <Card tone="warningSoft">
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                        <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
                          <AlertCircle size={22} color={c.warning} strokeWidth={2} />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Txt weight="bold">{t('mostOut')}</Txt>
                          <Txt variant="caption" color="textMuted">
                            {t('mostOutHint', { n: qtyText(stock.in_store_milli, stock.unit) })}
                          </Txt>
                        </View>
                      </View>
                    </Card>
                  ) : undefined
                }>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: radius.md + 2,
                      backgroundColor: c.headerSoft,
                      borderWidth: hairline,
                      borderColor: c.headerLine,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <Icon size={26} color={c.onHeader} strokeWidth={1.9} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Txt variant="title" weight="bold" color="onHeader" numberOfLines={2} style={{ fontSize: 22, lineHeight: 28 }}>
                      {title}
                    </Txt>
                    <Txt variant="caption" weight="semibold" color="onHeaderMuted" numberOfLines={1}>
                      {t(material ? 'kindMaterial' : 'kindTool')}
                    </Txt>
                  </View>
                </View>

                {/* Status: words first, the bar and the chip only add to them. A single piece reads as it always did. */}
                {single ? (
                  <View style={{ gap: space.xs }}>
                    <Txt variant="heading" weight="bold" color="onHeader" numberOfLines={2}>
                      {out ? `${t('outWith')} ${status.worker_name ?? status.taken_by ?? ''}`.trim() : t('inStore')}
                    </Txt>
                    {out ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                        <HeroChip icon={ArrowUpFromLine} label={t('out')} />
                        <Txt variant="caption" weight="semibold" color="onHeaderMuted" style={{ flexShrink: 1 }}>
                          {[status.project_name, status.last_day ? formatDay(status.last_day) : null].filter(Boolean).join(' · ')}
                        </Txt>
                      </View>
                    ) : status.last_day ? (
                      <Txt variant="caption" weight="semibold" color="onHeaderMuted" numeric>
                        {formatDay(status.last_day)}
                      </Txt>
                    ) : null}
                  </View>
                ) : (
                  <View style={{ gap: space.sm }}>
                    <Txt variant="heading" weight="bold" color="onHeader" numeric numberOfLines={2}>
                      {material
                        ? canIssue
                          ? t('leftCount', { n: qtyText(stock.in_store_milli, stock.unit) })
                          : t('outOfStock')
                        : t('inStoreOf', { n: qtyText(stock.in_store_milli), total: qtyText(stock.quantity_milli, stock.unit) })}
                    </Txt>
                    {!material && stock.quantity_milli > 0 ? (
                      // in store (white) and out on site (amber), side by side
                      <View style={{ flexDirection: 'row', height: 10, gap: 3 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                        {stock.in_store_milli > 0 ? <View style={{ flex: stock.in_store_milli, borderRadius: 5, backgroundColor: c.onHeader }} /> : null}
                        {stock.out_milli > 0 ? <View style={{ flex: stock.out_milli, borderRadius: 5, backgroundColor: c.amber }} /> : null}
                      </View>
                    ) : null}
                    {out ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.amber }} />
                        <Txt variant="caption" weight="semibold" color="onHeaderMuted" numeric>
                          {t(material ? 'issuedCount' : 'outCount', { n: qtyText(stock.out_milli, stock.unit) })}
                        </Txt>
                      </View>
                    ) : null}
                  </View>
                )}

                <HeroButtons>
                  {single ? (
                    out ? (
                      <Button kind="hero" icon={ArrowDownToLine} label={t('returnTool')} onPress={() => openMove('return')} />
                    ) : (
                      <Button kind="hero" icon={ArrowUpFromLine} label={t('issueTool')} onPress={() => openMove('issue')} />
                    )
                  ) : null}
                  {/* several pieces: issue more while some are in store, and take back what is out, side by side */}
                  {!single && canIssue ? <Button kind="hero" icon={ArrowUpFromLine} label={t(material ? 'issueMaterial' : 'issueTool')} onPress={() => openMove('issue')} /> : null}
                  {!single && out ? <Button kind={canIssue ? 'heroSoft' : 'hero'} icon={ArrowDownToLine} label={t('returnTool')} onPress={() => openMove('return')} /> : null}
                </HeroButtons>
              </Hero>

              {!single && holders.length ? (
                <>
                  <SectionTitle title={t('heldBy')} count={holders.length} />
                  <ListCard inset>
                    {holders.map((h) => (
                      <ListRow
                        key={`${h.project_id ?? ''}-${h.worker_id ?? ''}-${h.taken_by ?? ''}`}
                        avatar={h.worker_name ?? h.taken_by ?? '—'}
                        title={h.worker_name ?? h.taken_by ?? '—'}
                        subtitle={h.project_name ?? undefined}
                        value={qtyText(h.qty_milli, stock.unit)}
                      />
                    ))}
                  </ListCard>
                </>
              ) : null}

              {tool.notes ? (
                <Card>
                  <Txt variant="caption" weight="semibold" color="textMuted">
                    {t('notes')}
                  </Txt>
                  <Txt>{tool.notes}</Txt>
                </Card>
              ) : null}

              <PhotoStrip ownerTable="tools" ownerId={tool.id} label={t('photoProof')} editable={false} />

              <SectionTitle title={t('history')} count={moves.length || undefined} />
              {search.node}
            </View>
          }
        />
      </Screen>
    </>
  );
}

const moveKey = (m: Move) => m.id;

/** One issue or return: day, who, project, condition and note, photo count; tap for photos or delete. */
const MoveRow = memo(function MoveRow({ m, photos, onRemove, qtyUnit }: { m: Move; photos: number; onRemove: (m: Move) => void; qtyUnit?: string }) {
  const t = useT();
  const isIssue = m.kind === 'issue';
  // with several pieces each line says how many went out or came back
  const count = qtyUnit === undefined ? '' : ` · ${qtyText(m.qty_milli, qtyUnit || null)}`;
  return (
    <ListRow
      icon={isIssue ? ArrowUpFromLine : ArrowDownToLine}
      iconTone={isIssue ? 'warning' : 'success'}
      title={`${t(isIssue ? 'issue' : 'return')} · ${formatDay(m.day)}${count}`}
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
